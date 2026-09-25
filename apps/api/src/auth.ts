import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Pool } from 'pg';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isUuid(value: unknown): value is string { return typeof value === 'string' && uuid.test(value); }
export function singleHeader(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return typeof v === 'string' ? v : undefined;
}
type JwtHeader = { alg?: string; kid?: string; typ?: string };
type Claims = { iss?: string; sub?: string; aud?: string | string[]; exp?: number; nbf?: number; iat?: number };
type JwkSet = { keys: (JsonWebKey & { kid?: string; alg?: string; use?: string })[] };
const decode = (part: string): unknown => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

export class OidcVerifier {
  private cache?: { keys: JwkSet['keys']; expires: number };
  constructor(private issuer: string, private audience: string, private jwksUri: string) {
    if (!issuer || !audience || !jwksUri) throw new Error('OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URI are required');
    const expected = new URL(issuer);
    const jwks = new URL(jwksUri);
    if (process.env.NODE_ENV !== 'development' && (expected.protocol !== 'https:' || jwks.protocol !== 'https:'))
      throw new Error('OIDC URLs must use HTTPS outside development');
  }
  private async keys(): Promise<JwkSet['keys']> {
    if (this.cache && this.cache.expires > Date.now()) return this.cache.keys;
    try {
      const response = await fetch(this.jwksUri, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) throw new Error('JWKS unavailable');
      const body: unknown = await response.json();
      if (!body || typeof body !== 'object' || !('keys' in body) || !Array.isArray(body.keys)) throw new Error('Invalid JWKS');
      this.cache = { keys: body.keys as JwkSet['keys'], expires: Date.now() + 60_000 };
      return this.cache.keys;
    } catch { throw new HttpError(503, 'IDENTITY_PROVIDER_UNAVAILABLE', 'Provedor de identidade indisponível'); }
  }
  async verify(token: string): Promise<{ issuer: string; subject: string }> {
    try {
      if (token.length > 12_000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) throw new Error('Invalid JWT');
      const [h, p, s] = token.split('.');
      const header = decode(h) as JwtHeader;
      const claims = decode(p) as Claims;
      if (!['RS256', 'ES256'].includes(header.alg ?? '') || !header.kid || !claims || !claims.sub) throw new Error('Unsupported JWT');
      let keys = await this.keys();
      let key = keys.find(k => k.kid === header.kid && (!k.alg || k.alg === header.alg) && (!k.use || k.use === 'sig'));
      if (!key) {
        this.cache = undefined; keys = await this.keys();
        key = keys.find(k => k.kid === header.kid && (!k.alg || k.alg === header.alg) && (!k.use || k.use === 'sig'));
      }
      if (!key) throw new Error('Unknown signing key');
      const publicKey = createPublicKey({ key, format: 'jwk' });
      const valid = verify('sha256', Buffer.from(`${h}.${p}`),
        header.alg === 'ES256' ? { key: publicKey, dsaEncoding: 'ieee-p1363' } : publicKey,
        Buffer.from(s, 'base64url'));
      const now = Math.floor(Date.now() / 1000);
      if (!valid || claims.iss !== this.issuer || !(typeof claims.aud === 'string' ? claims.aud === this.audience : claims.aud?.includes(this.audience))
        || !Number.isInteger(claims.exp) || claims.exp! <= now || claims.exp! > now + 86400
        || (claims.nbf !== undefined && (!Number.isInteger(claims.nbf) || claims.nbf > now + 30))
        || (claims.iat !== undefined && (!Number.isInteger(claims.iat) || claims.iat > now + 30))) throw new Error('Invalid claims');
      return { issuer: claims.iss!, subject: claims.sub };
    } catch(error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(401, 'INVALID_TOKEN', 'Token de acesso inválido');
    }
  }
}

export type Identity = { userId: string; organizationId: string };
export async function authenticate(req: IncomingMessage, pool: Pool, verifier: OidcVerifier): Promise<Identity> {
  const authorization = singleHeader(req, 'authorization');
  if (!authorization?.startsWith('Bearer ')) throw new HttpError(401, 'AUTH_REQUIRED', 'Autenticação necessária');
  const organizationId = singleHeader(req, 'x-organization-id');
  if (!isUuid(organizationId)) throw new HttpError(400, 'INVALID_ORGANIZATION', 'Organização inválida');
  const { issuer, subject } = await verifier.verify(authorization.slice(7));
  const result = await pool.query(`SELECT u.id FROM user_identity i JOIN app_user u ON u.id=i.user_id
    WHERE i.issuer=$1 AND i.subject=$2 AND u.status='ACTIVE' AND EXISTS (
      SELECT 1 FROM user_unit_membership m JOIN unit un ON un.id=m.unit_id AND un.organization_id=m.organization_id
      WHERE m.user_id=u.id AND m.organization_id=$3 AND m.active AND un.active)`, [issuer, subject, organizationId]);
  if (!result.rowCount) throw new HttpError(403, 'ACCESS_DENIED', 'Usuário sem acesso');
  return { userId: result.rows[0].id, organizationId };
}
