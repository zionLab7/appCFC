import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { authenticate, HttpError, isUuid, OidcVerifier, singleHeader } from './auth.js';
import { createStudent, getStudent, getStudentTimeline, listStudents, searchStudents } from './students.js';
import { createPackage, createDraftVersion, deleteDraft, listCatalog, publishVersion, updateDraft } from './catalog.js';
import { activateEnrollment, createEnrollment, getEnrollment } from './enrollments.js';
import { getProcess, transitionProcess } from './processes.js';

const port = Number(process.env.PORT ?? 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a valid TCP port');
if (process.env.NODE_ENV !== 'development' && !process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://gpcfc:gpcfc_dev_only@localhost:5432/gpcfc', max: 10 });
const verifier = new OidcVerifier(process.env.OIDC_ISSUER ?? '', process.env.OIDC_AUDIENCE ?? '', process.env.OIDC_JWKS_URI ?? '');

function reply(res: ServerResponse, status: number, value: unknown, correlationId: string) {
  res.writeHead(status, {'content-type':'application/json; charset=utf-8','x-correlation-id':correlationId,'cache-control':'no-store'});
  res.end(JSON.stringify(value));
}
async function jsonBody(req: IncomingMessage): Promise<unknown> {
  if (singleHeader(req,'content-type')?.split(';')[0].trim() !== 'application/json')
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json');
  let bytes = 0, body = '';
  for await (const chunk of req) {
    bytes += (chunk as Buffer).length;
    if (bytes > 16_384) throw new HttpError(413, 'BODY_TOO_LARGE', 'Corpo excede 16 KB');
    body += (chunk as Buffer).toString('utf8');
  }
  try { return JSON.parse(body) as unknown; }
  catch { throw new HttpError(400, 'INVALID_JSON', 'JSON inválido'); }
}

const server = createServer(async (req,res) => {
  const supplied = singleHeader(req,'x-correlation-id');
  const correlationId = isUuid(supplied) ? supplied : randomUUID();
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (process.env.NODE_ENV==='development' && req.method==='GET' && url.pathname==='/app') {
      const page=await readFile(new URL('../../web/index.html',import.meta.url));
      res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'});
      return res.end(page);
    }
    if (req.method==='GET' && url.pathname==='/health/live') return reply(res,200,{status:'ok'},correlationId);
    if (req.method==='GET' && url.pathname==='/health/ready') {
      try {
        const migration = await pool.query(`SELECT 1 FROM schema_migrations WHERE filename='011_catalog_scope_and_student_search.sql'`);
        if (!migration.rowCount) throw new Error('Schema is not current');
        return reply(res,200,{status:'ready'},correlationId);
      } catch { return reply(res,503,{code:'DATABASE_UNAVAILABLE',message:'Banco ou migrations indisponíveis',correlationId},correlationId); }
    }
    if (req.method==='GET' && url.pathname==='/api/v1/meta')
      return reply(res,200,{product:'GP CFC',apiVersion:'v1',stage:'sprint-1'},correlationId);
    if (!url.pathname.startsWith('/api/v1/')) throw new HttpError(404,'NOT_FOUND','Rota não encontrada');
    // Authenticate before resolving object IDs; inaccessible students are indistinguishable from missing ones.
    const identity = await authenticate(req,pool,verifier);
    if (url.pathname==='/api/v1/students' && req.method==='GET')
      return reply(res,200,await listStudents(pool,identity,url.searchParams),correlationId);
    if (url.pathname==='/api/v1/students' && req.method==='POST') {
      const response = await createStudent(pool,identity,await jsonBody(req),singleHeader(req,'idempotency-key'),correlationId);
      return reply(res,201,response,correlationId);
    }
    if (url.pathname==='/api/v1/students/search' && req.method==='POST')
      return reply(res,200,await searchStudents(pool,identity,await jsonBody(req)),correlationId);
    const timeline = /^\/api\/v1\/students\/([^/]+)\/timeline$/.exec(url.pathname);
    if (timeline && req.method==='GET') return reply(res,200,await getStudentTimeline(pool,identity,timeline[1],url.searchParams),correlationId);
    const match = /^\/api\/v1\/students\/([^/]+)$/.exec(url.pathname);
    if (match && req.method==='GET') return reply(res,200,await getStudent(pool,identity,match[1]),correlationId);
    if (url.pathname==='/api/v1/catalog/packages' && req.method==='GET')
      return reply(res,200,await listCatalog(pool,identity,url.searchParams.get('unitId') ?? ''),correlationId);
    if (url.pathname==='/api/v1/catalog/packages' && req.method==='POST')
      return reply(res,201,await createPackage(pool,identity,await jsonBody(req),singleHeader(req,'idempotency-key'),correlationId),correlationId);
    const packageVersions=/^\/api\/v1\/catalog\/packages\/([^/]+)\/versions$/.exec(url.pathname);
    if (packageVersions && req.method==='POST')
      return reply(res,201,await createDraftVersion(pool,identity,packageVersions[1],await jsonBody(req),singleHeader(req,'idempotency-key'),correlationId),correlationId);
    const versionPublish=/^\/api\/v1\/catalog\/versions\/([^/]+)\/publish$/.exec(url.pathname);
    if (versionPublish && req.method==='POST')
      return reply(res,200,await publishVersion(pool,identity,versionPublish[1],await jsonBody(req),singleHeader(req,'idempotency-key'),correlationId),correlationId);
    const version=/^\/api\/v1\/catalog\/versions\/([^/]+)$/.exec(url.pathname);
    if (version && req.method==='PATCH')
      return reply(res,200,await updateDraft(pool,identity,version[1],await jsonBody(req),singleHeader(req,'idempotency-key'),correlationId),correlationId);
    if (version && req.method==='DELETE')
      return reply(res,200,await deleteDraft(pool,identity,version[1],url.searchParams.get('unitId') ?? '',singleHeader(req,'idempotency-key'),correlationId),correlationId);
    if (url.pathname==='/api/v1/enrollments' && req.method==='POST')
      return reply(res,201,await createEnrollment(pool,identity,await jsonBody(req),singleHeader(req,'idempotency-key'),correlationId),correlationId);
    const enrollmentActivate=/^\/api\/v1\/enrollments\/([^/]+)\/activate$/.exec(url.pathname);
    if (enrollmentActivate && req.method==='POST')
      return reply(res,200,await activateEnrollment(pool,identity,enrollmentActivate[1],await jsonBody(req),singleHeader(req,'idempotency-key'),correlationId),correlationId);
    const enrollment=/^\/api\/v1\/enrollments\/([^/]+)$/.exec(url.pathname);
    if (enrollment && req.method==='GET') return reply(res,200,await getEnrollment(pool,identity,enrollment[1]),correlationId);
    const processTransitions=/^\/api\/v1\/processes\/([^/]+)\/transitions$/.exec(url.pathname);
    if (processTransitions && req.method==='POST')
      return reply(res,200,await transitionProcess(pool,identity,processTransitions[1],await jsonBody(req),singleHeader(req,'idempotency-key'),correlationId),correlationId);
    const processMatch=/^\/api\/v1\/processes\/([^/]+)$/.exec(url.pathname);
    if (processMatch && req.method==='GET') return reply(res,200,await getProcess(pool,identity,processMatch[1]),correlationId);
    throw new HttpError(404,'NOT_FOUND','Rota não encontrada');
  } catch (error) {
    if (error instanceof HttpError)
      return reply(res,error.status,{code:error.code,message:error.message,correlationId},correlationId);
    if (error && typeof error==='object' && 'code' in error && error.code==='23505')
      return reply(res,409,{code:'ALREADY_EXISTS',message:'Registro já existe',correlationId},correlationId);
    process.stderr.write(JSON.stringify({level:'error',correlationId,reason:'request_failed',errorCode:(error && typeof error==='object' && 'code' in error) ? String(error.code) : 'unknown'})+'\n');
    return reply(res,500,{code:'INTERNAL_ERROR',message:'Falha inesperada',correlationId},correlationId);
  }
});
server.listen(port,'127.0.0.1',()=>process.stdout.write(JSON.stringify({level:'info',message:'API ready',port})+'\n'));
for(const signal of ['SIGINT','SIGTERM'] as const)
  process.on(signal,()=>{server.close(); void pool.end();});
