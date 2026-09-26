import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { dispatchBatch, type EventEnvelope } from '../../../worker/src/outbox-dispatcher.js';

const url=process.env.GP_CFC_TEST_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('_test')) throw new Error('Use a disposable _test database');

test('Postgres: outbox entrega com lease, retry e ID estável',async()=>{
  const pool=new pg.Pool({connectionString:url});
  const org=randomUUID(),aggregate=randomUUID(),correlation=randomUUID();
  try {
    await pool.query(`INSERT INTO organization(id,name) VALUES($1,'Outbox sintética')`,[org]);
    const inserted=await pool.query(`INSERT INTO outbox_event
      (organization_id,type,aggregate_type,aggregate_id,payload,correlation_id)
      VALUES($1,'student.created.v1','student',$2,'{}',$3) RETURNING id`,[org,aggregate,correlation]);
    const eventId=inserted.rows[0].id as string;
    const failed=await dispatchBatch(pool,async event=>{
      assert.equal(event.eventId,eventId);
      throw new Error('synthetic receiver outage');
    },1,org);
    assert.deepEqual(failed,{claimed:1,delivered:0,failed:1});
    const retry=await pool.query(`SELECT attempts,published_at,next_attempt_at,lease_token,last_error_code
      FROM outbox_event WHERE id=$1`,[eventId]);
    assert.equal(retry.rows[0].attempts,1);
    assert.equal(retry.rows[0].published_at,null);
    assert.ok(retry.rows[0].next_attempt_at);
    assert.equal(retry.rows[0].lease_token,null);
    assert.equal(retry.rows[0].last_error_code,'DELIVERY_FAILED');
    await pool.query(`UPDATE outbox_event SET next_attempt_at=now()-interval '1 second' WHERE id=$1`,[eventId]);
    const seen: EventEnvelope[]=[];
    const [a,b]=await Promise.all([0,1].map(()=>dispatchBatch(pool,async event=>{seen.push(event);},1,org)));
    assert.equal(a.claimed+b.claimed,1);
    assert.equal(a.delivered+b.delivered,1);
    assert.equal(seen[0].eventId,eventId);
    assert.equal(seen[0].correlationId,correlation);
    assert.deepEqual(seen[0].entity,{type:'student',id:aggregate});
    assert.equal((await pool.query(`SELECT attempts,published_at FROM outbox_event WHERE id=$1`,[eventId])).rows[0].attempts,2);
    assert.deepEqual(await dispatchBatch(pool,async()=>{},1,org),{claimed:0,delivered:0,failed:0});
  } finally { await pool.end(); }
});
