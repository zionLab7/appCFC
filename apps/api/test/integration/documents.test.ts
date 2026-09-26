import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const url=process.env.GP_CFC_TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Use a disposable _test database');
const objects=new Map<string,Buffer>();
const storageServer=createServer(async(req,res)=>{
  const key=new URL(req.url ?? '/', 'http://storage.invalid').pathname;
  if(req.method==='PUT') {
    const chunks:Buffer[]=[];for await(const chunk of req) chunks.push(Buffer.from(chunk));
    objects.set(key,Buffer.concat(chunks));res.writeHead(200);return res.end();
  }
  if(req.method==='GET') {const value=objects.get(key);res.writeHead(value?200:404);return res.end(value);}
  if(req.method==='DELETE') {objects.delete(key);res.writeHead(204);return res.end();}
  res.writeHead(405);res.end();
});
await new Promise<void>(resolve=>storageServer.listen(0,'127.0.0.1',resolve));
const address=storageServer.address();
if (!address || typeof address==='string') throw new Error('No mock storage port');
process.env.S3_ENDPOINT=`http://127.0.0.1:${address.port}`;
process.env.S3_ACCESS_KEY='synthetic';process.env.S3_SECRET_KEY='synthetic';
const {requestDocument,listDocuments,uploadDocument,reviewDocument,downloadDocument}=await import('../../src/documents.js');
const pool=new pg.Pool({connectionString:url});

test('Postgres + S3: versões, revisão, integridade, idempotência e isolamento',async()=>{
  const org=randomUUID(),unit=randomUUID(),other=randomUUID(),user=randomUUID(),role=randomUUID(),person=randomUUID(),student=randomUUID();
  const identity={organizationId:org,userId:user};
  const k=()=>randomUUID(),c=()=>randomUUID();
  try {
    await pool.query(`INSERT INTO organization(id,name) VALUES($1,'Documentos sintéticos')`,[org]);
    await pool.query(`INSERT INTO unit(id,organization_id,code,name) VALUES($1,$3,'ONE','Uma'),($2,$3,'TWO','Outra')`,[unit,other,org]);
    await pool.query(`INSERT INTO app_user(id,email,display_name) VALUES($1,$2,'Operador sintético')`,[user,`${user}@example.invalid`]);
    await pool.query(`INSERT INTO role(id,organization_id,code,name) VALUES($1,$2,'MANAGER','Gestor')`,[role,org]);
    await pool.query(`INSERT INTO role_permission(role_id,permission_code) VALUES
      ($1,'document.read'),($1,'document.write'),($1,'document.review')`,[role]);
    await pool.query(`INSERT INTO user_unit_membership(organization_id,unit_id,user_id,role_id) VALUES($1,$2,$3,$4)`,[org,unit,user,role]);
    await pool.query(`INSERT INTO person(id,organization_id,full_name) VALUES($1,$2,'Aluno sintético')`,[person,org]);
    await pool.query(`INSERT INTO student(id,organization_id,person_id,home_unit_id) VALUES($1,$2,$3,$4)`,[student,org,person,unit]);
    await assert.rejects(requestDocument(pool,identity,{unitId:other,ownerType:'STUDENT',ownerId:student,kind:'IDENTITY'},k(),c()),{code:'ACCESS_DENIED'});
    const requestKey=k(),requested=await requestDocument(pool,identity,{unitId:unit,ownerType:'STUDENT',ownerId:student,kind:'IDENTITY'},requestKey,c());
    assert.deepEqual(await requestDocument(pool,identity,{unitId:unit,ownerType:'STUDENT',ownerId:student,kind:'IDENTITY'},requestKey,c()),requested);
    const body=Buffer.from('%PDF-1.4\n% synthetic only\n%%EOF');
    const input={unitId:unit,mimeType:'application/pdf',contentBase64:body.toString('base64')};
    const uploadKey=k(),uploaded=await uploadDocument(pool,identity,requested.id,input,uploadKey,c());
    assert.deepEqual(await uploadDocument(pool,identity,requested.id,input,uploadKey,c()),uploaded);
    assert.equal(uploaded.version,1);
    const downloaded=await downloadDocument(pool,identity,requested.id,unit,c());
    assert.deepEqual(downloaded.bytes,body);
    assert.equal((await listDocuments(pool,identity,unit,'STUDENT',student)).data[0].status,'SUBMITTED');
    await assert.rejects(reviewDocument(pool,identity,requested.id,{unitId:other,decision:'ACCEPTED'},k(),c()),{code:'ACCESS_DENIED'});
    const reviewed=await reviewDocument(pool,identity,requested.id,{unitId:unit,decision:'REJECTED',reason:'Arquivo sintético ilegível'},k(),c());
    assert.equal(reviewed.status,'REJECTED');
    await assert.rejects(reviewDocument(pool,identity,requested.id,{unitId:unit,decision:'ACCEPTED'},k(),c()),{code:'DOCUMENT_NOT_SUBMITTED'});
    const second=await uploadDocument(pool,identity,requested.id,input,k(),c());
    assert.equal(second.version,2);
    assert.equal((await reviewDocument(pool,identity,requested.id,{unitId:unit,decision:'ACCEPTED'},k(),c())).status,'ACCEPTED');
    const events=await pool.query(`SELECT action FROM audit_event WHERE entity_id=$1 ORDER BY occurred_at`,[requested.id]);
    assert.deepEqual(events.rows.map((x:{action:string})=>x.action),
      ['document.requested','document.submitted','document.downloaded','document.reviewed','document.submitted','document.reviewed']);
    const outbox=await pool.query(`SELECT count(*)::integer AS n FROM outbox_event WHERE aggregate_id=$1`,[requested.id]);
    assert.equal(outbox.rows[0].n,5);
    const version=await pool.query(`SELECT object_key FROM document_version WHERE document_id=$1 AND version=2`,[requested.id]);
    const objectKey=`/gp-cfc-dev/${version.rows[0].object_key}`;
    objects.set(objectKey,Buffer.from('tampered'));
    await assert.rejects(downloadDocument(pool,identity,requested.id,unit,c()),{code:'DOCUMENT_INTEGRITY_ERROR'});
    await assert.rejects(pool.query(`UPDATE document_version SET sha256=$2 WHERE document_id=$1 AND version=1`,[requested.id,'0'.repeat(64)]),/immutable/);
  } finally { await pool.end();storageServer.close(); }
});
