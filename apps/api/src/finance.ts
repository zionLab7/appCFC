import type { Pool, PoolClient } from 'pg';
import { HttpError, type Identity } from './auth.js';
import { cents, idempotent, object, only, record, requireUnit, shortText, uuid } from './operations.js';

type SnapshotItem = {itemType:string; quantity:number};

async function account(db: PoolClient, organizationId: string, code: string, name: string, kind: string): Promise<string> {
  const result=await db.query(`INSERT INTO financial_account(organization_id,code,name,kind)
    VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name RETURNING id`,
    [organizationId,code,name,kind]);
  return result.rows[0].id as string;
}

async function journal(db: PoolClient, identity: Identity, unitId: string, sourceType: string, sourceId: string,
  debitCode: string, creditCode: string, amountCents: number) {
  const definitions: Record<string,[string,string]>={
    RECEIVABLE:['Contas a receber','ASSET'], DEFERRED_REVENUE:['Receita contratada a apropriar','LIABILITY'],
    CASH:['Caixa e bancos','ASSET']
  };
  const debit=await account(db,identity.organizationId,debitCode,...definitions[debitCode]);
  const credit=await account(db,identity.organizationId,creditCode,...definitions[creditCode]);
  const header=await db.query(`INSERT INTO journal_entry(organization_id,unit_id,source_type,source_id)
    VALUES($1,$2,$3,$4) RETURNING id`,[identity.organizationId,unitId,sourceType,sourceId]);
  await db.query(`INSERT INTO journal_line(organization_id,entry_id,account_id,debit_cents,credit_cents)
    VALUES($1,$2,$3,$4,0),($1,$2,$5,0,$4)`,
    [identity.organizationId,header.rows[0].id,debit,amountCents,credit]);
}

/** Called in the same transaction as process creation and enrollment activation. */
export async function provisionActivation(db: PoolClient, identity: Identity, unitId: string,
  enrollmentId: string, priceCents: number, items: SnapshotItem[], correlationId: string) {
  for (const item of items) {
    if (!item || typeof item.itemType!=='string' || !Number.isSafeInteger(item.quantity) || item.quantity<=0)
      throw new HttpError(409,'INVALID_PACKAGE_SNAPSHOT','Itens contratados inválidos');
    const wallet=await db.query(`INSERT INTO credit_wallet(organization_id,enrollment_id,item_type)
      VALUES($1,$2,$3) RETURNING id`,[identity.organizationId,enrollmentId,item.itemType]);
    const walletId=wallet.rows[0].id as string;
    const entry=await db.query(`INSERT INTO credit_ledger_entry(organization_id,wallet_id,kind,quantity,source_type,source_id)
      VALUES($1,$2,'GRANT',$3,'ENROLLMENT',$4) RETURNING id`,
      [identity.organizationId,walletId,item.quantity,enrollmentId]);
    await record(db,identity,unitId,'credit.granted','credit_wallet',walletId,
      {walletId,enrollmentId,entryId:entry.rows[0].id,itemType:item.itemType,quantity:item.quantity},correlationId);
  }
  if (priceCents>0) {
    const receivable=await db.query(`INSERT INTO receivable(organization_id,unit_id,enrollment_id,amount_cents)
      VALUES($1,$2,$3,$4) RETURNING id`,[identity.organizationId,unitId,enrollmentId,priceCents]);
    const receivableId=receivable.rows[0].id as string;
    const installment=await db.query(`INSERT INTO installment(organization_id,receivable_id,number,due_date,amount_cents)
      VALUES($1,$2,1,(now() AT TIME ZONE 'America/Sao_Paulo')::date + 30,$3) RETURNING id,due_date`,
      [identity.organizationId,receivableId,priceCents]);
    await journal(db,identity,unitId,'RECEIVABLE',receivableId,'RECEIVABLE','DEFERRED_REVENUE',priceCents);
    await record(db,identity,unitId,'receivable.created','receivable',receivableId,
      {receivableId,enrollmentId,installmentId:installment.rows[0].id,amountCents:priceCents,
        dueDate:installment.rows[0].due_date},correlationId);
  }
}

async function ownedEnrollment(pool: Pool, identity: Identity, enrollmentId: string, unitId: string) {
  const found=await pool.query(`SELECT 1 FROM enrollment WHERE id=$1 AND organization_id=$2 AND unit_id=$3`,
    [enrollmentId,identity.organizationId,unitId]);
  if (!found.rowCount) throw new HttpError(404,'ENROLLMENT_NOT_FOUND','Matrícula não encontrada');
}

export async function getCredits(pool: Pool, identity: Identity, enrollmentId: string, unitId: string) {
  uuid(enrollmentId,'Matrícula'); uuid(unitId,'Unidade');
  await requireUnit(pool,identity,unitId,'credit.read');
  await ownedEnrollment(pool,identity,enrollmentId,unitId);
  const result=await pool.query(`SELECT w.id,w.item_type AS "itemType",
    (SELECT coalesce(sum(e.quantity),0)::bigint FROM credit_ledger_entry e WHERE e.wallet_id=w.id) AS balance,
    (SELECT coalesce(sum(h.quantity),0)::bigint FROM credit_reservation h
      WHERE h.wallet_id=w.id AND h.status='HELD') AS held,
    (SELECT coalesce(sum(h.quantity),0)::bigint FROM credit_reservation h
      WHERE h.wallet_id=w.id AND h.status='CONSUMED') AS consumed
    FROM credit_wallet w WHERE w.organization_id=$1 AND w.enrollment_id=$2 ORDER BY w.item_type`,
    [identity.organizationId,enrollmentId]);
  return {data:result.rows.map(row=>({id:row.id,itemType:row.itemType,balance:Number(row.balance),
    held:Number(row.held),consumed:Number(row.consumed),available:Number(row.balance)-Number(row.held)}))};
}

export async function getFinance(pool: Pool, identity: Identity, enrollmentId: string, unitId: string) {
  uuid(enrollmentId,'Matrícula'); uuid(unitId,'Unidade');
  await requireUnit(pool,identity,unitId,'finance.read');
  await ownedEnrollment(pool,identity,enrollmentId,unitId);
  const result=await pool.query(`SELECT r.id AS "receivableId",r.amount_cents AS "amountCents",r.status,
    i.id AS "installmentId",i.number,i.due_date AS "dueDate",i.amount_cents AS "installmentCents",
    coalesce((SELECT sum(pa.amount_cents-coalesce(rev.amount_cents,0)) FROM payment_allocation pa
      LEFT JOIN (SELECT allocation_id,sum(amount_cents) AS amount_cents FROM payment_allocation_reversal
        GROUP BY allocation_id) rev ON rev.allocation_id=pa.id
      WHERE pa.installment_id=i.id),0)::bigint AS "paidCents"
    FROM receivable r JOIN installment i ON i.receivable_id=r.id AND i.organization_id=r.organization_id
    WHERE r.organization_id=$1 AND r.unit_id=$2 AND r.enrollment_id=$3 ORDER BY i.number`,
    [identity.organizationId,unitId,enrollmentId]);
  const payments=await pool.query(`SELECT p.id,p.method,p.status,p.amount_cents AS "amountCents",
    pa.installment_id AS "installmentId",coalesce(sum(pr.amount_cents),0)::bigint AS "refundedCents"
    FROM payment p JOIN payment_allocation pa ON pa.payment_id=p.id AND pa.organization_id=p.organization_id
    JOIN installment i ON i.id=pa.installment_id AND i.organization_id=pa.organization_id
    JOIN receivable r ON r.id=i.receivable_id AND r.organization_id=i.organization_id
    LEFT JOIN payment_refund pr ON pr.payment_id=p.id AND pr.organization_id=p.organization_id
    WHERE p.organization_id=$1 AND r.unit_id=$2 AND r.enrollment_id=$3
    GROUP BY p.id,pa.installment_id ORDER BY p.occurred_at,p.id`,[identity.organizationId,unitId,enrollmentId]);
  return {data:result.rows.map(row=>({...row,amountCents:Number(row.amountCents),
    installmentCents:Number(row.installmentCents),paidCents:Number(row.paidCents)})),
    payments:payments.rows.map(row=>({...row,amountCents:Number(row.amountCents),refundedCents:Number(row.refundedCents)}))};
}

export async function receivePayment(pool: Pool, identity: Identity, raw: unknown,
  key: string | undefined, correlationId: string) {
  if (!['development','test'].includes(process.env.NODE_ENV ?? ''))
    throw new HttpError(503,'PAYMENT_INTEGRATION_PENDING','Recebimento exige conciliação e regras operacionais validadas');
  const v=object(raw); only(v,['unitId','installmentId','amountCents','method','externalReference']);
  const unitId=uuid(v.unitId,'Unidade'),installmentId=uuid(v.installmentId,'Parcela');
  const amountCents=cents(v.amountCents);
  if (amountCents===0) throw new HttpError(400,'INVALID_AMOUNT','Valor deve ser positivo');
  if (!['CASH','PIX','TRANSFER'].includes(String(v.method))) throw new HttpError(400,'INVALID_METHOD','Forma de pagamento manual inválida');
  const method=v.method as string;
  const externalReference=v.externalReference===undefined ? null : String(v.externalReference).trim();
  if ((externalReference!==null && (externalReference.length<3 || externalReference.length>120))
    || (method!=='CASH' && !externalReference))
    throw new HttpError(400,'INVALID_REFERENCE','Referência do pagamento inválida');
  const input={unitId,installmentId,amountCents,method,externalReference};
  return idempotent(pool,identity,'POST /api/v1/payments',key,input,
    db=>requireUnit(db,identity,unitId,'payment.receive'),async db=>{
      const found=await db.query(`SELECT i.id,i.amount_cents,r.id AS receivable_id,r.enrollment_id,r.status
        FROM installment i JOIN receivable r ON r.id=i.receivable_id AND r.organization_id=i.organization_id
        WHERE i.id=$1 AND i.organization_id=$2 AND r.unit_id=$3 FOR UPDATE OF i,r`,
        [installmentId,identity.organizationId,unitId]);
      if (!found.rowCount) throw new HttpError(404,'INSTALLMENT_NOT_FOUND','Parcela não encontrada nesta unidade');
      const row=found.rows[0];
      if (row.status==='CANCELLED') throw new HttpError(409,'RECEIVABLE_CANCELLED','Recebível cancelado');
      const allocated=await db.query(`SELECT coalesce(sum(pa.amount_cents-coalesce(rev.amount_cents,0)),0)::bigint AS paid
        FROM payment_allocation pa LEFT JOIN (SELECT allocation_id,sum(amount_cents) AS amount_cents
          FROM payment_allocation_reversal GROUP BY allocation_id) rev ON rev.allocation_id=pa.id
        WHERE pa.installment_id=$1`,[installmentId]);
      if (Number(allocated.rows[0].paid)+amountCents>Number(row.amount_cents))
        throw new HttpError(409,'INSTALLMENT_OVERPAID','Pagamento excede o saldo da parcela');
      const payment=await db.query(`INSERT INTO payment(organization_id,unit_id,amount_cents,method,status,external_reference)
        VALUES($1,$2,$3,$4,'SETTLED',$5) RETURNING id`,
        [identity.organizationId,unitId,amountCents,method,externalReference]);
      const paymentId=payment.rows[0].id as string;
      const allocation=await db.query(`INSERT INTO payment_allocation(organization_id,payment_id,installment_id,amount_cents)
        VALUES($1,$2,$3,$4) RETURNING id`,[identity.organizationId,paymentId,installmentId,amountCents]);
      await journal(db,identity,unitId,'PAYMENT',paymentId,'CASH','RECEIVABLE',amountCents);
      const total=await db.query(`SELECT coalesce(sum(pa.amount_cents-coalesce(rev.amount_cents,0)),0)::bigint AS paid FROM payment_allocation pa
        LEFT JOIN (SELECT allocation_id,sum(amount_cents) AS amount_cents FROM payment_allocation_reversal
          GROUP BY allocation_id) rev ON rev.allocation_id=pa.id
        JOIN installment i ON i.id=pa.installment_id AND i.organization_id=pa.organization_id
        WHERE i.receivable_id=$1`,[row.receivable_id]);
      await db.query(`UPDATE receivable SET status=$2 WHERE id=$1`,
        [row.receivable_id,Number(total.rows[0].paid)>=Number(row.amount_cents)?'PAID':'PARTIALLY_PAID']);
      await record(db,identity,unitId,'payment.received','payment',paymentId,
        {paymentId,amountCents,currency:'BRL',method,allocationIds:[allocation.rows[0].id]},correlationId);
      return {id:paymentId,installmentId,amountCents,method,status:'SETTLED',receivableId:row.receivable_id};
    },201);
}

export async function refundPayment(pool: Pool, identity: Identity, paymentId: string, raw: unknown,
  key: string | undefined, correlationId: string) {
  if (!['development','test'].includes(process.env.NODE_ENV ?? ''))
    throw new HttpError(503,'REFUND_INTEGRATION_PENDING','Estorno exige conciliação e regras operacionais validadas');
  uuid(paymentId,'Pagamento');
  const v=object(raw); only(v,['unitId','amountCents','reason']);
  const unitId=uuid(v.unitId,'Unidade'),amountCents=cents(v.amountCents);
  if (amountCents===0) throw new HttpError(400,'INVALID_AMOUNT','Valor deve ser positivo');
  const reason=shortText(v.reason,'Motivo',200);
  const input={paymentId,unitId,amountCents,reason};
  return idempotent(pool,identity,`POST /api/v1/payments/${paymentId}/refunds`,key,input,
    db=>requireUnit(db,identity,unitId,'payment.refund'),async db=>{
      const found=await db.query(`SELECT p.id,p.amount_cents,p.status,pa.id AS allocation_id,
        pa.installment_id,i.receivable_id,r.amount_cents AS receivable_amount
        FROM payment p JOIN payment_allocation pa ON pa.payment_id=p.id AND pa.organization_id=p.organization_id
        JOIN installment i ON i.id=pa.installment_id AND i.organization_id=pa.organization_id
        JOIN receivable r ON r.id=i.receivable_id AND r.organization_id=i.organization_id
        WHERE p.id=$1 AND p.organization_id=$2 AND p.unit_id=$3 AND r.unit_id=$3 FOR UPDATE OF p,pa,i,r`,
        [paymentId,identity.organizationId,unitId]);
      if (!found.rowCount) throw new HttpError(404,'PAYMENT_NOT_FOUND','Pagamento não encontrado nesta unidade');
      const row=found.rows[0];
      if (found.rowCount!==1) throw new HttpError(409,'REFUND_COMPLEX_PAYMENT','Pagamento com múltiplas alocações requer conciliação manual');
      const refunded=await db.query(`SELECT coalesce(sum(amount_cents),0)::bigint AS amount FROM payment_refund
        WHERE payment_id=$1`,[paymentId]);
      const refundTotal=Number(refunded.rows[0].amount)+amountCents;
      if (refundTotal>Number(row.amount_cents)) throw new HttpError(409,'PAYMENT_OVERREFUNDED','Estorno excede o pagamento');
      const refund=await db.query(`INSERT INTO payment_refund(organization_id,payment_id,amount_cents,reason)
        VALUES($1,$2,$3,$4) RETURNING id`,[identity.organizationId,paymentId,amountCents,reason]);
      const refundId=refund.rows[0].id as string;
      await db.query(`INSERT INTO payment_allocation_reversal(organization_id,refund_id,allocation_id,amount_cents)
        VALUES($1,$2,$3,$4)`,[identity.organizationId,refundId,row.allocation_id,amountCents]);
      await journal(db,identity,unitId,'PAYMENT_REFUND',refundId,'RECEIVABLE','CASH',amountCents);
      if (refundTotal===Number(row.amount_cents))
        await db.query(`UPDATE payment SET status='REFUNDED' WHERE id=$1`,[paymentId]);
      const total=await db.query(`SELECT coalesce(sum(pa.amount_cents-coalesce(rev.amount_cents,0)),0)::bigint AS paid
        FROM payment_allocation pa JOIN installment i ON i.id=pa.installment_id AND i.organization_id=pa.organization_id
        LEFT JOIN (SELECT allocation_id,sum(amount_cents) AS amount_cents FROM payment_allocation_reversal
          GROUP BY allocation_id) rev ON rev.allocation_id=pa.id
        WHERE i.receivable_id=$1`,[row.receivable_id]);
      const remainingPaid=Number(total.rows[0].paid);
      await db.query(`UPDATE receivable SET status=$2 WHERE id=$1`,
        [row.receivable_id,remainingPaid===0?'OPEN':remainingPaid>=Number(row.receivable_amount)?'PAID':'PARTIALLY_PAID']);
      await record(db,identity,unitId,'payment.refunded','payment_refund',refundId,
        {refundId,paymentId,amountCents,reason,allocationId:row.allocation_id},correlationId);
      return {id:refundId,paymentId,amountCents,status:'RECORDED'};
    },201);
}
