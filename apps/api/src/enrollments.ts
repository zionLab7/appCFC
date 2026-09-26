import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { HttpError, type Identity } from './auth.js';
import { cents, idempotent, object, only, record, requireUnit, uuid } from './operations.js';
import { provisionActivation } from './finance.js';

export async function createEnrollment(pool: Pool, identity: Identity, raw: unknown,
  key: string | undefined, correlationId: string) {
  const v=object(raw); only(v,['unitId','studentId','packageVersionId','agreedPriceCents']);
  const unitId=uuid(v.unitId,'Unidade'),studentId=uuid(v.studentId,'Aluno');
  const packageVersionId=uuid(v.packageVersionId,'Versão'), agreedPriceCents=cents(v.agreedPriceCents);
  const input={unitId,studentId,packageVersionId,agreedPriceCents};
  return idempotent(pool,identity,'POST /api/v1/enrollments',key,input,
    db=>requireUnit(db,identity,unitId,'enrollment.write'),async db=>{
      const student=await db.query(`SELECT 1 FROM student WHERE id=$1 AND organization_id=$2 AND home_unit_id=$3`,
        [studentId,identity.organizationId,unitId]);
      if (!student.rowCount) throw new HttpError(404,'STUDENT_NOT_FOUND','Aluno não encontrado nesta unidade');
      const version=await db.query(`SELECT pv.id,pv.version,pv.price_cents,pv.currency,pv.terms,
        p.code,p.service_type,pa.name AS package_name
        FROM package_version pv JOIN package pa ON pa.id=pv.package_id AND pa.organization_id=pv.organization_id
        JOIN product p ON p.id=pa.product_id AND p.organization_id=pa.organization_id
        WHERE pv.id=$1 AND pv.organization_id=$2 AND pv.published_at IS NOT NULL
          AND (pa.unit_id IS NULL OR pa.unit_id=$3)`,[packageVersionId,identity.organizationId,unitId]);
      if (!version.rowCount) throw new HttpError(404,'PACKAGE_VERSION_NOT_FOUND','Versão publicada não encontrada');
      const row=version.rows[0];
      if (agreedPriceCents!==Number(row.price_cents))
        throw new HttpError(409,'PRICE_MISMATCH','Preço contratado deve corresponder à versão publicada');
      const items=await db.query(`SELECT item_type AS "itemType",quantity FROM package_item
        WHERE package_version_id=$1 AND organization_id=$2 ORDER BY item_type`,[packageVersionId,identity.organizationId]);
      const snapshot={productCode:row.code,serviceType:row.service_type,packageName:row.package_name,
        version:row.version,priceCents:agreedPriceCents,currency:row.currency,terms:row.terms,items:items.rows};
      const enrollmentId=randomUUID();
      await db.query(`INSERT INTO enrollment(id,organization_id,unit_id,student_id,package_version_id,
        agreed_price_cents,package_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7)`,
        [enrollmentId,identity.organizationId,unitId,studentId,packageVersionId,agreedPriceCents,JSON.stringify(snapshot)]);
      await record(db,identity,unitId,'enrollment.created','enrollment',enrollmentId,
        {enrollmentId,studentId,packageVersionId},correlationId);
      return {id:enrollmentId,status:'DRAFT',unitId,studentId,packageVersionId,packageSnapshot:snapshot};
    },201);
}

export async function activateEnrollment(pool: Pool, identity: Identity, enrollmentId: string, raw: unknown,
  key: string | undefined, correlationId: string) {
  if (!['development','test'].includes(process.env.NODE_ENV ?? ''))
    throw new HttpError(503,'CONTRACT_INTEGRATION_PENDING','Ativação exige contrato assinado e configuração operacional');
  const v=object(raw); only(v,['unitId','demoActivationConfirmed']);
  const unitId=uuid(v.unitId,'Unidade'); uuid(enrollmentId,'Matrícula');
  if (v.demoActivationConfirmed!==true) throw new HttpError(409,'DEMO_CONFIRMATION_REQUIRED','Confirmação de demonstração necessária');
  const input={enrollmentId,unitId,demoActivationConfirmed:true};
  return idempotent(pool,identity,`POST /api/v1/enrollments/${enrollmentId}/activate`,key,input,
    db=>requireUnit(db,identity,unitId,'enrollment.write'),async db=>{
      const found=await db.query(`SELECT e.*,p.service_type FROM enrollment e
        JOIN package_version pv ON pv.id=e.package_version_id AND pv.organization_id=e.organization_id
        JOIN package pa ON pa.id=pv.package_id AND pa.organization_id=pv.organization_id
        JOIN product p ON p.id=pa.product_id AND p.organization_id=pa.organization_id
        WHERE e.id=$1 AND e.organization_id=$2 AND e.unit_id=$3 FOR UPDATE OF e`,
        [enrollmentId,identity.organizationId,unitId]);
      if (!found.rowCount) throw new HttpError(404,'ENROLLMENT_NOT_FOUND','Matrícula não encontrada');
      const e=found.rows[0];
      if (e.status!=='DRAFT') throw new HttpError(409,'ENROLLMENT_NOT_DRAFT','Matrícula não está em rascunho');
      if (!e.package_snapshot) throw new HttpError(409,'SNAPSHOT_MISSING','Snapshot do pacote ausente');
      const wf=await db.query(`SELECT wv.id FROM workflow_version wv
        JOIN workflow_definition wd ON wd.id=wv.definition_id AND wd.organization_id=wv.organization_id
        WHERE wv.organization_id=$1 AND wd.service_type=$2 AND wv.published_at IS NOT NULL
          AND EXISTS(SELECT 1 FROM workflow_step_definition sd WHERE sd.workflow_version_id=wv.id)
        ORDER BY wv.published_at DESC,wv.version DESC LIMIT 1`,[identity.organizationId,e.service_type]);
      if (!wf.rowCount) throw new HttpError(409,'WORKFLOW_NOT_CONFIGURED','Workflow publicado indisponível para o serviço');
      const workflowVersionId=wf.rows[0].id as string,processId=randomUUID();
      const definitions=await db.query(`SELECT id,code,prerequisites,assigned_role,sla_hours FROM workflow_step_definition
        WHERE workflow_version_id=$1 AND organization_id=$2 ORDER BY sort_order,id`,[workflowVersionId,identity.organizationId]);
      await db.query(`INSERT INTO process(id,organization_id,unit_id,student_id,enrollment_id,workflow_version_id,status)
        VALUES($1,$2,$3,$4,$5,$6,'ACTIVE')`,
        [processId,identity.organizationId,unitId,e.student_id,enrollmentId,workflowVersionId]);
      for (const step of definitions.rows) {
        const ready=Array.isArray(step.prerequisites) && step.prerequisites.length===0;
        const stepId=randomUUID();
        await db.query(`INSERT INTO process_step(id,organization_id,process_id,definition_step_id,status)
          VALUES($1,$2,$3,$4,$5)`,[stepId,identity.organizationId,processId,step.id,ready?'READY':'NOT_STARTED']);
        if (ready) {
          const task=await db.query(`INSERT INTO task(organization_id,unit_id,process_id,process_step_id,kind,assigned_role,due_at,context)
            VALUES($1,$2,$3,$4,'PROCESS_STEP',$5,CASE WHEN $6::integer IS NULL THEN NULL ELSE now()+($6||' hours')::interval END,$7)
            RETURNING id`,[identity.organizationId,unitId,processId,stepId,step.assigned_role,step.sla_hours,JSON.stringify({stepCode:step.code})]);
          await record(db,identity,unitId,'task.created','task',task.rows[0].id,
            {taskId:task.rows[0].id,processId,stepId},correlationId);
        }
      }
      const items=e.package_snapshot.items;
      if (!Array.isArray(items)) throw new HttpError(409,'INVALID_PACKAGE_SNAPSHOT','Itens contratados ausentes');
      await provisionActivation(db,identity,unitId,enrollmentId,Number(e.agreed_price_cents),items,correlationId);
      await db.query(`UPDATE enrollment SET status='ACTIVE',activated_at=now() WHERE id=$1`,[enrollmentId]);
      await record(db,identity,unitId,'enrollment.activated','enrollment',enrollmentId,
        {enrollmentId,processId,workflowVersionId},correlationId);
      await record(db,identity,unitId,'process.created','process',processId,
        {processId,enrollmentId,workflowVersionId},correlationId);
      return {id:enrollmentId,status:'ACTIVE',processId,workflowVersionId};
    });
}

export async function getEnrollment(pool: Pool,identity: Identity,enrollmentId: string) {
  uuid(enrollmentId,'Matrícula');
  const found=await pool.query(`SELECT id,unit_id AS "unitId",student_id AS "studentId",status,
    package_version_id AS "packageVersionId",package_snapshot AS "packageSnapshot",activated_at AS "activatedAt"
    FROM enrollment e WHERE id=$1 AND organization_id=$2 AND EXISTS(
      SELECT 1 FROM user_unit_membership m JOIN role_permission rp ON rp.role_id=m.role_id
      JOIN unit u ON u.id=m.unit_id AND u.organization_id=m.organization_id
      WHERE m.organization_id=e.organization_id AND m.unit_id=e.unit_id AND m.user_id=$3
        AND m.active AND u.active AND rp.permission_code='enrollment.read')`,
    [enrollmentId,identity.organizationId,identity.userId]);
  if (!found.rowCount) throw new HttpError(404,'ENROLLMENT_NOT_FOUND','Matrícula não encontrada');
  return found.rows[0];
}
