import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createPackage,createDraftVersion,listCatalog,publishVersion,updateDraft } from '../../src/catalog.js';
import { createStudent,getStudentTimeline } from '../../src/students.js';
import { activateEnrollment,createEnrollment,getEnrollment } from '../../src/enrollments.js';
import { getProcess,transitionProcess } from '../../src/processes.js';

const url=process.env.GP_CFC_TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Use a disposable _test database');
const pool=new pg.Pool({connectionString:url});
const key=()=>randomUUID(),corr=()=>randomUUID();

test('Postgres: catálogo imutável, matrícula atômica, processo e transição concorrente',async()=>{
  const org=randomUUID(),unit=randomUUID(),otherUnit=randomUUID(),user=randomUUID(),role=randomUUID();
  const identity={organizationId:org,userId:user};
  try {
    await pool.query(`INSERT INTO organization(id,name) VALUES($1,'Fluxo sintético')`,[org]);
    await pool.query(`INSERT INTO unit(id,organization_id,code,name) VALUES($1,$3,'ONE','Uma'),($2,$3,'TWO','Outra')`,[unit,otherUnit,org]);
    await pool.query(`INSERT INTO app_user(id,email,display_name) VALUES($1,$2,'Operador sintético')`,[user,`${user}@example.invalid`]);
    await pool.query(`INSERT INTO role(id,organization_id,code,name) VALUES($1,$2,'SECRETARY','Secretaria')`,[role,org]);
    await pool.query(`INSERT INTO role_permission(role_id,permission_code) VALUES
      ($1,'student.read'),($1,'student.write'),($1,'catalog.read'),($1,'catalog.write'),($1,'catalog.publish'),
      ($1,'enrollment.read'),($1,'enrollment.write'),($1,'process.read'),($1,'process.transition')`,[role]);
    await pool.query(`INSERT INTO user_unit_membership(organization_id,unit_id,user_id,role_id) VALUES($1,$2,$3,$4)`,[org,unit,user,role]);
    const wf=randomUUID(),wfVersion=randomUUID();
    await pool.query(`INSERT INTO workflow_definition(id,organization_id,code,service_type) VALUES($1,$2,'DEMO','TEST_SERVICE')`,[wf,org]);
    await pool.query(`INSERT INTO workflow_version(id,organization_id,definition_id,version) VALUES($1,$2,$3,1)`,[wfVersion,org,wf]);
    for(const [code,order,prereq] of [['FIRST',10,[]],['SECOND',20,['FIRST']]] as const)
      await pool.query(`INSERT INTO workflow_step_definition(organization_id,workflow_version_id,code,label,stage,sort_order,prerequisites,assigned_role)
        VALUES($1,$2,$3,$3,'DEMO',$4,$5,'SECRETARY')`,[org,wfVersion,code,order,JSON.stringify(prereq)]);
    await pool.query(`UPDATE workflow_version SET published_at=now() WHERE id=$1`,[wfVersion]);
    const student=await createStudent(pool,identity,{unitId:unit,fullName:'Aluno Sintético'},key(),corr());
    const pkg=await createPackage(pool,identity,{unitId:unit,code:`T_${org.replaceAll('-','').slice(0,16)}`,
      productName:'Produto teste',serviceType:'TEST_SERVICE',packageName:'Pacote teste',priceCents:1000,
      terms:{demo:true},items:[{itemType:'LESSON',quantity:2}]},key(),corr());
    const sharedPackage=randomUUID(),sharedVersion=randomUUID();
    await pool.query(`INSERT INTO package(id,organization_id,product_id,name)
      SELECT $1,organization_id,product_id,'Pacote compartilhado legado' FROM package WHERE id=$2`,[sharedPackage,pkg.packageId]);
    await pool.query(`INSERT INTO package_version(id,organization_id,package_id,version,price_cents)
      VALUES($1,$2,$3,1,1000)`,[sharedVersion,org,sharedPackage]);
    await pool.query(`INSERT INTO package_item(organization_id,package_version_id,item_type,quantity)
      VALUES($1,$2,'LESSON',1)`,[org,sharedVersion]);
    await assert.rejects(publishVersion(pool,identity,sharedVersion,{unitId:unit},key(),corr()),{code:'ACCESS_DENIED'});
    await assert.rejects(createPackage(pool,identity,{unitId:otherUnit,code:'DENIED',productName:'Teste',
      serviceType:'TEST_SERVICE',packageName:'Teste',priceCents:1000,items:[{itemType:'LESSON',quantity:1}]},key(),corr()),{code:'ACCESS_DENIED'});
    await updateDraft(pool,identity,pkg.versionId,{unitId:unit,priceCents:1200,terms:{demo:true},items:[{itemType:'LESSON',quantity:3}]},key(),corr());
    const published=await publishVersion(pool,identity,pkg.versionId,{unitId:unit},key(),corr());
    assert.equal(published.status,'PUBLISHED');
    await assert.rejects(updateDraft(pool,identity,pkg.versionId,{unitId:unit,priceCents:1,items:[{itemType:'LESSON',quantity:1}]},key(),corr()),{code:'VERSION_PUBLISHED'});
    await assert.rejects(pool.query(`UPDATE package_version SET price_cents=1 WHERE id=$1`,[pkg.versionId]),/immutable/);
    await assert.rejects(pool.query(`UPDATE package_item SET quantity=1 WHERE package_version_id=$1`,[pkg.versionId]),/immutable/);
    const draft=await createEnrollment(pool,identity,{unitId:unit,studentId:student.id,packageVersionId:pkg.versionId,agreedPriceCents:1200},key(),corr());
    assert.equal(draft.packageSnapshot.items[0].quantity,3);
    await assert.rejects(createEnrollment(pool,identity,{unitId:otherUnit,studentId:student.id,packageVersionId:pkg.versionId,agreedPriceCents:1200},key(),corr()),{code:'ACCESS_DENIED'});
    const v2=await createDraftVersion(pool,identity,pkg.packageId,{unitId:unit,priceCents:2000,items:[{itemType:'LESSON',quantity:5}]},key(),corr());
    await publishVersion(pool,identity,v2.versionId,{unitId:unit},key(),corr());
    const snapshot=await pool.query(`SELECT package_snapshot,agreed_price_cents FROM enrollment WHERE id=$1`,[draft.id]);
    assert.equal(Number(snapshot.rows[0].agreed_price_cents),1200);
    assert.equal(snapshot.rows[0].package_snapshot.items[0].quantity,3);
    const activateKey=key();
    const [first,repeated]=await Promise.all([
      activateEnrollment(pool,identity,draft.id,{unitId:unit,demoActivationConfirmed:true},activateKey,corr()),
      activateEnrollment(pool,identity,draft.id,{unitId:unit,demoActivationConfirmed:true},activateKey,corr())
    ]);
    assert.deepEqual(first,repeated);
    const process=await getProcess(pool,identity,first.processId);
    assert.deepEqual(process.steps.map((x:{status:string})=>x.status),['READY','NOT_STARTED']);
    assert.equal(process.tasks.length,1);
    await assert.rejects(pool.query(`UPDATE process SET unit_id=$1 WHERE id=$2`,[otherUnit,first.processId]),/process links/);
    const [step1,step2]=process.steps;
    await assert.rejects(pool.query(`UPDATE task SET unit_id=$1 WHERE process_step_id=$2`,[otherUnit,step1.id]),/task step/);
    await pool.query(`UPDATE process_step SET status='READY' WHERE id=$1`,[step2.id]);
    await assert.rejects(transitionProcess(pool,identity,first.processId,
      {unitId:unit,stepId:step2.id,toStatus:'COMPLETED',expectedStatus:'READY'},key(),corr()),{code:'PREREQUISITE_NOT_MET'});
    await pool.query(`UPDATE process_step SET status='NOT_STARTED' WHERE id=$1`,[step2.id]);
    const results=await Promise.allSettled([0,1].map(()=>transitionProcess(pool,identity,first.processId,
      {unitId:unit,stepId:step1.id,toStatus:'COMPLETED',expectedStatus:'READY'},key(),corr())));
    assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(results.filter(x=>x.status==='rejected').length,1);
    const advanced=await getProcess(pool,identity,first.processId);
    assert.deepEqual(advanced.steps.map((x:{status:string})=>x.status),['COMPLETED','READY']);
    assert.equal(advanced.tasks.length,2);
    const fact=await pool.query(`SELECT count(*) AS n FROM outbox_event WHERE aggregate_id=$1 AND type='process.step.transitioned.v1'`,[first.processId]);
    assert.equal(Number(fact.rows[0].n),1);
    const trace=await pool.query(`SELECT actor_user_id,correlation_id FROM outbox_event
      WHERE aggregate_id=$1 AND type='process.step.transitioned.v1'`,[first.processId]);
    assert.equal(trace.rows[0].actor_user_id,user); assert.ok(trace.rows[0].correlation_id);
    await transitionProcess(pool,identity,first.processId,{unitId:unit,stepId:step2.id,toStatus:'COMPLETED',expectedStatus:'READY'},key(),corr());
    assert.equal((await getProcess(pool,identity,first.processId)).status,'COMPLETED');
    const timeline=await getStudentTimeline(pool,identity,student.id,new URLSearchParams({limit:'2'}));
    assert.equal(timeline.hasMore,true);
    assert.deepEqual(timeline.data.map((x:{action:string})=>x.action),['process.step.transitioned','process.step.transitioned']);
    const earlier=await getStudentTimeline(pool,identity,student.id,new URLSearchParams({limit:'2',cursor:timeline.nextCursor!}));
    assert.equal(earlier.data.some((x:{action:string})=>x.action==='enrollment.activated'),true);
    const other=await createPackage(pool,identity,{unitId:unit,code:`O_${org.replaceAll('-','').slice(0,16)}`,
      productName:'Outro produto',serviceType:'NO_WORKFLOW',packageName:'Outro pacote',priceCents:500,
      items:[{itemType:'LESSON',quantity:1}]},key(),corr());
    await publishVersion(pool,identity,other.versionId,{unitId:unit},key(),corr());
    const orphan=await createEnrollment(pool,identity,{unitId:unit,studentId:student.id,packageVersionId:other.versionId,agreedPriceCents:500},key(),corr());
    await assert.rejects(activateEnrollment(pool,identity,orphan.id,{unitId:unit,demoActivationConfirmed:true},key(),corr()),{code:'WORKFLOW_NOT_CONFIGURED'});
    const rolled=await pool.query(`SELECT e.status,count(p.id) AS processes FROM enrollment e LEFT JOIN process p ON p.enrollment_id=e.id WHERE e.id=$1 GROUP BY e.id`,[orphan.id]);
    assert.equal(rolled.rows[0].status,'DRAFT'); assert.equal(Number(rolled.rows[0].processes),0);
    const secondUser=randomUUID();
    await pool.query(`INSERT INTO app_user(id,email,display_name) VALUES($1,$2,'Outro operador')`,[secondUser,`${secondUser}@example.invalid`]);
    await pool.query(`INSERT INTO user_unit_membership(organization_id,unit_id,user_id,role_id) VALUES($1,$2,$3,$4)`,[org,otherUnit,secondUser,role]);
    const secondIdentity={organizationId:org,userId:secondUser};
    const studentOther=await createStudent(pool,secondIdentity,{unitId:otherUnit,fullName:'Aluno de outra unidade'},key(),corr());
    assert.deepEqual((await listCatalog(pool,secondIdentity,otherUnit)).data.map((x:{packageId:string})=>x.packageId),[sharedPackage]);
    await assert.rejects(createDraftVersion(pool,secondIdentity,pkg.packageId,{unitId:otherUnit,priceCents:1200,items:[{itemType:'LESSON',quantity:1}]},key(),corr()),{code:'PACKAGE_NOT_FOUND'});
    await assert.rejects(createEnrollment(pool,secondIdentity,
      {unitId:otherUnit,studentId:studentOther.id,packageVersionId:pkg.versionId,agreedPriceCents:1200},key(),corr()),{code:'PACKAGE_VERSION_NOT_FOUND'});
    const pkgOther=await createPackage(pool,secondIdentity,{unitId:otherUnit,code:`B_${org.replaceAll('-','').slice(0,16)}`,
      productName:'Produto outra unidade',serviceType:'TEST_SERVICE',packageName:'Pacote outra unidade',priceCents:1200,
      items:[{itemType:'LESSON',quantity:3}]},key(),corr());
    await publishVersion(pool,secondIdentity,pkgOther.versionId,{unitId:otherUnit},key(),corr());
    assert.equal((await listCatalog(pool,secondIdentity,otherUnit)).data.length,2);
    assert.equal((await listCatalog(pool,identity,unit)).data.some((x:{packageId:string})=>x.packageId===pkgOther.packageId),false);
    await assert.rejects(pool.query(`INSERT INTO enrollment(organization_id,unit_id,student_id,package_version_id,agreed_price_cents,package_snapshot)
      VALUES($1,$2,$3,$4,1200,'{}')`,[org,otherUnit,studentOther.id,pkg.versionId]),/outside enrollment unit/);
    const enrollmentOther=await createEnrollment(pool,secondIdentity,
      {unitId:otherUnit,studentId:studentOther.id,packageVersionId:pkgOther.versionId,agreedPriceCents:1200},key(),corr());
    const activeOther=await activateEnrollment(pool,secondIdentity,enrollmentOther.id,{unitId:otherUnit,demoActivationConfirmed:true},key(),corr());
    await assert.rejects(getEnrollment(pool,identity,enrollmentOther.id),{code:'ENROLLMENT_NOT_FOUND'});
    await assert.rejects(getProcess(pool,identity,activeOther.processId),{code:'PROCESS_NOT_FOUND'});
    const org2=randomUUID(),unit3=randomUUID(),role3=randomUUID();
    await pool.query(`INSERT INTO organization(id,name) VALUES($1,'Outro tenant sintético')`,[org2]);
    await pool.query(`INSERT INTO unit(id,organization_id,code,name) VALUES($1,$2,'THREE','Terceira')`,[unit3,org2]);
    await pool.query(`INSERT INTO role(id,organization_id,code,name) VALUES($1,$2,'SECRETARY','Secretaria')`,[role3,org2]);
    await pool.query(`INSERT INTO role_permission(role_id,permission_code) VALUES($1,'catalog.read'),($1,'enrollment.read'),($1,'process.read'),($1,'enrollment.write')`,[role3]);
    await pool.query(`INSERT INTO user_unit_membership(organization_id,unit_id,user_id,role_id) VALUES($1,$2,$3,$4)`,[org2,unit3,user,role3]);
    const otherTenant={organizationId:org2,userId:user};
    assert.deepEqual((await listCatalog(pool,otherTenant,unit3)).data,[]);
    await assert.rejects(getEnrollment(pool,otherTenant,draft.id),{code:'ENROLLMENT_NOT_FOUND'});
    await assert.rejects(getProcess(pool,otherTenant,first.processId),{code:'PROCESS_NOT_FOUND'});
    await assert.rejects(createEnrollment(pool,otherTenant,
      {unitId:unit3,studentId:student.id,packageVersionId:pkg.versionId,agreedPriceCents:1200},key(),corr()),{code:'STUDENT_NOT_FOUND'});
    await pool.query(`UPDATE user_unit_membership SET active=false WHERE unit_id=$1 AND user_id=$2`,[unit,user]);
    await assert.rejects(getEnrollment(pool,identity,draft.id),{code:'ENROLLMENT_NOT_FOUND'});
    await assert.rejects(getProcess(pool,identity,first.processId),{code:'PROCESS_NOT_FOUND'});
  } finally { await pool.end(); }
});
