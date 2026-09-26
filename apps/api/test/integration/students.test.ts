import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createStudent, getStudent, getStudentTimeline, listStudents, searchStudents } from '../../src/students.js';
import { listAccessibleUnits } from '../../src/access.js';

const url = process.env.GP_CFC_TEST_DATABASE_URL;
if (!url) throw new Error('Set GP_CFC_TEST_DATABASE_URL to a dedicated disposable PostgreSQL database');
if (!new URL(url).pathname.endsWith('_test')) throw new Error('Integration database name must end with _test');
const pool = new pg.Pool({connectionString:url});

test('Postgres: isolamento de unidade, paginação e cadastro idempotente concorrente', async () => {
  const org=randomUUID(), penha=randomUUID(), mooca=randomUUID(), user=randomUUID(), role=randomUUID();
  const identity={organizationId:org,userId:user};
  try {
    await pool.query(`INSERT INTO organization(id,name) VALUES($1,'Integração')`,[org]);
    await pool.query(`INSERT INTO unit(id,organization_id,code,name) VALUES($1,$3,'PENHA','Penha'),($2,$3,'MOOCA','Mooca')`,[penha,mooca,org]);
    await pool.query(`INSERT INTO app_user(id,email,display_name) VALUES($1,$2,'Operador')`,[user,`${user}@example.invalid`]);
    await pool.query(`INSERT INTO role(id,organization_id,code,name) VALUES($1,$2,'SECRETARY','Secretaria')`,[role,org]);
    await pool.query(`INSERT INTO permission(code,description) VALUES('student.read','Consulta'),('student.write','Cadastro') ON CONFLICT DO NOTHING`);
    await pool.query(`INSERT INTO role_permission(role_id,permission_code) VALUES($1,'student.read'),($1,'student.write')`,[role]);
    await pool.query(`INSERT INTO user_unit_membership(organization_id,unit_id,user_id,role_id) VALUES($1,$2,$3,$4)`,[org,penha,user,role]);
    assert.deepEqual((await listAccessibleUnits(pool,identity)).data.map((x:{id:string})=>x.id),[penha]);
    const firstInput={unitId:penha,fullName:'Aluno Teste Um',phone:'(11) 00000-0000',documentKind:'CPF',documentNumber:'52998224725'};
    const key=randomUUID();
    const [first,repeated] = await Promise.all([
      createStudent(pool,identity,firstInput,key,randomUUID()),
      createStudent(pool,identity,firstInput,key,randomUUID())
    ]);
    assert.deepEqual(first,repeated);
    const count=await pool.query(`SELECT (SELECT count(*) FROM audit_event WHERE entity_id=$1) AS audit,
      (SELECT count(*) FROM outbox_event WHERE aggregate_id=$1) AS outbox`,[first.id]);
    assert.equal(Number(count.rows[0].audit),1);
    assert.equal(Number(count.rows[0].outbox),1);
    await assert.rejects(createStudent(pool,identity,{...firstInput,fullName:'Outro Nome'},key,randomUUID()),{code:'IDEMPOTENCY_CONFLICT'});
    await assert.rejects(createStudent(pool,identity,firstInput,randomUUID(),randomUUID()),{code:'DOCUMENT_EXISTS'});
    await assert.rejects(createStudent(pool,identity,{unitId:mooca,fullName:'Sem Acesso'},randomUUID(),randomUUID()),{code:'ACCESS_DENIED'});
    const second=await createStudent(pool,identity,{unitId:penha,fullName:'Aluno Teste Dois'},randomUUID(),randomUUID());
    const page1=await listStudents(pool,identity,new URLSearchParams({limit:'1'}));
    assert.equal(page1.data.length,1);
    assert.equal(page1.hasMore,true);
    const page2=await listStudents(pool,identity,new URLSearchParams({limit:'1',cursor:page1.nextCursor!}));
    assert.equal(page2.data.length,1);
    assert.notEqual(page1.data[0].id,page2.data[0].id);
    assert.deepEqual(new Set([page1.data[0].id,page2.data[0].id]),new Set([first.id,second.id]));
    assert.equal((await getStudent(pool,identity,first.id)).documentLast4,'4725');
    assert.deepEqual((await getStudent(pool,identity,first.id)).contacts,[{kind:'PHONE',value:'11000000000',isPrimary:true}]);
    for(const query of ['Teste Um','529.982.247-25','00000-0000']) {
      const found=await searchStudents(pool,identity,{unitId:penha,query});
      assert.deepEqual(found.data.map((x:{id:string})=>x.id),[first.id]);
    }
    assert.deepEqual((await searchStudents(pool,identity,{unitId:mooca,query:'Teste'})).data,[]);
    const timeline=await getStudentTimeline(pool,identity,first.id,new URLSearchParams());
    assert.deepEqual(timeline.data.map((x:{action:string})=>x.action),['student.created']);
    await pool.query(`UPDATE user_unit_membership SET active=false WHERE unit_id=$1 AND user_id=$2`,[penha,user]);
    assert.deepEqual((await listAccessibleUnits(pool,identity)).data,[]);
    assert.equal((await listStudents(pool,identity,new URLSearchParams())).data.length,0);
    assert.equal((await searchStudents(pool,identity,{query:'Teste'})).data.length,0);
    await assert.rejects(getStudent(pool,identity,first.id),{code:'STUDENT_NOT_FOUND'});
    await assert.rejects(getStudentTimeline(pool,identity,first.id,new URLSearchParams()),{code:'STUDENT_NOT_FOUND'});
  } finally { await pool.end(); }
});
