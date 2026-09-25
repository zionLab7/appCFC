export interface CreditEntry {quantity:number; kind:'GRANT'|'CONSUME'|'RESTORE'|'EXPIRE'|'ADJUST'|'REVERSAL'}
export function creditAvailable(entries:readonly CreditEntry[],held:readonly number[]):number {
  const balance=entries.reduce((n,e)=>n+e.quantity,0);
  if(entries.some(e=>!Number.isInteger(e.quantity)||e.quantity===0) || held.some(n=>!Number.isInteger(n)||n<=0))
    throw new Error('INVALID_CREDIT_QUANTITY');
  return balance-held.reduce((n,q)=>n+q,0);
}
export function reserveCredit(entries:readonly CreditEntry[],held:readonly number[],quantity:number):number {
  if(!Number.isInteger(quantity)||quantity<=0) throw new Error('INVALID_CREDIT_QUANTITY');
  if(creditAvailable(entries,held)<quantity) throw new Error('INSUFFICIENT_CREDIT');
  return quantity;
}
