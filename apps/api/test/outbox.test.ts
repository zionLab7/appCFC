import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac,randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { webhookDelivery, type EventEnvelope } from '../../worker/src/outbox-dispatcher.js';

test('outbox assina corpo entregue ao receptor local',async()=>{
  const secret='synthetic-webhook-secret-only-for-tests';
  const received: Array<{body:string;signature:string|undefined;eventId:string|undefined}>=[];
  const server=createServer(async(req,res)=>{
    let body=''; for await (const chunk of req) body+=String(chunk);
    received.push({body,signature:String(req.headers['x-gp-cfc-signature'] ?? ''),
      eventId:String(req.headers['x-gp-cfc-event-id'] ?? '')});
    res.writeHead(204).end();
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const address=server.address(); if (!address || typeof address==='string') throw new Error('No local port');
    const event:EventEnvelope={eventId:randomUUID(),eventType:'student.created.v1',
      occurredAt:new Date().toISOString(),organizationId:randomUUID(),unitId:null,
      actor:{type:'system',id:'gp-cfc'},correlationId:randomUUID(),
      entity:{type:'student',id:randomUUID()},payload:{}};
    const before=process.env.NODE_ENV;process.env.NODE_ENV='test';
    try {await webhookDelivery(`http://127.0.0.1:${address.port}/events`,secret)(event,1);}
    finally {if(before===undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=before;}
    assert.equal(received.length,1);
    assert.equal(received[0].eventId,event.eventId);
    assert.deepEqual(JSON.parse(received[0].body),event);
    assert.equal(received[0].signature,'sha256='+createHmac('sha256',secret).update(received[0].body).digest('hex'));
  } finally {await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
