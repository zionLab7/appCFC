import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
test('migrations are ordered and contain server-side overlap guards',async()=>{
  const files=(await readdir(resolve(root,'packages/database/migrations'))).filter(f=>f.endsWith('.sql')).sort();
  assert.deepEqual(files.slice(0,6),[
    '001_foundation.sql','002_commercial_workflow.sql','003_scheduling_finance.sql',
    '004_operations.sql','005_invariants_and_finance_extensions.sql','006_identity_and_student_indexes.sql']);
  const sql=(await Promise.all(files.map(f=>readFile(resolve(root,'packages/database/migrations',f),'utf8')))).join('\n');
  assert.match(sql,/lesson_student_no_overlap EXCLUDE USING gist/);
  assert.match(sql,/resource_no_overlap EXCLUDE USING gist/);
  assert.match(sql,/CREATE CONSTRAINT TRIGGER journal_balanced_after_line/);
});
test('API and events contracts exist',async()=>{
  const api=await readFile(resolve(root,'packages/contracts/openapi.yaml'),'utf8');
  assert.match(api,/openapi: 3.1.0/);
  assert.match(api,/\/api\/v1\/students:/);
  assert.match(api,/\/api\/v1\/tasks:/);
  assert.match(api,/\/api\/v1\/enrollments\/\{enrollmentId\}\/credits:/);
  assert.match(api,/\/api\/v1\/enrollments\/\{enrollmentId\}\/finance:/);
  assert.match(api,/\/api\/v1\/payments:/);
  assert.match(api,/\/api\/v1\/resources:/);
  assert.match(api,/\/api\/v1\/lessons:/);
  assert.match(api,/\/api\/v1\/reports\/operations:/);
  assert.match(api,/\/api\/v1\/reports\/operations\/consolidated:/);
  assert.match(api,/\/api\/v1\/documents:/);
  assert.match(api,/\/api\/v1\/access\/units:/);
  const event=JSON.parse(await readFile(resolve(root,'packages/contracts/events/envelope.schema.json'),'utf8'));
  assert.equal(event.$schema,'https://json-schema.org/draft/2020-12/schema');
  for(const name of ['task.created.v1','task.closed.v1']) {
    const schema=JSON.parse(await readFile(resolve(root,`packages/contracts/events/${name}.schema.json`),'utf8'));
    assert.deepEqual(schema.required,['taskId','processId','stepId']);
  }
  for(const name of ['credit.granted.v1','credit.reserved.v1','credit.released.v1','credit.consumed.v1',
    'receivable.created.v1','payment.received.v1','payment.refunded.v1','resource.created.v1',
    'resource.blocked.v1','lesson.booked.v1','lesson.cancelled.v1','lesson.completed.v1',
    'document.requested.v1','document.submitted.v1','document.reviewed.v1']) {
    const schema=JSON.parse(await readFile(resolve(root,`packages/contracts/events/${name}.schema.json`),'utf8'));
    assert.equal(schema.type,'object');
    assert.ok(schema.required.length>=2);
  }
});
