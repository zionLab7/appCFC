import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { HttpError, isUuid, type Identity } from './auth.js';

export type Database = Pool | PoolClient;
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400,'INVALID_BODY','Corpo inválido');
  return value as Record<string, unknown>;
}
export function only(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(k => !keys.includes(k))) throw new HttpError(400,'INVALID_BODY','Campo não reconhecido');
}
export function uuid(value: unknown, name: string): string {
  if (!isUuid(value)) throw new HttpError(400,'INVALID_BODY',`${name} inválido`);
  return value;
}
export function shortText(value: unknown, name: string, max=120): string {
  if (typeof value !== 'string' || value.trim().length < 2 || value.trim().length > max)
    throw new HttpError(400,'INVALID_BODY',`${name} inválido`);
  return value.trim();
}
export function cents(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number)<0) throw new HttpError(400,'INVALID_PRICE','Preço inválido');
  return value as number;
}
export async function requireUnit(db: Database, identity: Identity, unitId: string, permission: string): Promise<void> {
  const found=await db.query(`SELECT 1 FROM user_unit_membership m
    JOIN role_permission rp ON rp.role_id=m.role_id
    JOIN unit un ON un.id=m.unit_id AND un.organization_id=m.organization_id
    JOIN app_user u ON u.id=m.user_id
    WHERE m.organization_id=$1 AND m.unit_id=$2 AND m.user_id=$3 AND m.active
      AND un.active AND u.status='ACTIVE' AND rp.permission_code=$4 LIMIT 1`,
    [identity.organizationId,unitId,identity.userId,permission]);
  if (!found.rowCount) throw new HttpError(403,'ACCESS_DENIED','Sem permissão nesta unidade');
}
export async function requireRole(db: Database, identity: Identity, unitId: string, role: string | null): Promise<void> {
  if (!role) return;
  const found=await db.query(`SELECT 1 FROM user_unit_membership m JOIN role r ON r.id=m.role_id
    WHERE m.organization_id=$1 AND m.unit_id=$2 AND m.user_id=$3 AND m.active
      AND r.code IN ($4,'MANAGER') LIMIT 1`,[identity.organizationId,unitId,identity.userId,role]);
  if (!found.rowCount) throw new HttpError(403,'ACCESS_DENIED','Papel não autorizado para esta etapa');
}
export async function record(db: Database, identity: Identity, unitId: string, action: string,
  entityType: string, entityId: string, payload: unknown, correlationId: string): Promise<void> {
  await db.query(`INSERT INTO audit_event(organization_id,unit_id,actor_user_id,action,entity_type,entity_id,after_json,correlation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[identity.organizationId,unitId,identity.userId,action,entityType,entityId,JSON.stringify(payload),correlationId]);
  await db.query(`INSERT INTO outbox_event(organization_id,unit_id,type,aggregate_type,aggregate_id,payload,actor_user_id,correlation_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[identity.organizationId,unitId,`${action}.v1`,entityType,entityId,JSON.stringify(payload),identity.userId,correlationId]);
}
export async function idempotent<T>(pool: Pool, identity: Identity, endpoint: string, key: string | undefined,
  input: unknown, authorize: (db: PoolClient)=>Promise<void>, operation: (db: PoolClient)=>Promise<T>,statusCode=200): Promise<T> {
  if (!key || !/^[\w.:-]{8,128}$/.test(key)) throw new HttpError(400,'INVALID_IDEMPOTENCY_KEY','Idempotency-Key inválida');
  const hash=createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const db=await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(`INSERT INTO idempotency_record(organization_id,actor_key,endpoint,idempotency_key,request_hash)
      VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,[identity.organizationId,identity.userId,endpoint,key,hash]);
    const prior=await db.query(`SELECT request_hash,response_json FROM idempotency_record
      WHERE organization_id=$1 AND actor_key=$2 AND endpoint=$3 AND idempotency_key=$4 FOR UPDATE`,
      [identity.organizationId,identity.userId,endpoint,key]);
    if (prior.rows[0].request_hash!==hash) throw new HttpError(409,'IDEMPOTENCY_CONFLICT','Chave usada com outros dados');
    await authorize(db);
    if (prior.rows[0].response_json!==null) {
      await db.query('COMMIT');
      return prior.rows[0].response_json as T;
    }
    const result=await operation(db);
    await db.query(`UPDATE idempotency_record SET status_code=$6,response_json=$5
      WHERE organization_id=$1 AND actor_key=$2 AND endpoint=$3 AND idempotency_key=$4`,
      [identity.organizationId,identity.userId,endpoint,key,JSON.stringify(result),statusCode]);
    await db.query('COMMIT');
    return result;
  } catch(error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
