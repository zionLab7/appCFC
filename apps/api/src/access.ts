import type { Pool } from 'pg';
import type { Identity } from './auth.js';

export async function listAccessibleUnits(pool: Pool,identity: Identity) {
  const result=await pool.query(`SELECT un.id,un.name,un.code,
    array_agg(DISTINCT r.code ORDER BY r.code) AS roles
    FROM user_unit_membership m
    JOIN unit un ON un.id=m.unit_id AND un.organization_id=m.organization_id
    JOIN role r ON r.id=m.role_id AND r.organization_id=m.organization_id
    JOIN app_user u ON u.id=m.user_id
    WHERE m.organization_id=$1 AND m.user_id=$2 AND m.active AND un.active AND u.status='ACTIVE'
    GROUP BY un.id,un.name,un.code ORDER BY un.name,un.id`,[identity.organizationId,identity.userId]);
  return {data:result.rows};
}
