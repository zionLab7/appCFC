import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { transitionStep, type StepStatus } from '../../../packages/domain/src/workflow.js';
import { HttpError, type Identity } from './auth.js';
import { idempotent, object, only, record, requireRole, requireUnit, uuid } from './operations.js';

const statuses=new Set<StepStatus>(['NOT_STARTED','READY','IN_PROGRESS','WAITING_EXTERNAL','WAITING_STUDENT',
  'BLOCKED','COMPLETED','FAILED','WAIVED','CANCELLED']);
function status(value: unknown): StepStatus {
  if (typeof value!=='string' || !statuses.has(value as StepStatus)) throw new HttpError(400,'INVALID_STATUS','Estado inválido');
  return value as StepStatus;
}

export async function getProcess(pool: Pool,identity: Identity,processId: string) {
  uuid(processId,'Processo');
  const found=await pool.query(`SELECT p.id,p.unit_id AS "unitId",p.student_id AS "studentId",
    p.enrollment_id AS "enrollmentId",p.workflow_version_id AS "workflowVersionId",wv.version AS "workflowVersion",p.status
    FROM process p JOIN workflow_version wv ON wv.id=p.workflow_version_id AND wv.organization_id=p.organization_id
    WHERE p.id=$1 AND p.organization_id=$2 AND EXISTS(
      SELECT 1 FROM user_unit_membership m JOIN role_permission rp ON rp.role_id=m.role_id
      JOIN unit u ON u.id=m.unit_id AND u.organization_id=m.organization_id
      WHERE m.organization_id=p.organization_id AND m.unit_id=p.unit_id AND m.user_id=$3
        AND m.active AND u.active AND rp.permission_code='process.read')`,
    [processId,identity.organizationId,identity.userId]);
  if (!found.rowCount) throw new HttpError(404,'PROCESS_NOT_FOUND','Processo não encontrado');
  const steps=await pool.query(`SELECT ps.id,sd.code,sd.label,sd.stage,sd.sort_order AS "sortOrder",
    sd.prerequisites,sd.allowed_actions AS "allowedActions",sd.assigned_role AS "assignedRole",
    ps.status,ps.completed_at AS "completedAt"
    FROM process_step ps JOIN workflow_step_definition sd ON sd.id=ps.definition_step_id AND sd.organization_id=ps.organization_id
    WHERE ps.process_id=$1 AND ps.organization_id=$2 ORDER BY sd.sort_order,sd.id`,[processId,identity.organizationId]);
  const tasks=await pool.query(`SELECT id,process_step_id AS "stepId",kind,status,assigned_role AS "assignedRole",due_at AS "dueAt"
    FROM task WHERE process_id=$1 AND organization_id=$2 ORDER BY created_at,id`,[processId,identity.organizationId]);
  return {...found.rows[0],steps:steps.rows,tasks:tasks.rows};
}

export async function transitionProcess(pool: Pool,identity: Identity,processId: string,raw: unknown,
  key: string | undefined,correlationId: string) {
  const v=object(raw); only(v,['unitId','stepId','toStatus','expectedStatus','reason']);
  const unitId=uuid(v.unitId,'Unidade'),stepId=uuid(v.stepId,'Etapa'); uuid(processId,'Processo');
  const toStatus=status(v.toStatus),expectedStatus=status(v.expectedStatus);
  const reason=v.reason===undefined?null:(typeof v.reason==='string' && v.reason.trim().length<=500?v.reason.trim():null);
  if (v.reason!==undefined && !reason) throw new HttpError(400,'INVALID_BODY','Motivo inválido');
  if (toStatus==='WAIVED' && !reason) throw new HttpError(400,'REASON_REQUIRED','Justificativa necessária');
  const input={processId,unitId,stepId,toStatus,expectedStatus,reason};
  return idempotent(pool,identity,`POST /api/v1/processes/${processId}/transitions`,key,input,
    db=>requireUnit(db,identity,unitId,'process.transition'),async db=>{
      // A process row serializes all transitions in this workflow, including separate steps.
      const process=await db.query(`SELECT id,status FROM process WHERE id=$1 AND organization_id=$2 AND unit_id=$3 FOR UPDATE`,
        [processId,identity.organizationId,unitId]);
      if (!process.rowCount) throw new HttpError(404,'PROCESS_NOT_FOUND','Processo não encontrado');
      if (process.rows[0].status!=='ACTIVE') throw new HttpError(409,'PROCESS_NOT_ACTIVE','Processo não está ativo');
      const steps=await db.query(`SELECT ps.id,ps.status,sd.code,sd.prerequisites,sd.completion_rule,
        sd.assigned_role,sd.sla_hours,sd.sort_order FROM process_step ps
        JOIN workflow_step_definition sd ON sd.id=ps.definition_step_id AND sd.organization_id=ps.organization_id
        WHERE ps.process_id=$1 AND ps.organization_id=$2 ORDER BY sd.sort_order,sd.id`,[processId,identity.organizationId]);
      const current=steps.rows.find(x=>x.id===stepId);
      if (!current) throw new HttpError(404,'STEP_NOT_FOUND','Etapa não encontrada');
      await requireRole(db,identity,unitId,current.assigned_role);
      if (current.status!==expectedStatus) throw new HttpError(409,'STATUS_CHANGED','Estado da etapa mudou');
      const byCode=new Map<string,string>(steps.rows.map(x=>[x.code,x.status]));
      const prerequisitesMet=Array.isArray(current.prerequisites) &&
        current.prerequisites.every((code: unknown)=>typeof code==='string' && byCode.get(code)==='COMPLETED');
      if (toStatus==='COMPLETED' && current.completion_rule && Object.keys(current.completion_rule).length)
        throw new HttpError(409,'EVIDENCE_REQUIRED','Esta etapa requer evidência configurada');
      try { transitionStep(current.status as StepStatus,toStatus,prerequisitesMet,true); }
      catch(error) {
        const code=error instanceof Error?error.message:'INVALID_TRANSITION';
        throw new HttpError(409,code,code==='PREREQUISITE_NOT_MET'?'Pré-condição não atendida':'Transição inválida');
      }
      await db.query(`UPDATE process_step SET status=$3,completed_at=CASE WHEN $3='COMPLETED' THEN now() ELSE NULL END
        WHERE id=$1 AND organization_id=$2`,[stepId,identity.organizationId,toStatus]);
      await db.query(`INSERT INTO process_transition(organization_id,process_step_id,from_status,to_status,reason,actor_user_id,correlation_id)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,[identity.organizationId,stepId,current.status,toStatus,reason,identity.userId,correlationId]);
      if (['COMPLETED','WAIVED','CANCELLED'].includes(toStatus)) {
        const closed=await db.query(`UPDATE task SET status='DONE' WHERE process_step_id=$1 AND organization_id=$2 AND status='OPEN'
          RETURNING id`,[stepId,identity.organizationId]);
        for (const task of closed.rows) await record(db,identity,unitId,'task.closed','task',task.id,
          {taskId:task.id,processId,stepId},correlationId);
      }
      const readyStepIds: string[]=[];
      if (toStatus==='COMPLETED') {
        byCode.set(current.code,'COMPLETED');
        for (const next of steps.rows) {
          if (next.status!=='NOT_STARTED' || !Array.isArray(next.prerequisites) || !next.prerequisites.length) continue;
          if (!next.prerequisites.every((code: unknown)=>typeof code==='string' && byCode.get(code)==='COMPLETED')) continue;
          await db.query(`UPDATE process_step SET status='READY' WHERE id=$1 AND organization_id=$2`,[next.id,identity.organizationId]);
          await db.query(`INSERT INTO process_transition(organization_id,process_step_id,from_status,to_status,actor_user_id,correlation_id)
            VALUES($1,$2,'NOT_STARTED','READY',$3,$4)`,[identity.organizationId,next.id,identity.userId,correlationId]);
          const created=await db.query(`INSERT INTO task(organization_id,unit_id,process_id,process_step_id,kind,assigned_role,due_at,context)
            VALUES($1,$2,$3,$4,'PROCESS_STEP',$5,CASE WHEN $6::integer IS NULL THEN NULL ELSE now()+($6||' hours')::interval END,$7)
            ON CONFLICT DO NOTHING RETURNING id`,[identity.organizationId,unitId,processId,next.id,next.assigned_role,next.sla_hours,JSON.stringify({stepCode:next.code})]);
          if (created.rowCount) await record(db,identity,unitId,'task.created','task',created.rows[0].id,
            {taskId:created.rows[0].id,processId,stepId:next.id},correlationId);
          readyStepIds.push(next.id);
        }
      }
      const remaining=await db.query(`SELECT count(*) AS n FROM process_step WHERE process_id=$1 AND organization_id=$2
        AND status NOT IN ('COMPLETED','WAIVED')`,[processId,identity.organizationId]);
      const processStatus=Number(remaining.rows[0].n)===0?'COMPLETED':'ACTIVE';
      if (processStatus==='COMPLETED') await db.query(`UPDATE process SET status='COMPLETED' WHERE id=$1`,[processId]);
      await record(db,identity,unitId,'process.step.transitioned','process',processId,
        {processId,stepId,fromStatus:current.status,toStatus,readyStepIds,processStatus},correlationId);
      return {processId,stepId,status:toStatus,readyStepIds,processStatus};
    });
}
