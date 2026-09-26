import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

if (process.env.NODE_ENV!=='development') throw new Error('Smoke flow is development-only');
const username=process.env.GP_CFC_DEV_USERNAME,password=process.env.GP_CFC_DEV_PASSWORD;
if (!username || !password) throw new Error('Set GP_CFC_DEV_USERNAME and GP_CFC_DEV_PASSWORD');
const realm='http://localhost:8080/realms/gp-cfc-dev';
const tokenResponse=await fetch(realm+'/protocol/openid-connect/token',{method:'POST',
  headers:{'content-type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'password',client_id:'gp-cfc-dev',username,password})});
const tokenData=await tokenResponse.json();
assert.equal(tokenResponse.status,200,tokenData.error_description);
const token=tokenData.access_token;
const org='00000000-0000-4000-8000-000000000001',unit='00000000-0000-4000-8000-000000000011';
async function api(path,method='GET',body) {
  const headers={authorization:'Bearer '+token,'x-organization-id':org};
  if (body!==undefined) { headers['content-type']='application/json';headers['idempotency-key']=randomUUID(); }
  const response=await fetch('http://127.0.0.1:3000/api/v1'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
  const value=await response.json();
  assert.ok(response.ok,`${method} ${path}: ${response.status} ${value.code??''}`);
  return value;
}
const ready=await fetch('http://127.0.0.1:3000/health/ready');assert.equal(ready.status,200);
const marker=randomUUID().slice(0,8);
const student=await api('/students','POST',{unitId:unit,fullName:'Aluno Sintético '+marker,phone:'(11) 00000-0000'});
const search=await api('/students/search','POST',{unitId:unit,query:marker});
assert.ok(search.data.some(item=>item.id===student.id));
const detail=await api('/students/'+student.id);
assert.equal(detail.contacts[0].value,'11000000000');
const pkg=await api('/catalog/packages','POST',{unitId:unit,code:'DEMO_'+randomUUID().replaceAll('-','').slice(0,12).toUpperCase(),
  productName:'Produto sintético',serviceType:'FIRST_LICENSE',packageName:'Pacote sintético',priceCents:12345,
  items:[{itemType:'LESSON_DEMO',quantity:2}]});
await api('/catalog/versions/'+pkg.versionId+'/publish','POST',{unitId:unit});
const enrollment=await api('/enrollments','POST',{unitId:unit,studentId:student.id,packageVersionId:pkg.versionId,agreedPriceCents:12345});
const activated=await api('/enrollments/'+enrollment.id+'/activate','POST',{unitId:unit,demoActivationConfirmed:true});
const credits=await api('/enrollments/'+enrollment.id+'/credits?unitId='+unit);
assert.equal(credits.data.find(item=>item.itemType==='LESSON_DEMO')?.available,2);
const availability=Array.from({length:7},(_,weekday)=>({weekday,startsAt:'08:00',endsAt:'18:00'}));
const instructor=await api('/resources','POST',{unitId:unit,kind:'INSTRUCTOR',name:'Instrutor Sintético '+marker,category:'B',availability});
const vehicle=await api('/resources','POST',{unitId:unit,kind:'VEHICLE',name:'Veículo Sintético '+marker,category:'B',availability});
const lessonDate=new Date(Date.now()+7*24*60*60_000).toISOString().slice(0,10);
const lessonInput={unitId:unit,studentId:student.id,processId:activated.processId,walletId:credits.data[0].id,
  category:'B',startsAt:lessonDate+'T15:00:00.000Z',endsAt:lessonDate+'T16:00:00.000Z',
  instructorId:instructor.id,vehicleId:vehicle.id};
const lesson=await api('/lessons','POST',lessonInput);
assert.ok((await api('/lessons?unitId='+unit)).data.some(item=>item.id===lesson.id));
assert.equal((await api('/enrollments/'+enrollment.id+'/credits?unitId='+unit)).data[0].held,1);
await api('/lessons/'+lesson.id+'/cancel','POST',{unitId:unit,reason:'Reagendamento sintético'});
assert.equal((await api('/enrollments/'+enrollment.id+'/credits?unitId='+unit)).data[0].available,2);
await api('/resources/'+vehicle.id+'/blocks','POST',{unitId:unit,startsAt:lessonInput.startsAt,
  endsAt:lessonInput.endsAt,reason:'Manutenção sintética'});
const completedLesson=await api('/lessons','POST',{...lessonInput,
  startsAt:lessonDate+'T16:00:00.000Z',endsAt:lessonDate+'T17:00:00.000Z'});
await api('/lessons/'+completedLesson.id+'/complete','POST',{unitId:unit,demoAttendanceConfirmed:true});
const afterCompletion=await api('/enrollments/'+enrollment.id+'/credits?unitId='+unit);
assert.equal(afterCompletion.data[0].available,1);
assert.equal(afterCompletion.data[0].consumed,1);
const finance=await api('/enrollments/'+enrollment.id+'/finance?unitId='+unit);
assert.equal(finance.data[0].amountCents,12345);
const payment=await api('/payments','POST',{unitId:unit,installmentId:finance.data[0].installmentId,amountCents:12345,
  method:'PIX',externalReference:'demo-'+marker});
assert.equal((await api('/enrollments/'+enrollment.id+'/finance?unitId='+unit)).data[0].status,'PAID');
await api('/payments/'+payment.id+'/refunds','POST',{unitId:unit,amountCents:100,reason:'Ajuste sintético'});
assert.equal((await api('/enrollments/'+enrollment.id+'/finance?unitId='+unit)).data[0].paidCents,12245);
await api('/payments','POST',{unitId:unit,installmentId:finance.data[0].installmentId,amountCents:100,
  method:'CASH'});
assert.equal((await api('/enrollments/'+enrollment.id+'/finance?unitId='+unit)).data[0].status,'PAID');
const initialTasks=await api('/tasks?unitId='+unit+'&view=open');
assert.ok(initialTasks.data.some(item=>item.processId===activated.processId));
const processDetail=await api('/processes/'+activated.processId);
assert.equal(processDetail.workflowVersion,2);
const readyStep=processDetail.steps.find(step=>step.status==='READY');
assert.ok(readyStep);
await api('/processes/'+activated.processId+'/transitions','POST',
  {unitId:unit,stepId:readyStep.id,toStatus:'COMPLETED',expectedStatus:'READY'});
const after=await api('/processes/'+activated.processId);
assert.ok(after.steps.some(step=>step.status==='COMPLETED'));
assert.ok(after.steps.some(step=>step.status==='READY'));
const taskQueue=await api('/tasks?unitId='+unit+'&view=open');
assert.ok(taskQueue.data.some(item=>item.processId===activated.processId&&item.stepLabel==='Conferir documentos'));
const timeline=await api('/students/'+student.id+'/timeline');
assert.ok(timeline.data.some(item=>item.action==='student.created'));
assert.ok(timeline.data.some(item=>item.action==='enrollment.activated'));
assert.ok(timeline.data.some(item=>item.action==='process.step.transitioned'));
assert.ok(timeline.data.some(item=>item.action==='task.created'));
assert.ok(timeline.data.some(item=>item.action==='task.closed'));
assert.ok(timeline.data.some(item=>item.action==='credit.granted'));
assert.ok(timeline.data.some(item=>item.action==='receivable.created'));
assert.ok(timeline.data.some(item=>item.action==='payment.received'));
assert.ok(timeline.data.some(item=>item.action==='payment.refunded'));
assert.ok(timeline.data.some(item=>item.action==='lesson.booked'));
assert.ok(timeline.data.some(item=>item.action==='lesson.cancelled'));
assert.ok(timeline.data.some(item=>item.action==='lesson.completed'));
process.stdout.write(JSON.stringify({health:'ready',studentId:student.id,enrollmentId:enrollment.id,
  processId:activated.processId,completedStep:readyStep.code,nextReady:after.steps.filter(step=>step.status==='READY').map(step=>step.code),search:'ok',timeline:'ok',tasks:'ok',credits:'consumed',finance:'paid',agenda:'booked-cancelled-completed'})+'\n');
