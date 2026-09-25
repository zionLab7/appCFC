import test from 'node:test';
import assert from 'node:assert/strict';
import {transitionStep} from '../src/workflow.ts';
import {creditAvailable,reserveCredit} from '../src/credit.ts';
import {candidateAvailable,overlaps} from '../src/scheduling.ts';

test('workflow blocks a bypassed prerequisite and disallowed reopening',()=>{
  assert.throws(()=>transitionStep('READY','COMPLETED',false,true),/PREREQUISITE/);
  assert.throws(()=>transitionStep('COMPLETED','READY',true,true),/INVALID_TRANSITION/);
  assert.equal(transitionStep('READY','COMPLETED',true,true),'COMPLETED');
});
test('credit counts holds and never reserves more than available',()=>{
  const entries=[{kind:'GRANT',quantity:5},{kind:'CONSUME',quantity:-1}];
  assert.equal(creditAvailable(entries,[2]),2);
  assert.throws(()=>reserveCredit(entries,[2],3),/INSUFFICIENT_CREDIT/);
  assert.equal(reserveCredit(entries,[2],2),2);
});
test('adjacent lessons are allowed; overlap for resource or student is blocked',()=>{
  const first={start:'2026-09-25T12:00:00Z',end:'2026-09-25T13:00:00Z'};
  const next={start:'2026-09-25T13:00:00Z',end:'2026-09-25T14:00:00Z'};
  assert.equal(overlaps(first,next),false);
  assert.equal(candidateAvailable(next,[first],[],[]),true);
  assert.equal(candidateAvailable({...next,start:'2026-09-25T12:59:00Z'},[],[first],[]),false);
});
