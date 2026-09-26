import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { HttpError, isUuid, type Identity } from './auth.js';

export type StudentInput = { unitId: string; fullName: string; phone?: string; documentKind?: 'CPF'; documentNumber?: string };
function validCpf(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  for (const length of [9, 10]) {
    const digit = (11 - [...cpf.slice(0, length)].reduce((sum, x, i) => sum + Number(x) * (length + 1 - i), 0) % 11) % 11;
    if (digit !== Number(cpf[length])) return false;
  }
  return true;
}
export function parseStudentInput(body: unknown): StudentInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'INVALID_BODY', 'Corpo inválido');
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some(k => !['unitId', 'fullName', 'phone', 'documentKind', 'documentNumber'].includes(k)) || !isUuid(value.unitId)
    || typeof value.fullName !== 'string' || value.fullName.trim().length < 2 || value.fullName.trim().length > 200)
    throw new HttpError(400, 'INVALID_BODY', 'Nome ou unidade inválidos');
  const fullName = value.fullName.trim().replace(/\s+/g, ' ');
  let phone: string | undefined;
  if (value.phone !== undefined) {
    if (typeof value.phone !== 'string' || !/^[\d\s()+.-]+$/.test(value.phone)) throw new HttpError(400,'INVALID_PHONE','Telefone inválido');
    phone=value.phone.replace(/\D/g,'');
    if (phone.length<10 || phone.length>13) throw new HttpError(400,'INVALID_PHONE','Telefone inválido');
  }
  if (value.documentKind === undefined && value.documentNumber === undefined) return { unitId: value.unitId, fullName, ...(phone ? {phone} : {}) };
  if (value.documentKind !== 'CPF' || typeof value.documentNumber !== 'string')
    throw new HttpError(400, 'INVALID_DOCUMENT', 'Documento deve ser CPF válido ou omitido');
  const documentNumber = value.documentNumber.replace(/\D/g, '');
  if (!validCpf(documentNumber)) throw new HttpError(400, 'INVALID_DOCUMENT', 'CPF inválido');
  return { unitId: value.unitId, fullName, ...(phone ? {phone} : {}), documentKind: 'CPF', documentNumber };
}
async function permitted(db: Pool | PoolClient, identity: Identity, unitId: string, permission: string): Promise<boolean> {
  const result = await db.query(`SELECT 1 FROM user_unit_membership m JOIN app_user u ON u.id=m.user_id
    JOIN role_permission rp ON rp.role_id=m.role_id
    JOIN unit un ON un.id=m.unit_id AND un.organization_id=m.organization_id
    WHERE m.organization_id=$1 AND m.unit_id=$2 AND m.user_id=$3 AND m.active
      AND u.status='ACTIVE' AND un.active AND rp.permission_code=$4 LIMIT 1`,
    [identity.organizationId, unitId, identity.userId, permission]);
  return (result.rowCount ?? 0) > 0;
}
export async function createStudent(pool: Pool, identity: Identity, raw: unknown, key: string | undefined, correlationId: string) {
  if (!key || !/^[\w.:-]{8,128}$/.test(key)) throw new HttpError(400, 'INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key inválida');
  const input = parseStudentInput(raw);
  const endpoint = 'POST /api/v1/students';
  const requestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`INSERT INTO idempotency_record(organization_id,actor_key,endpoint,idempotency_key,request_hash)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
    [identity.organizationId, identity.userId, endpoint, key, requestHash]);
    const previous = await client.query(`SELECT request_hash, response_json FROM idempotency_record
      WHERE organization_id=$1 AND actor_key=$2 AND endpoint=$3 AND idempotency_key=$4 FOR UPDATE`,
    [identity.organizationId, identity.userId, endpoint, key]);
    if (previous.rows[0].request_hash !== requestHash) throw new HttpError(409, 'IDEMPOTENCY_CONFLICT', 'Chave usada com outros dados');
    if (!(await permitted(client, identity, input.unitId, 'student.write'))) throw new HttpError(403, 'ACCESS_DENIED', 'Sem permissão nesta unidade');
    if (previous.rows[0].response_json) {
      await client.query('COMMIT');
      return previous.rows[0].response_json;
    }
    const personId = randomUUID(), studentId = randomUUID();
    await client.query(`INSERT INTO person(id,organization_id,full_name,document_kind,document_number)
      VALUES($1,$2,$3,$4,$5)`, [personId, identity.organizationId, input.fullName, input.documentKind ?? null, input.documentNumber ?? null]);
    await client.query(`INSERT INTO student(id,organization_id,person_id,home_unit_id)
      VALUES($1,$2,$3,$4)`, [studentId, identity.organizationId, personId, input.unitId]);
    if (input.phone) await client.query(`INSERT INTO person_contact(organization_id,person_id,kind,value,is_primary)
      VALUES($1,$2,'PHONE',$3,true)`, [identity.organizationId,personId,input.phone]);
    await client.query(`INSERT INTO audit_event(organization_id,unit_id,actor_user_id,action,entity_type,entity_id,after_json,correlation_id)
      VALUES($1,$2,$3,'student.created','student',$4,$5,$6)`, [identity.organizationId,input.unitId,identity.userId,studentId,
      JSON.stringify({ fullName: input.fullName, documentKind: input.documentKind ?? null }),correlationId]);
    await client.query(`INSERT INTO outbox_event(organization_id,unit_id,type,aggregate_type,aggregate_id,payload,actor_user_id,correlation_id)
      VALUES($1,$2,'student.created.v1','student',$3,$4,$5,$6)`,
      [identity.organizationId,input.unitId,studentId,JSON.stringify({studentId,unitId:input.unitId}),identity.userId,correlationId]);
    const response = { id: studentId, fullName: input.fullName, unitId: input.unitId };
    await client.query(`UPDATE idempotency_record SET status_code=201,response_json=$5
      WHERE organization_id=$1 AND actor_key=$2 AND endpoint=$3 AND idempotency_key=$4`,
    [identity.organizationId,identity.userId,endpoint,key,JSON.stringify(response)]);
    await client.query('COMMIT');
    return response;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505')
      throw new HttpError(409, 'DOCUMENT_EXISTS', 'Documento já cadastrado nesta organização');
    throw error;
  } finally { client.release(); }
}

type Cursor = { createdAt: string; id: string };
function parseCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    if (value.length > 300 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const cursor: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (!cursor || typeof cursor !== 'object' || !('createdAt' in cursor) || !('id' in cursor)
      || typeof cursor.createdAt !== 'string' || !Number.isFinite(Date.parse(cursor.createdAt)) || !isUuid(cursor.id)) throw new Error();
    return { createdAt: cursor.createdAt, id: cursor.id };
  } catch { throw new HttpError(400, 'INVALID_CURSOR', 'Cursor inválido'); }
}
export async function listStudents(pool: Pool, identity: Identity, params: URLSearchParams) {
  const unitId = params.get('unitId');
  if (unitId && !isUuid(unitId)) throw new HttpError(400, 'INVALID_UNIT', 'Unidade inválida');
  const requestedLimit = params.get('limit') ?? '30';
  if (!/^[1-9]\d*$/.test(requestedLimit) || Number(requestedLimit) > 100) throw new HttpError(400, 'INVALID_LIMIT', 'Limite inválido');
  const limit = Number(requestedLimit), cursor = parseCursor(params.get('cursor'));
  return studentPage(pool,identity,unitId,limit,cursor,null);
}
async function studentPage(pool: Pool, identity: Identity, unitId: string | null, limit: number, cursor: Cursor | null, query: string | null) {
  const digits=query?.replace(/\D/g,'') ?? '';
  const escaped=query?.toLowerCase().replace(/[\\%_]/g,'\\$&') ?? null;
  const result = await pool.query(`SELECT s.id,p.full_name AS "fullName",s.home_unit_id AS "unitId",s.created_at::text AS "createdAt"
    FROM student s JOIN person p ON p.id=s.person_id AND p.organization_id=s.organization_id
    WHERE s.organization_id=$1 AND ($3::uuid IS NULL OR s.home_unit_id=$3)
      AND ($4::timestamptz IS NULL OR (s.created_at,s.id)>($4::timestamptz,$5::uuid))
      AND ($7::text IS NULL OR lower(p.full_name) LIKE '%' || $7 || '%' ESCAPE '\\'
        OR ($8::text IS NOT NULL AND p.document_number=$8)
        OR ($9::text IS NOT NULL AND EXISTS (SELECT 1 FROM person_contact pc
          WHERE pc.person_id=p.id AND pc.organization_id=p.organization_id AND pc.kind='PHONE'
            AND pc.value LIKE '%' || $9 || '%')))
      AND EXISTS (SELECT 1 FROM user_unit_membership m
        JOIN role_permission rp ON rp.role_id=m.role_id
        JOIN unit un ON un.id=m.unit_id AND un.organization_id=m.organization_id
        JOIN app_user u ON u.id=m.user_id
        WHERE m.organization_id=s.organization_id AND m.unit_id=s.home_unit_id
          AND m.user_id=$2 AND m.active AND un.active AND u.status='ACTIVE' AND rp.permission_code='student.read')
    ORDER BY s.created_at,s.id LIMIT $6`, [identity.organizationId,identity.userId,unitId,cursor?.createdAt ?? null,cursor?.id ?? null,limit+1,escaped,digits.length===11 ? digits : null,digits.length>=4 ? digits : null]);
  const hasMore = result.rows.length > limit;
  const page = result.rows.slice(0,limit);
  const data = page.map(({createdAt,...row}) => row);
  const last = page.at(-1);
  return { data, hasMore, ...(hasMore && last ? { nextCursor: Buffer.from(JSON.stringify({createdAt:last.createdAt,id:last.id})).toString('base64url') } : {}) };
}
export async function searchStudents(pool: Pool, identity: Identity, raw: unknown) {
  if (!raw || typeof raw!=='object' || Array.isArray(raw)) throw new HttpError(400,'INVALID_BODY','Corpo inválido');
  const v=raw as Record<string,unknown>;
  if (Object.keys(v).some(k=>!['unitId','query','limit','cursor'].includes(k))) throw new HttpError(400,'INVALID_BODY','Campos inválidos');
  if (v.unitId!==undefined && !isUuid(v.unitId)) throw new HttpError(400,'INVALID_UNIT','Unidade inválida');
  if (typeof v.query!=='string' || v.query.trim().length<2 || v.query.trim().length>100)
    throw new HttpError(400,'INVALID_QUERY','Busca deve ter de 2 a 100 caracteres');
  if (v.limit!==undefined && (!Number.isInteger(v.limit) || (v.limit as number)<1 || (v.limit as number)>100))
    throw new HttpError(400,'INVALID_LIMIT','Limite inválido');
  if (v.cursor!==undefined && typeof v.cursor!=='string') throw new HttpError(400,'INVALID_CURSOR','Cursor inválido');
  return studentPage(pool,identity,(v.unitId as string | undefined) ?? null,(v.limit as number | undefined) ?? 30,
    parseCursor((v.cursor as string | undefined) ?? null),v.query.trim());
}
export async function getStudent(pool: Pool, identity: Identity, studentId: string) {
  if (!isUuid(studentId)) throw new HttpError(400, 'INVALID_STUDENT_ID', 'ID de aluno inválido');
  const found = await pool.query(`SELECT s.id,p.full_name AS "fullName",s.home_unit_id AS "unitId",
    p.document_kind AS "documentKind",right(p.document_number,4) AS "documentLast4",s.created_at AS "createdAt"
    FROM student s JOIN person p ON p.id=s.person_id AND p.organization_id=s.organization_id
    WHERE s.id=$1 AND s.organization_id=$2 AND EXISTS (
      SELECT 1 FROM user_unit_membership m JOIN role_permission rp ON rp.role_id=m.role_id
      JOIN unit un ON un.id=m.unit_id AND un.organization_id=m.organization_id
      JOIN app_user u ON u.id=m.user_id
      WHERE m.organization_id=s.organization_id AND m.unit_id=s.home_unit_id
        AND m.user_id=$3 AND m.active AND un.active AND u.status='ACTIVE' AND rp.permission_code='student.read')`,
  [studentId,identity.organizationId,identity.userId]);
  if (!found.rowCount) throw new HttpError(404, 'STUDENT_NOT_FOUND', 'Aluno não encontrado');
  const enrollments = await pool.query(`SELECT e.id,e.status,e.unit_id AS "unitId",e.created_at AS "createdAt",
    pr.id AS "processId",pr.status AS "processStatus"
    FROM enrollment e LEFT JOIN process pr ON pr.enrollment_id=e.id AND pr.organization_id=e.organization_id
    WHERE e.student_id=$1 AND e.organization_id=$2 AND EXISTS (
      SELECT 1 FROM user_unit_membership m JOIN role_permission rp ON rp.role_id=m.role_id
      JOIN unit un ON un.id=m.unit_id AND un.organization_id=m.organization_id
      JOIN app_user u ON u.id=m.user_id
      WHERE m.organization_id=e.organization_id AND m.unit_id=e.unit_id AND m.user_id=$3
        AND m.active AND un.active AND u.status='ACTIVE' AND rp.permission_code='student.read')
    ORDER BY e.created_at DESC LIMIT 100`,[studentId,identity.organizationId,identity.userId]);
  const contacts=await pool.query(`SELECT pc.kind,pc.value,pc.is_primary AS "isPrimary" FROM person_contact pc
    JOIN student s ON s.person_id=pc.person_id AND s.organization_id=pc.organization_id
    WHERE s.id=$1 AND s.organization_id=$2 AND EXISTS (
      SELECT 1 FROM user_unit_membership m JOIN role_permission rp ON rp.role_id=m.role_id
      JOIN unit un ON un.id=m.unit_id AND un.organization_id=m.organization_id
      JOIN app_user u ON u.id=m.user_id
      WHERE m.organization_id=s.organization_id AND m.unit_id=s.home_unit_id AND m.user_id=$3
        AND m.active AND un.active AND u.status='ACTIVE' AND rp.permission_code='student.read')
    ORDER BY pc.is_primary DESC,pc.kind,pc.id`,[studentId,identity.organizationId,identity.userId]);
  return { ...found.rows[0], contacts: contacts.rows, enrollments: enrollments.rows };
}
export async function getStudentTimeline(pool: Pool, identity: Identity, studentId: string, params: URLSearchParams) {
  await getStudent(pool,identity,studentId);
  const requestedLimit=params.get('limit') ?? '30';
  if (!/^[1-9]\d*$/.test(requestedLimit) || Number(requestedLimit)>100) throw new HttpError(400,'INVALID_LIMIT','Limite inválido');
  const limit=Number(requestedLimit),cursor=parseCursor(params.get('cursor'));
  const result=await pool.query(`SELECT a.id,a.action,a.entity_type AS "entityType",a.entity_id AS "entityId",
    a.unit_id AS "unitId",a.actor_user_id AS "actorUserId",a.after_json AS details,
    a.occurred_at AS "occurredAt",a.occurred_at::text AS "cursorTime"
    FROM audit_event a WHERE a.organization_id=$1
      AND ($4::timestamptz IS NULL OR (a.occurred_at,a.id)<($4::timestamptz,$5::uuid))
      AND ((a.entity_type='student' AND a.entity_id=$2)
        OR (a.entity_type='enrollment' AND EXISTS (SELECT 1 FROM enrollment e
          WHERE e.id=a.entity_id AND e.organization_id=a.organization_id AND e.student_id=$2))
        OR (a.entity_type='process' AND EXISTS (SELECT 1 FROM process pr
          WHERE pr.id=a.entity_id AND pr.organization_id=a.organization_id AND pr.student_id=$2))
        OR (a.entity_type='task' AND EXISTS (SELECT 1 FROM task t JOIN process pr
          ON pr.id=t.process_id AND pr.organization_id=t.organization_id
          WHERE t.id=a.entity_id AND t.organization_id=a.organization_id AND pr.student_id=$2))
        OR (a.entity_type='lesson' AND EXISTS (SELECT 1 FROM lesson l
          WHERE l.id=a.entity_id AND l.organization_id=a.organization_id AND l.student_id=$2))
        OR (a.entity_type='credit_reservation' AND EXISTS (SELECT 1 FROM credit_reservation h
          JOIN lesson l ON l.id=h.lesson_id AND l.organization_id=h.organization_id
          WHERE h.id=a.entity_id AND h.organization_id=a.organization_id AND l.student_id=$2))
        OR (a.entity_type='credit_wallet' AND EXISTS (SELECT 1 FROM credit_wallet w JOIN enrollment e
          ON e.id=w.enrollment_id AND e.organization_id=w.organization_id
          WHERE w.id=a.entity_id AND w.organization_id=a.organization_id AND e.student_id=$2))
        OR (a.entity_type='receivable' AND EXISTS (SELECT 1 FROM receivable r JOIN enrollment e
          ON e.id=r.enrollment_id AND e.organization_id=r.organization_id
          WHERE r.id=a.entity_id AND r.organization_id=a.organization_id AND e.student_id=$2))
        OR (a.entity_type='payment' AND EXISTS (SELECT 1 FROM payment_allocation pa
          JOIN installment i ON i.id=pa.installment_id AND i.organization_id=pa.organization_id
          JOIN receivable r ON r.id=i.receivable_id AND r.organization_id=i.organization_id
          JOIN enrollment e ON e.id=r.enrollment_id AND e.organization_id=r.organization_id
          WHERE pa.payment_id=a.entity_id AND pa.organization_id=a.organization_id AND e.student_id=$2))
        OR (a.entity_type='payment_refund' AND EXISTS (SELECT 1 FROM payment_refund pr
          JOIN payment_allocation pa ON pa.payment_id=pr.payment_id AND pa.organization_id=pr.organization_id
          JOIN installment i ON i.id=pa.installment_id AND i.organization_id=pa.organization_id
          JOIN receivable r ON r.id=i.receivable_id AND r.organization_id=i.organization_id
          JOIN enrollment e ON e.id=r.enrollment_id AND e.organization_id=r.organization_id
          WHERE pr.id=a.entity_id AND pr.organization_id=a.organization_id AND e.student_id=$2)))
      AND EXISTS (SELECT 1 FROM user_unit_membership m JOIN role_permission rp ON rp.role_id=m.role_id
        JOIN unit un ON un.id=m.unit_id AND un.organization_id=m.organization_id JOIN app_user u ON u.id=m.user_id
        WHERE m.organization_id=a.organization_id AND m.unit_id=a.unit_id AND m.user_id=$3
          AND m.active AND un.active AND u.status='ACTIVE' AND rp.permission_code='student.read')
      AND (a.entity_type NOT IN ('credit_wallet','credit_reservation','receivable','payment','payment_refund','lesson') OR EXISTS (
        SELECT 1 FROM user_unit_membership m JOIN role_permission rp ON rp.role_id=m.role_id
        WHERE m.organization_id=a.organization_id AND m.unit_id=a.unit_id AND m.user_id=$3 AND m.active
          AND rp.permission_code=CASE WHEN a.entity_type IN ('credit_wallet','credit_reservation') THEN 'credit.read'
            WHEN a.entity_type='lesson' THEN 'lesson.read' ELSE 'finance.read' END))
    ORDER BY a.occurred_at DESC,a.id DESC LIMIT $6`,
    [identity.organizationId,studentId,identity.userId,cursor?.createdAt ?? null,cursor?.id ?? null,limit+1]);
  const hasMore=result.rows.length>limit,page=result.rows.slice(0,limit);
  const last=page.at(-1);
  return {data:page.map(({cursorTime,...row})=>row),hasMore,
    ...(hasMore && last ? {nextCursor:Buffer.from(JSON.stringify({createdAt:last.cursorTime,id:last.id})).toString('base64url')} : {})};
}
