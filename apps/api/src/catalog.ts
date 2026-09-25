import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { HttpError, type Identity } from './auth.js';
import { cents, idempotent, object, only, record, requireRole, requireUnit, shortText, uuid } from './operations.js';

type Item = { itemType: string; quantity: number };
function details(raw: Record<string,unknown>) {
  const priceCents=cents(raw.priceCents);
  const terms=raw.terms===undefined ? {} : object(raw.terms);
  if (JSON.stringify(terms).length>4000) throw new HttpError(400,'INVALID_BODY','Termos muito longos');
  if (!Array.isArray(raw.items) || raw.items.length<1 || raw.items.length>30)
    throw new HttpError(400,'INVALID_BODY','Informe de 1 a 30 itens');
  const items: Item[]=raw.items.map(item=>{
    const v=object(item); only(v,['itemType','quantity']);
    const itemType=shortText(v.itemType,'Tipo de item',80);
    if (!Number.isInteger(v.quantity) || (v.quantity as number)<1 || (v.quantity as number)>10000)
      throw new HttpError(400,'INVALID_BODY','Quantidade inválida');
    return {itemType,quantity:v.quantity as number};
  });
  if (new Set(items.map(x=>x.itemType)).size!==items.length) throw new HttpError(400,'INVALID_BODY','Item duplicado');
  return {priceCents,terms,items};
}
async function addItems(db: PoolClient, org: string, versionId: string, items: Item[]) {
  for (const item of items) await db.query(`INSERT INTO package_item(organization_id,package_version_id,item_type,quantity)
    VALUES($1,$2,$3,$4)`,[org,versionId,item.itemType,item.quantity]);
}
export async function createPackage(pool: Pool, identity: Identity, raw: unknown, key: string | undefined, correlationId: string) {
  const v=object(raw); only(v,['unitId','code','productName','serviceType','packageName','priceCents','terms','items']);
  const unitId=uuid(v.unitId,'Unidade'), code=shortText(v.code,'Código',60).toUpperCase();
  if (!/^[A-Z0-9_]+$/.test(code)) throw new HttpError(400,'INVALID_BODY','Código inválido');
  const input={unitId,code,productName:shortText(v.productName,'Produto'),serviceType:shortText(v.serviceType,'Serviço',80),
    packageName:shortText(v.packageName,'Pacote'),...details(v)};
  return idempotent(pool,identity,'POST /api/v1/catalog/packages',key,input,
    db=>requireUnit(db,identity,unitId,'catalog.write'),async db=>{
      const productId=randomUUID(),packageId=randomUUID(),versionId=randomUUID();
      await db.query(`INSERT INTO product(id,organization_id,code,name,service_type) VALUES($1,$2,$3,$4,$5)`,
        [productId,identity.organizationId,code,input.productName,input.serviceType]);
      await db.query(`INSERT INTO package(id,organization_id,product_id,name,unit_id) VALUES($1,$2,$3,$4,$5)`,
        [packageId,identity.organizationId,productId,input.packageName,unitId]);
      await db.query(`INSERT INTO package_version(id,organization_id,package_id,version,price_cents,terms)
        VALUES($1,$2,$3,1,$4,$5)`,[versionId,identity.organizationId,packageId,input.priceCents,JSON.stringify(input.terms)]);
      await addItems(db,identity.organizationId,versionId,input.items);
      await record(db,identity,unitId,'catalog.package.created','package',packageId,{packageId,versionId,version:1},correlationId);
      return {packageId,versionId,version:1,status:'DRAFT'};
    },201);
}
export async function createDraftVersion(pool: Pool, identity: Identity, packageId: string, raw: unknown,
  key: string | undefined, correlationId: string) {
  const v=object(raw); only(v,['unitId','priceCents','terms','items']);
  const unitId=uuid(v.unitId,'Unidade'), input={packageId:uuid(packageId,'Pacote'),unitId,...details(v)};
  return idempotent(pool,identity,`POST /api/v1/catalog/packages/${packageId}/versions`,key,input,
    db=>requireUnit(db,identity,unitId,'catalog.write'),async db=>{
      const parent=await db.query(`SELECT id,unit_id FROM package WHERE id=$1 AND organization_id=$2 FOR UPDATE`,[packageId,identity.organizationId]);
      if (!parent.rowCount) throw new HttpError(404,'PACKAGE_NOT_FOUND','Pacote não encontrado');
      if (parent.rows[0].unit_id && parent.rows[0].unit_id!==unitId) throw new HttpError(404,'PACKAGE_NOT_FOUND','Pacote não encontrado');
      if (!parent.rows[0].unit_id) await requireRole(db,identity,unitId,'MANAGER');
      const state=await db.query(`SELECT coalesce(max(version),0)+1 AS next,
        count(*) FILTER (WHERE published_at IS NULL) AS drafts FROM package_version WHERE package_id=$1`,[packageId]);
      if (Number(state.rows[0].drafts)>0) throw new HttpError(409,'DRAFT_EXISTS','Já existe uma versão em rascunho');
      const version=Number(state.rows[0].next),versionId=randomUUID();
      await db.query(`INSERT INTO package_version(id,organization_id,package_id,version,price_cents,terms)
        VALUES($1,$2,$3,$4,$5,$6)`,[versionId,identity.organizationId,packageId,version,input.priceCents,JSON.stringify(input.terms)]);
      await addItems(db,identity.organizationId,versionId,input.items);
      await record(db,identity,unitId,'catalog.version.created','package',packageId,{packageId,versionId,version},correlationId);
      return {packageId,versionId,version,status:'DRAFT'};
    },201);
}
async function draft(db: PoolClient, identity: Identity, versionId: string, unitId: string) {
  const found=await db.query(`SELECT pv.id,pv.package_id,pv.version,pv.published_at,pa.unit_id FROM package_version pv
    JOIN package pa ON pa.id=pv.package_id AND pa.organization_id=pv.organization_id
    WHERE pv.id=$1 AND pv.organization_id=$2 FOR UPDATE OF pv`,[versionId,identity.organizationId]);
  if (!found.rowCount) throw new HttpError(404,'VERSION_NOT_FOUND','Versão não encontrada');
  if (found.rows[0].unit_id && found.rows[0].unit_id!==unitId) throw new HttpError(404,'VERSION_NOT_FOUND','Versão não encontrada');
  if (!found.rows[0].unit_id) await requireRole(db,identity,unitId,'MANAGER');
  if (found.rows[0].published_at) throw new HttpError(409,'VERSION_PUBLISHED','Versão publicada é imutável');
  return found.rows[0] as {id:string;package_id:string;version:number};
}
export async function updateDraft(pool: Pool, identity: Identity, versionId: string, raw: unknown,
  key: string | undefined, correlationId: string) {
  const v=object(raw); only(v,['unitId','priceCents','terms','items']);
  const unitId=uuid(v.unitId,'Unidade'),input={versionId:uuid(versionId,'Versão'),unitId,...details(v)};
  return idempotent(pool,identity,`PATCH /api/v1/catalog/versions/${versionId}`,key,input,
    db=>requireUnit(db,identity,unitId,'catalog.write'),async db=>{
      const current=await draft(db,identity,versionId,unitId);
      await db.query(`UPDATE package_version SET price_cents=$3,terms=$4 WHERE id=$1 AND organization_id=$2`,
        [versionId,identity.organizationId,input.priceCents,JSON.stringify(input.terms)]);
      await db.query(`DELETE FROM package_item WHERE package_version_id=$1 AND organization_id=$2`,[versionId,identity.organizationId]);
      await addItems(db,identity.organizationId,versionId,input.items);
      await record(db,identity,unitId,'catalog.version.updated','package',current.package_id,{versionId},correlationId);
      return {versionId,status:'DRAFT'};
    });
}
export async function deleteDraft(pool: Pool, identity: Identity, versionId: string, unitId: string,
  key: string | undefined, correlationId: string) {
  uuid(versionId,'Versão'); uuid(unitId,'Unidade');
  return idempotent(pool,identity,`DELETE /api/v1/catalog/versions/${versionId}`,key,{versionId,unitId},
    db=>requireUnit(db,identity,unitId,'catalog.write'),async db=>{
      const current=await draft(db,identity,versionId,unitId);
      await db.query(`DELETE FROM package_item WHERE package_version_id=$1`,[versionId]);
      await db.query(`DELETE FROM package_version WHERE id=$1`,[versionId]);
      await record(db,identity,unitId,'catalog.version.deleted','package',current.package_id,{versionId},correlationId);
      return {versionId,status:'DELETED'};
    });
}
export async function publishVersion(pool: Pool, identity: Identity, versionId: string, raw: unknown,
  key: string | undefined, correlationId: string) {
  const v=object(raw); only(v,['unitId']); const unitId=uuid(v.unitId,'Unidade'); uuid(versionId,'Versão');
  return idempotent(pool,identity,`POST /api/v1/catalog/versions/${versionId}/publish`,key,{versionId,unitId},
    db=>requireUnit(db,identity,unitId,'catalog.publish'),async db=>{
      const current=await draft(db,identity,versionId,unitId);
      await db.query(`UPDATE package_version SET published_at=now() WHERE id=$1`,[versionId]);
      await record(db,identity,unitId,'catalog.version.published','package',current.package_id,
        {packageId:current.package_id,versionId,version:current.version},correlationId);
      return {versionId,packageId:current.package_id,version:current.version,status:'PUBLISHED'};
    });
}
export async function listCatalog(pool: Pool, identity: Identity, unitId: string) {
  uuid(unitId,'Unidade'); await requireUnit(pool,identity,unitId,'catalog.read');
  const result=await pool.query(`SELECT pa.id AS "packageId",p.code,p.name AS "productName",p.service_type AS "serviceType",
    pa.name AS "packageName",pa.unit_id AS "unitId",pv.id AS "versionId",pv.version,pv.price_cents AS "priceCents",
    pv.terms,pv.published_at AS "publishedAt",
    coalesce(jsonb_agg(jsonb_build_object('itemType',pi.item_type,'quantity',pi.quantity))
      FILTER (WHERE pi.id IS NOT NULL),'[]'::jsonb) AS items
    FROM package pa JOIN product p ON p.id=pa.product_id AND p.organization_id=pa.organization_id
    JOIN package_version pv ON pv.package_id=pa.id AND pv.organization_id=pa.organization_id
    LEFT JOIN package_item pi ON pi.package_version_id=pv.id AND pi.organization_id=pv.organization_id
    WHERE pa.organization_id=$1 AND (pa.unit_id IS NULL OR pa.unit_id=$2)
    GROUP BY pa.id,p.id,pv.id ORDER BY pa.unit_id IS NULL,p.code,pv.version DESC`,[identity.organizationId,unitId]);
  return {data:result.rows};
}
