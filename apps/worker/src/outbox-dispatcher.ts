import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg, { type Pool } from 'pg';

type OutboxRow = {id:string; organization_id:string; unit_id:string|null; type:string;
  aggregate_type:string; aggregate_id:string; payload:Record<string,unknown>; occurred_at:Date;
  actor_user_id:string|null; correlation_id:string|null; attempts:number; lease_token:string};
export type EventEnvelope = {eventId:string; eventType:string; occurredAt:string; organizationId:string;
  unitId:string|null; actor:{type:'user'|'system';id:string}; correlationId:string;
  entity:{type:string;id:string}; payload:Record<string,unknown>};

function envelope(row: OutboxRow): EventEnvelope {
  return {eventId:row.id,eventType:row.type,occurredAt:new Date(row.occurred_at).toISOString(),
    organizationId:row.organization_id,unitId:row.unit_id,
    actor:row.actor_user_id ? {type:'user',id:row.actor_user_id} : {type:'system',id:'gp-cfc'},
    correlationId:row.correlation_id ?? row.id,
    entity:{type:row.aggregate_type,id:row.aggregate_id},payload:row.payload};
}

export async function dispatchBatch(pool: Pool, deliver: (event:EventEnvelope, attempt:number)=>Promise<void>,
  limit=25, organizationId: string | null=null) {
  if (!Number.isInteger(limit) || limit<1 || limit>100) throw new Error('Invalid outbox batch limit');
  const claimed=await pool.query<OutboxRow>(`WITH picked AS (
    SELECT id FROM outbox_event WHERE published_at IS NULL
      AND (next_attempt_at IS NULL OR next_attempt_at<=now())
      AND (lease_until IS NULL OR lease_until<now())
      AND ($2::uuid IS NULL OR organization_id=$2)
    ORDER BY occurred_at,id FOR UPDATE SKIP LOCKED LIMIT $1
  ) UPDATE outbox_event o SET attempts=o.attempts+1,
    lease_until=now()+interval '60 seconds',lease_token=gen_random_uuid()
    FROM picked WHERE o.id=picked.id RETURNING o.*`,[limit,organizationId]);
  let delivered=0,failed=0;
  for (const row of claimed.rows) {
    try {
      await deliver(envelope(row),row.attempts);
      await pool.query(`UPDATE outbox_event SET published_at=now(),lease_until=NULL,lease_token=NULL,
        next_attempt_at=NULL,last_error_code=NULL WHERE id=$1 AND lease_token=$2 AND published_at IS NULL`,
        [row.id,row.lease_token]);
      delivered++;
    } catch {
      const delaySeconds=Math.min(3600,5*2**Math.min(row.attempts-1,10));
      await pool.query(`UPDATE outbox_event SET lease_until=NULL,lease_token=NULL,
        next_attempt_at=now()+($3::integer*interval '1 second'),last_error_code='DELIVERY_FAILED'
        WHERE id=$1 AND lease_token=$2 AND published_at IS NULL`,
        [row.id,row.lease_token,delaySeconds]);
      failed++;
    }
  }
  return {claimed:claimed.rowCount ?? 0,delivered,failed};
}

export function webhookDelivery(url: string, secret: string) {
  const target=new URL(url);
  if (target.username || target.password) throw new Error('Outbox webhook URL must not contain credentials');
  if (target.protocol!=='https:' && !(['development','test'].includes(process.env.NODE_ENV ?? '')
    && target.protocol==='http:' && ['localhost','127.0.0.1'].includes(target.hostname)))
    throw new Error('Outbox webhook must use HTTPS (localhost HTTP only in development)');
  if (secret.length<24) throw new Error('Outbox webhook secret must be at least 24 characters');
  return async (event:EventEnvelope, attempt:number) => {
    const body=JSON.stringify(event);
    const signature=createHmac('sha256',secret).update(body).digest('hex');
    const response=await fetch(target,{method:'POST',redirect:'error',signal:AbortSignal.timeout(10_000),
      headers:{'content-type':'application/json','x-gp-cfc-event-id':event.eventId,
        'x-gp-cfc-attempt':String(attempt),'x-gp-cfc-signature':'sha256='+signature},body});
    if (!response.ok) throw new Error('Webhook delivery rejected');
  };
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const databaseUrl=process.env.DATABASE_URL,webhookUrl=process.env.OUTBOX_WEBHOOK_URL,
    secret=process.env.OUTBOX_WEBHOOK_SECRET;
  if (!databaseUrl || !webhookUrl || !secret) throw new Error('DATABASE_URL, OUTBOX_WEBHOOK_URL and OUTBOX_WEBHOOK_SECRET required');
  const pool=new pg.Pool({connectionString:databaseUrl,max:3});
  const deliver=webhookDelivery(webhookUrl,secret);
  let stopping=false;
  for (const signal of ['SIGINT','SIGTERM'] as const) process.on(signal,()=>{stopping=true;});
  try {
    while (!stopping) {
      const result=await dispatchBatch(pool,deliver);
      if (result.claimed || result.failed) process.stdout.write(JSON.stringify({level:'info',outbox:result})+'\n');
      await new Promise(resolve=>setTimeout(resolve,2000));
    }
  } finally { await pool.end(); }
}
