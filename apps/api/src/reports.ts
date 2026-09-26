import type { Pool } from 'pg';
import { HttpError, type Identity } from './auth.js';
import { requireUnit, uuid } from './operations.js';

function safeCents(value: unknown): number {
  const cents=Number(value);
  if (!Number.isSafeInteger(cents)) throw new Error('Report total exceeds safe integer range');
  return cents;
}

export async function getOperationsReport(pool: Pool, identity: Identity, unitId: string) {
  uuid(unitId,'Unidade'); await requireUnit(pool,identity,unitId,'report.read');
  const [students,processes,steps,lessons,finance]=await Promise.all([
    pool.query(`SELECT count(*)::int AS total FROM student WHERE organization_id=$1 AND home_unit_id=$2`,
      [identity.organizationId,unitId]),
    pool.query(`SELECT status,count(*)::int AS total FROM process WHERE organization_id=$1 AND unit_id=$2
      GROUP BY status ORDER BY status`,[identity.organizationId,unitId]),
    pool.query(`SELECT sd.code,sd.label,ps.status,count(DISTINCT ps.process_id)::int AS total
      FROM process_step ps JOIN process p ON p.id=ps.process_id AND p.organization_id=ps.organization_id
      JOIN workflow_step_definition sd ON sd.id=ps.definition_step_id AND sd.organization_id=ps.organization_id
      WHERE p.organization_id=$1 AND p.unit_id=$2 AND p.status='ACTIVE'
        AND ps.status IN ('READY','IN_PROGRESS','WAITING_EXTERNAL','WAITING_STUDENT','BLOCKED')
      GROUP BY sd.code,sd.label,ps.status ORDER BY sd.code,ps.status`,[identity.organizationId,unitId]),
    pool.query(`SELECT status,count(*)::int AS total FROM lesson WHERE organization_id=$1 AND unit_id=$2
      GROUP BY status ORDER BY status`,[identity.organizationId,unitId]),
    pool.query(`SELECT coalesce(sum(r.amount_cents),0)::bigint AS billed,
      coalesce(sum(coalesce(paid.amount_cents,0)),0)::bigint AS paid
      FROM receivable r LEFT JOIN (
        SELECT i.receivable_id,sum(pa.amount_cents-coalesce(rev.amount_cents,0)) AS amount_cents
        FROM installment i JOIN payment_allocation pa ON pa.installment_id=i.id AND pa.organization_id=i.organization_id
        LEFT JOIN (SELECT allocation_id,sum(amount_cents) AS amount_cents FROM payment_allocation_reversal
          GROUP BY allocation_id) rev ON rev.allocation_id=pa.id
        GROUP BY i.receivable_id
      ) paid ON paid.receivable_id=r.id
      WHERE r.organization_id=$1 AND r.unit_id=$2 AND r.status<>'CANCELLED'`,
      [identity.organizationId,unitId])
  ]);
  const billedCents=safeCents(finance.rows[0].billed),paidCents=safeCents(finance.rows[0].paid);
  return {unitId,students:Number(students.rows[0].total),processes:processes.rows,steps:steps.rows,
    lessons:lessons.rows,finance:{billedCents,paidCents,outstandingCents:billedCents-paidCents}};
}

export async function getConsolidatedOperationsReport(pool: Pool,identity: Identity) {
  const allowed=await pool.query(`SELECT DISTINCT un.id,un.name FROM user_unit_membership m
    JOIN role_permission rp ON rp.role_id=m.role_id AND rp.permission_code='report.read'
    JOIN unit un ON un.id=m.unit_id AND un.organization_id=m.organization_id
    JOIN app_user u ON u.id=m.user_id
    WHERE m.organization_id=$1 AND m.user_id=$2 AND m.active AND un.active AND u.status='ACTIVE'
    ORDER BY un.name,un.id`,[identity.organizationId,identity.userId]);
  if (!allowed.rowCount) throw new HttpError(403,'ACCESS_DENIED','Sem permissão para relatórios');
  const reports=await Promise.all(allowed.rows.map(async unit=>({name:unit.name,
    ...await getOperationsReport(pool,identity,unit.id)})));
  const totals=reports.reduce((sum,report)=>({students:sum.students+report.students,
    lessons:sum.lessons+report.lessons.reduce((n,row)=>n+Number(row.total),0),
    billedCents:safeCents(sum.billedCents+report.finance.billedCents),
    paidCents:safeCents(sum.paidCents+report.finance.paidCents),
    outstandingCents:safeCents(sum.outstandingCents+report.finance.outstandingCents)}),
    {students:0,lessons:0,billedCents:0,paidCents:0,outstandingCents:0});
  return {unitCount:reports.length,totals,units:reports};
}
