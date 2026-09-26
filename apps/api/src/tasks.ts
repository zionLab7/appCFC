import type { Pool } from 'pg';
import { HttpError, isUuid, type Identity } from './auth.js';
import { requireUnit, uuid } from './operations.js';

type TaskCursor = { dueAt: string; id: string };
function parseCursor(value: string | null): TaskCursor | null {
  if (!value) return null;
  try {
    if (value.length > 300 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const cursor: unknown = JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
    if (!cursor || typeof cursor !== 'object' || !('dueAt' in cursor) || !('id' in cursor)
      || typeof cursor.dueAt !== 'string' || !Number.isFinite(Date.parse(cursor.dueAt)) || !isUuid(cursor.id)) throw new Error();
    return {dueAt:cursor.dueAt,id:cursor.id};
  } catch { throw new HttpError(400,'INVALID_CURSOR','Cursor inválido'); }
}

export async function listTasks(pool: Pool, identity: Identity, params: URLSearchParams) {
  const unitId=uuid(params.get('unitId'),'Unidade');
  const view=params.get('view') ?? 'open', owner=params.get('owner') ?? 'unit';
  if (!['open','overdue','all'].includes(view) || !['unit','mine'].includes(owner))
    throw new HttpError(400,'INVALID_TASK_FILTER','Filtro de tarefas inválido');
  const requestedLimit=params.get('limit') ?? '30';
  if (!/^[1-9]\d*$/.test(requestedLimit) || Number(requestedLimit)>100)
    throw new HttpError(400,'INVALID_LIMIT','Limite inválido');
  const limit=Number(requestedLimit),cursor=parseCursor(params.get('cursor'));
  await requireUnit(pool,identity,unitId,'task.read');
  const result=await pool.query(`SELECT t.id,t.unit_id AS "unitId",t.process_id AS "processId",
    pr.student_id AS "studentId",pe.full_name AS "studentName",
    t.process_step_id AS "stepId",sd.label AS "stepLabel",t.kind,t.status,
    t.assigned_role AS "assignedRole",t.assigned_user_id AS "assignedUserId",
    t.due_at AS "dueAt",t.created_at AS "createdAt",
    coalesce(t.due_at,'9999-12-31 23:59:59+00'::timestamptz)::text AS "sortDueAt"
    FROM task t
    LEFT JOIN process pr ON pr.id=t.process_id AND pr.organization_id=t.organization_id
    LEFT JOIN student s ON s.id=pr.student_id AND s.organization_id=pr.organization_id
    LEFT JOIN person pe ON pe.id=s.person_id AND pe.organization_id=s.organization_id
    LEFT JOIN process_step ps ON ps.id=t.process_step_id AND ps.organization_id=t.organization_id
    LEFT JOIN workflow_step_definition sd ON sd.id=ps.definition_step_id AND sd.organization_id=ps.organization_id
    WHERE t.organization_id=$1 AND t.unit_id=$2
      AND ($4::text='all' OR t.status='OPEN')
      AND ($4::text<>'overdue' OR (t.due_at IS NOT NULL AND t.due_at<now()))
      AND ($6::timestamptz IS NULL OR
        (coalesce(t.due_at,'9999-12-31 23:59:59+00'::timestamptz),t.id)>($6::timestamptz,$7::uuid))
      AND EXISTS (SELECT 1 FROM user_unit_membership m
        JOIN role r ON r.id=m.role_id AND r.organization_id=m.organization_id
        JOIN role_permission rp ON rp.role_id=m.role_id
        JOIN unit un ON un.id=m.unit_id AND un.organization_id=m.organization_id
        JOIN app_user u ON u.id=m.user_id
        WHERE m.organization_id=t.organization_id AND m.unit_id=t.unit_id AND m.user_id=$3
          AND m.active AND un.active AND u.status='ACTIVE' AND rp.permission_code='task.read'
          AND (r.code='MANAGER' OR t.assigned_user_id=$3 OR
            (t.assigned_user_id IS NULL AND (t.assigned_role IS NULL OR t.assigned_role=r.code)))
          AND ($5::text='unit' OR t.assigned_user_id=$3 OR
            (t.assigned_user_id IS NULL AND t.assigned_role=r.code)))
    ORDER BY coalesce(t.due_at,'9999-12-31 23:59:59+00'::timestamptz),t.id
    LIMIT $8`,[identity.organizationId,unitId,identity.userId,view,owner,cursor?.dueAt ?? null,cursor?.id ?? null,limit+1]);
  const hasMore=result.rows.length>limit,page=result.rows.slice(0,limit),last=page.at(-1);
  return {data:page.map(({sortDueAt,...row})=>row),hasMore,
    ...(hasMore && last ? {nextCursor:Buffer.from(JSON.stringify({dueAt:last.sortDueAt,id:last.id})).toString('base64url')} : {})};
}
