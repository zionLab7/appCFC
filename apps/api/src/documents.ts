import { createHash, randomUUID } from 'node:crypto';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import type { Pool } from 'pg';
import { HttpError, type Identity } from './auth.js';
import { idempotent, object, only, record, requireUnit, shortText, uuid } from './operations.js';

const bucket=process.env.S3_BUCKET ?? 'gp-cfc-dev';
const endpoint=process.env.S3_ENDPOINT;
const storage=new S3Client({region:process.env.S3_REGION ?? 'us-east-1',endpoint,
  forcePathStyle:!!endpoint,credentials:endpoint ? {
    accessKeyId:process.env.S3_ACCESS_KEY ?? '',secretAccessKey:process.env.S3_SECRET_KEY ?? ''
  } : undefined});
const mimeTypes=new Set(['application/pdf','image/jpeg','image/png']);
const kinds=new Set(['IDENTITY','RESIDENCE','MEDICAL','CONTRACT','OTHER']);

export async function requestDocument(pool: Pool, identity: Identity, raw: unknown, key: string | undefined, correlationId: string) {
  const v=object(raw); only(v,['unitId','ownerType','ownerId','kind']);
  const unitId=uuid(v.unitId,'Unidade'),ownerId=uuid(v.ownerId,'Dono');
  if (v.ownerType!=='STUDENT' && v.ownerType!=='ENROLLMENT') throw new HttpError(400,'INVALID_OWNER','Dono inválido');
  if (typeof v.kind!=='string' || !kinds.has(v.kind) || (v.kind==='CONTRACT' && v.ownerType!=='ENROLLMENT'))
    throw new HttpError(400,'INVALID_DOCUMENT_KIND','Tipo de documento inválido');
  const input={unitId,ownerType:v.ownerType,ownerId,kind:v.kind};
  return idempotent(pool,identity,'POST /api/v1/documents',key,input,
    db=>requireUnit(db,identity,unitId,'document.write'),async db=>{
      const owner=v.ownerType==='STUDENT'
        ? await db.query(`SELECT 1 FROM student WHERE id=$1 AND organization_id=$2 AND home_unit_id=$3`,[ownerId,identity.organizationId,unitId])
        : await db.query(`SELECT 1 FROM enrollment WHERE id=$1 AND organization_id=$2 AND unit_id=$3`,[ownerId,identity.organizationId,unitId]);
      if (!owner.rowCount) throw new HttpError(404,'OWNER_NOT_FOUND','Aluno ou matrícula não encontrado nesta unidade');
      if (v.kind==='CONTRACT') {
        const existing=await db.query(`SELECT 1 FROM contract WHERE organization_id=$1 AND enrollment_id=$2`,[identity.organizationId,ownerId]);
        if (existing.rowCount) throw new HttpError(409,'CONTRACT_EXISTS','A matrícula já possui contrato');
      }
      const id=randomUUID();
      await db.query(`INSERT INTO document(id,organization_id,unit_id,owner_type,owner_id,kind)
        VALUES($1,$2,$3,$4,$5,$6)`,[id,identity.organizationId,unitId,v.ownerType,ownerId,v.kind]);
      if (v.kind==='CONTRACT') await db.query(`INSERT INTO contract(organization_id,enrollment_id,document_id,status)
        VALUES($1,$2,$3,'DRAFT')`,[identity.organizationId,ownerId,id]);
      await record(db,identity,unitId,'document.requested','document',id,{id,ownerType:v.ownerType,ownerId,kind:v.kind},correlationId);
      return {id,unitId,ownerType:v.ownerType,ownerId,kind:v.kind,status:'REQUESTED',currentVersion:0};
    },201);
}

export async function listDocuments(pool: Pool,identity: Identity,unitId: string,ownerType: string,ownerId: string) {
  uuid(unitId,'Unidade');uuid(ownerId,'Dono');
  if (!['STUDENT','ENROLLMENT'].includes(ownerType)) throw new HttpError(400,'INVALID_OWNER','Dono inválido');
  await requireUnit(pool,identity,unitId,'document.read');
  const result=await pool.query(`SELECT d.id,d.kind,d.status,d.current_version AS "currentVersion",
    d.review_reason AS "reviewReason",d.created_at AS "createdAt",d.reviewed_at AS "reviewedAt",
    dv.mime_type AS "mimeType",dv.sha256,dv.size_bytes::integer AS "sizeBytes"
    FROM document d LEFT JOIN document_version dv ON dv.document_id=d.id AND dv.organization_id=d.organization_id AND dv.version=d.current_version
    WHERE d.organization_id=$1 AND d.unit_id=$2 AND d.owner_type=$3 AND d.owner_id=$4
    ORDER BY d.created_at DESC,d.id DESC LIMIT 100`,[identity.organizationId,unitId,ownerType,ownerId]);
  return {data:result.rows};
}

async function findDocument(pool: Pool,identity: Identity,id: string,unitId: string,permission: string) {
  uuid(id,'Documento');uuid(unitId,'Unidade');
  await requireUnit(pool,identity,unitId,permission);
  const found=await pool.query(`SELECT id,kind,status,current_version FROM document
    WHERE id=$1 AND organization_id=$2 AND unit_id=$3`,[id,identity.organizationId,unitId]);
  if (!found.rowCount) throw new HttpError(404,'DOCUMENT_NOT_FOUND','Documento não encontrado');
  return found.rows[0];
}

export async function uploadDocument(pool: Pool,identity: Identity,id: string,raw: unknown,key: string|undefined,correlationId:string) {
  const v=object(raw);only(v,['unitId','mimeType','contentBase64']);
  const unitId=uuid(v.unitId,'Unidade');uuid(id,'Documento');
  if (typeof v.mimeType!=='string' || !mimeTypes.has(v.mimeType)) throw new HttpError(400,'INVALID_MIME','Formato inválido');
  if (typeof v.contentBase64!=='string' || v.contentBase64.length>7_000_000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(v.contentBase64))
    throw new HttpError(400,'INVALID_CONTENT','Arquivo inválido');
  const body=Buffer.from(v.contentBase64,'base64');
  if (!body.length || body.length>5_000_000 || body.toString('base64')!==v.contentBase64)
    throw new HttpError(400,'INVALID_CONTENT','Arquivo inválido');
  if (v.mimeType==='application/pdf' && body.subarray(0,5).toString()!=='%PDF-') throw new HttpError(400,'INVALID_CONTENT','PDF inválido');
  if (v.mimeType==='image/png' && !body.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))
    throw new HttpError(400,'INVALID_CONTENT','PNG inválido');
  if (v.mimeType==='image/jpeg' && !body.subarray(0,3).equals(Buffer.from('ffd8ff','hex')))
    throw new HttpError(400,'INVALID_CONTENT','JPEG inválido');
  const sha256=createHash('sha256').update(body).digest('hex');
  const input={id,unitId,mimeType:v.mimeType,sha256,sizeBytes:body.length};
  return idempotent(pool,identity,`POST /api/v1/documents/${id}/versions`,key,input,
    db=>requireUnit(db,identity,unitId,'document.write'),async db=>{
      const found=await db.query(`SELECT current_version FROM document WHERE id=$1 AND organization_id=$2 AND unit_id=$3 FOR UPDATE`,
        [id,identity.organizationId,unitId]);
      if (!found.rowCount) throw new HttpError(404,'DOCUMENT_NOT_FOUND','Documento não encontrado');
      const version=Number(found.rows[0].current_version)+1;
      const objectKey=`${identity.organizationId}/${unitId}/${id}/${version}-${randomUUID()}`;
      await storage.send(new PutObjectCommand({Bucket:bucket,Key:objectKey,Body:body,ContentType:v.mimeType as string}));
      try {
        await db.query(`INSERT INTO document_version(organization_id,document_id,version,object_key,sha256,size_bytes,mime_type)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,[identity.organizationId,id,version,objectKey,sha256,body.length,v.mimeType]);
        await db.query(`UPDATE document SET status='SUBMITTED',current_version=$2,reviewed_at=NULL,reviewed_by=NULL,review_reason=NULL WHERE id=$1`,[id,version]);
        await record(db,identity,unitId,'document.submitted','document',id,{id,version,sha256,sizeBytes:body.length,mimeType:v.mimeType},correlationId);
      } catch(error) { await storage.send(new DeleteObjectCommand({Bucket:bucket,Key:objectKey})).catch(()=>undefined);throw error; }
      return {id,status:'SUBMITTED',version,sha256,sizeBytes:body.length,mimeType:v.mimeType};
    },201);
}

export async function reviewDocument(pool: Pool,identity: Identity,id: string,raw:unknown,key:string|undefined,correlationId:string) {
  const v=object(raw);only(v,['unitId','decision','reason']);
  const unitId=uuid(v.unitId,'Unidade');uuid(id,'Documento');
  if (v.decision!=='ACCEPTED' && v.decision!=='REJECTED') throw new HttpError(400,'INVALID_DECISION','Decisão inválida');
  const reason=v.decision==='REJECTED'?shortText(v.reason,'Motivo',500):null;
  if (v.decision==='ACCEPTED' && v.reason!==undefined) throw new HttpError(400,'INVALID_BODY','Motivo inesperado');
  return idempotent(pool,identity,`POST /api/v1/documents/${id}/review`,key,{id,unitId,decision:v.decision,reason},
    db=>requireUnit(db,identity,unitId,'document.review'),async db=>{
      const found=await db.query(`SELECT current_version,status FROM document WHERE id=$1 AND organization_id=$2 AND unit_id=$3 FOR UPDATE`,
        [id,identity.organizationId,unitId]);
      if (!found.rowCount) throw new HttpError(404,'DOCUMENT_NOT_FOUND','Documento não encontrado');
      if (found.rows[0].status!=='SUBMITTED' || !found.rows[0].current_version)
        throw new HttpError(409,'DOCUMENT_NOT_SUBMITTED','Documento não está aguardando revisão');
      await db.query(`UPDATE document SET status=$2,reviewed_at=now(),reviewed_by=$3,review_reason=$4 WHERE id=$1`,
        [id,v.decision,identity.userId,reason]);
      await record(db,identity,unitId,'document.reviewed','document',id,
        {id,version:found.rows[0].current_version,decision:v.decision,reason},correlationId);
      return {id,status:v.decision,version:found.rows[0].current_version,reason};
    });
}

export async function downloadDocument(pool: Pool,identity: Identity,id:string,unitId:string,correlationId:string) {
  await findDocument(pool,identity,id,unitId,'document.read');
  const found=await pool.query(`SELECT dv.object_key,dv.mime_type,dv.sha256,dv.size_bytes FROM document d
    JOIN document_version dv ON dv.document_id=d.id AND dv.organization_id=d.organization_id AND dv.version=d.current_version
    WHERE d.id=$1 AND d.organization_id=$2 AND d.unit_id=$3`,[id,identity.organizationId,unitId]);
  if (!found.rowCount) throw new HttpError(404,'DOCUMENT_VERSION_NOT_FOUND','Arquivo não encontrado');
  const row=found.rows[0];
  const response=await storage.send(new GetObjectCommand({Bucket:bucket,Key:row.object_key}));
  if (!response.Body) throw new HttpError(502,'STORAGE_UNAVAILABLE','Arquivo indisponível');
  const bytes=Buffer.from(await response.Body.transformToByteArray());
  if (bytes.length!==Number(row.size_bytes) || createHash('sha256').update(bytes).digest('hex')!==row.sha256)
    throw new HttpError(502,'DOCUMENT_INTEGRITY_ERROR','Arquivo não passou na verificação de integridade');
  await pool.query(`INSERT INTO audit_event(organization_id,unit_id,actor_user_id,action,entity_type,entity_id,after_json,correlation_id)
    VALUES($1,$2,$3,'document.downloaded','document',$4,$5,$6)`,
    [identity.organizationId,unitId,identity.userId,id,JSON.stringify({id,sha256:row.sha256}),correlationId]);
  return {bytes,mimeType:row.mime_type as string};
}
