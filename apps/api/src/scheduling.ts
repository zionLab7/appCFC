import type { Pool } from 'pg';
import { HttpError, type Identity } from './auth.js';
import { idempotent, object, only, record, requireUnit, shortText, uuid } from './operations.js';

function timestamp(value: unknown, name: string): string {
  if (typeof value!=='string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value)))
    throw new HttpError(400,'INVALID_TIME',`${name} inválido; informe fuso horário`);
  return new Date(value).toISOString();
}
function windowOf(start: unknown, end: unknown): {startsAt:string; endsAt:string} {
  const startsAt=timestamp(start,'Início'),endsAt=timestamp(end,'Fim');
  const duration=Date.parse(endsAt)-Date.parse(startsAt);
  if (duration<30*60_000 || duration>180*60_000) throw new HttpError(400,'INVALID_WINDOW','Aula deve durar entre 30 e 180 minutos');
  return {startsAt,endsAt};
}
function blockWindowOf(start: unknown, end: unknown): {startsAt:string; endsAt:string} {
  const startsAt=timestamp(start,'Início'),endsAt=timestamp(end,'Fim');
  const duration=Date.parse(endsAt)-Date.parse(startsAt);
  if (duration<5*60_000 || duration>31*24*60*60_000)
    throw new HttpError(400,'INVALID_WINDOW','Bloqueio deve durar entre cinco minutos e 31 dias');
  return {startsAt,endsAt};
}
const timePattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/;

export async function createResource(pool: Pool, identity: Identity, raw: unknown,
  key: string | undefined, correlationId: string) {
  const v=object(raw); only(v,['unitId','kind','name','category','availability']);
  const unitId=uuid(v.unitId,'Unidade');
  if (!['INSTRUCTOR','VEHICLE'].includes(String(v.kind))) throw new HttpError(400,'INVALID_RESOURCE','Tipo de recurso inválido');
  const kind=v.kind as string,name=shortText(v.name,'Nome',120);
  const category=v.category===undefined ? null : String(v.category).trim().toUpperCase();
  if ((kind==='VEHICLE' && !category) || (category && !/^[A-Z0-9_]{1,20}$/.test(category)))
    throw new HttpError(400,'INVALID_CATEGORY','Categoria inválida');
  if (!Array.isArray(v.availability) || v.availability.length<1 || v.availability.length>14)
    throw new HttpError(400,'INVALID_AVAILABILITY','Informe disponibilidade semanal');
  const availability=v.availability.map(slot=>{
    const s=object(slot); only(s,['weekday','startsAt','endsAt']);
    if (!Number.isInteger(s.weekday) || Number(s.weekday)<0 || Number(s.weekday)>6
      || typeof s.startsAt!=='string' || !timePattern.test(s.startsAt)
      || typeof s.endsAt!=='string' || !timePattern.test(s.endsAt) || s.startsAt>=s.endsAt)
      throw new HttpError(400,'INVALID_AVAILABILITY','Janela semanal inválida');
    return {weekday:s.weekday,startsAt:s.startsAt,endsAt:s.endsAt};
  });
  const input={unitId,kind,name,category,availability};
  return idempotent(pool,identity,'POST /api/v1/resources',key,input,
    db=>requireUnit(db,identity,unitId,'resource.write'),async db=>{
      const result=await db.query(`INSERT INTO resource(organization_id,home_unit_id,kind,name,category)
        VALUES($1,$2,$3,$4,$5) RETURNING id`,[identity.organizationId,unitId,kind,name,category]);
      const resourceId=result.rows[0].id as string;
      for (const slot of availability) await db.query(`INSERT INTO resource_availability
        (organization_id,resource_id,weekday,starts_at,ends_at,valid_from)
        VALUES($1,$2,$3,$4,$5,(now() AT TIME ZONE 'America/Sao_Paulo')::date)`,
        [identity.organizationId,resourceId,slot.weekday,slot.startsAt,slot.endsAt]);
      await record(db,identity,unitId,'resource.created','resource',resourceId,
        {resourceId,unitId,kind,name,category,availability},correlationId);
      return {id:resourceId,unitId,kind,name,category,availability};
    },201);
}

export async function listResources(pool: Pool, identity: Identity, unitId: string) {
  uuid(unitId,'Unidade'); await requireUnit(pool,identity,unitId,'resource.read');
  const result=await pool.query(`SELECT r.id,r.kind,r.name,r.category,r.active,
    coalesce((SELECT jsonb_agg(jsonb_build_object('weekday',a.weekday,'startsAt',to_char(a.starts_at,'HH24:MI'),
      'endsAt',to_char(a.ends_at,'HH24:MI')) ORDER BY a.weekday,a.starts_at)
      FROM resource_availability a WHERE a.resource_id=r.id), '[]'::jsonb) AS availability
    FROM resource r WHERE r.organization_id=$1 AND r.home_unit_id=$2 AND r.active
    ORDER BY r.kind,r.name,r.id`,[identity.organizationId,unitId]);
  return {data:result.rows};
}

export async function blockResource(pool: Pool, identity: Identity, resourceId: string, raw: unknown,
  key: string | undefined, correlationId: string) {
  uuid(resourceId,'Recurso'); const v=object(raw); only(v,['unitId','startsAt','endsAt','reason']);
  const unitId=uuid(v.unitId,'Unidade'),reason=shortText(v.reason,'Motivo',200);
  const {startsAt,endsAt}=blockWindowOf(v.startsAt,v.endsAt);
  const input={resourceId,unitId,startsAt,endsAt,reason};
  return idempotent(pool,identity,`POST /api/v1/resources/${resourceId}/blocks`,key,input,
    db=>requireUnit(db,identity,unitId,'resource.write'),async db=>{
      const found=await db.query(`SELECT 1 FROM resource WHERE id=$1 AND organization_id=$2 AND home_unit_id=$3
        AND active FOR UPDATE`,[resourceId,identity.organizationId,unitId]);
      if (!found.rowCount) throw new HttpError(404,'RESOURCE_NOT_FOUND','Recurso não encontrado nesta unidade');
      const booked=await db.query(`SELECT 1 FROM resource_booking b JOIN lesson l
        ON l.id=b.lesson_id AND l.organization_id=b.organization_id
        WHERE b.resource_id=$1 AND b.organization_id=$2 AND b.status IN ('HELD','CONFIRMED')
          AND b.during && tstzrange($3,$4,'[)') LIMIT 1`,
        [resourceId,identity.organizationId,startsAt,endsAt]);
      if (booked.rowCount) throw new HttpError(409,'RESOURCE_BOOKED','Recurso já reservado neste horário');
      const block=await db.query(`INSERT INTO resource_block(organization_id,resource_id,during,reason)
        VALUES($1,$2,tstzrange($3,$4,'[)'),$5) RETURNING id`,
        [identity.organizationId,resourceId,startsAt,endsAt,reason]);
      await record(db,identity,unitId,'resource.blocked','resource_block',block.rows[0].id,
        {blockId:block.rows[0].id,resourceId,startsAt,endsAt,reason},correlationId);
      return {id:block.rows[0].id,resourceId,startsAt,endsAt,reason};
    },201);
}

export async function bookLesson(pool: Pool, identity: Identity, raw: unknown,
  key: string | undefined, correlationId: string) {
  if (!['development','test'].includes(process.env.NODE_ENV ?? ''))
    throw new HttpError(503,'SCHEDULING_RULES_PENDING','Agenda requer regras operacionais validadas');
  const v=object(raw); only(v,['unitId','studentId','processId','walletId','category','startsAt','endsAt','instructorId','vehicleId']);
  const unitId=uuid(v.unitId,'Unidade'),studentId=uuid(v.studentId,'Aluno'),processId=uuid(v.processId,'Processo');
  const walletId=uuid(v.walletId,'Carteira'),instructorId=uuid(v.instructorId,'Instrutor'),vehicleId=uuid(v.vehicleId,'Veículo');
  const category=String(v.category ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9_]{1,20}$/.test(category)) throw new HttpError(400,'INVALID_CATEGORY','Categoria inválida');
  const {startsAt,endsAt}=windowOf(v.startsAt,v.endsAt);
  const input={unitId,studentId,processId,walletId,category,startsAt,endsAt,instructorId,vehicleId};
  return idempotent(pool,identity,'POST /api/v1/lessons',key,input,
    db=>requireUnit(db,identity,unitId,'lesson.book'),async db=>{
      if (Date.parse(startsAt)<Date.now()+60_000) throw new HttpError(409,'PAST_WINDOW','Horário precisa ser futuro');
      const process=await db.query(`SELECT p.enrollment_id FROM process p JOIN enrollment e
        ON e.id=p.enrollment_id AND e.organization_id=p.organization_id
        WHERE p.id=$1 AND p.organization_id=$2 AND p.unit_id=$3 AND p.student_id=$4
          AND p.status='ACTIVE' AND e.status='ACTIVE'`,
        [processId,identity.organizationId,unitId,studentId]);
      if (!process.rowCount) throw new HttpError(404,'PROCESS_NOT_ACTIVE','Processo ativo não encontrado nesta unidade');
      const wallet=await db.query(`SELECT 1 FROM credit_wallet WHERE id=$1 AND organization_id=$2
        AND enrollment_id=$3 AND item_type LIKE 'LESSON%'`,
        [walletId,identity.organizationId,process.rows[0].enrollment_id]);
      if (!wallet.rowCount) throw new HttpError(404,'LESSON_CREDIT_NOT_FOUND','Crédito de aula não encontrado');
      const resources=await db.query(`SELECT id,kind,category FROM resource
        WHERE organization_id=$1 AND home_unit_id=$2 AND active AND id IN ($3,$4) ORDER BY id FOR UPDATE`,
        [identity.organizationId,unitId,instructorId,vehicleId]);
      if (instructorId===vehicleId || resources.rowCount!==2
        || resources.rows.find(r=>r.id===instructorId)?.kind!=='INSTRUCTOR'
        || resources.rows.find(r=>r.id===vehicleId)?.kind!=='VEHICLE'
        || resources.rows.some(r=>r.category && r.category!==category))
        throw new HttpError(409,'RESOURCE_NOT_ELIGIBLE','Instrutor ou veículo indisponível para a categoria');
      for (const resourceId of [instructorId,vehicleId]) {
        const available=await db.query(`SELECT 1 FROM resource_availability a
          WHERE a.organization_id=$1 AND a.resource_id=$2
            AND a.weekday=extract(dow FROM $3::timestamptz AT TIME ZONE 'America/Sao_Paulo')
            AND a.valid_from<=($3::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            AND (a.valid_until IS NULL OR a.valid_until>=($3::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date)
            AND ($3::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date=
                ($4::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
            AND a.starts_at<=($3::timestamptz AT TIME ZONE 'America/Sao_Paulo')::time
            AND a.ends_at>=($4::timestamptz AT TIME ZONE 'America/Sao_Paulo')::time LIMIT 1`,
          [identity.organizationId,resourceId,startsAt,endsAt]);
        if (!available.rowCount) throw new HttpError(409,'RESOURCE_UNAVAILABLE','Fora da disponibilidade cadastrada');
        const blocked=await db.query(`SELECT 1 FROM resource_block WHERE organization_id=$1
          AND resource_id=$2 AND during && tstzrange($3,$4,'[)') LIMIT 1`,
          [identity.organizationId,resourceId,startsAt,endsAt]);
        if (blocked.rowCount) throw new HttpError(409,'RESOURCE_BLOCKED','Recurso bloqueado neste horário');
      }
      const lesson=await db.query(`INSERT INTO lesson(organization_id,unit_id,student_id,process_id,during,category,status)
        VALUES($1,$2,$3,$4,tstzrange($5,$6,'[)'),$7,'RESERVED') RETURNING id`,
        [identity.organizationId,unitId,studentId,processId,startsAt,endsAt,category]);
      const lessonId=lesson.rows[0].id as string;
      for (const resourceId of [instructorId,vehicleId]) await db.query(`INSERT INTO resource_booking
        (organization_id,lesson_id,resource_id,during,status)
        VALUES($1,$2,$3,tstzrange($4,$5,'[)'),'HELD')`,
        [identity.organizationId,lessonId,resourceId,startsAt,endsAt]);
      const hold=await db.query(`INSERT INTO credit_reservation(organization_id,wallet_id,lesson_id,quantity,status)
        VALUES($1,$2,$3,1,'HELD') RETURNING id`,[identity.organizationId,walletId,lessonId]);
      await record(db,identity,unitId,'credit.reserved','credit_reservation',hold.rows[0].id,
        {reservationId:hold.rows[0].id,walletId,lessonId,quantity:1},correlationId);
      await record(db,identity,unitId,'lesson.booked','lesson',lessonId,
        {lessonId,studentId,unitId,instructorId,vehicleId,startsAt,endsAt},correlationId);
      return {id:lessonId,status:'RESERVED',unitId,studentId,processId,walletId,
        category,startsAt,endsAt,instructorId,vehicleId};
    },201);
}

export async function cancelLesson(pool: Pool, identity: Identity, lessonId: string, raw: unknown,
  key: string | undefined, correlationId: string) {
  if (!['development','test'].includes(process.env.NODE_ENV ?? ''))
    throw new HttpError(503,'CANCELLATION_RULES_PENDING','Cancelamento exige política operacional validada');
  uuid(lessonId,'Aula'); const v=object(raw); only(v,['unitId','reason']);
  const unitId=uuid(v.unitId,'Unidade'),reason=shortText(v.reason,'Motivo',200);
  const input={lessonId,unitId,reason};
  return idempotent(pool,identity,`POST /api/v1/lessons/${lessonId}/cancel`,key,input,
    db=>requireUnit(db,identity,unitId,'lesson.cancel'),async db=>{
      const found=await db.query(`SELECT student_id,status FROM lesson WHERE id=$1 AND organization_id=$2
        AND unit_id=$3 FOR UPDATE`,[lessonId,identity.organizationId,unitId]);
      if (!found.rowCount) throw new HttpError(404,'LESSON_NOT_FOUND','Aula não encontrada nesta unidade');
      if (!['RESERVED','CONFIRMED'].includes(found.rows[0].status))
        throw new HttpError(409,'LESSON_NOT_CANCELLABLE','Aula não pode ser cancelada neste estado');
      await db.query(`UPDATE lesson SET status='CANCELLED_BY_CFC' WHERE id=$1`,[lessonId]);
      await db.query(`UPDATE resource_booking SET status='RELEASED' WHERE lesson_id=$1 AND organization_id=$2
        AND status IN ('HELD','CONFIRMED')`,[lessonId,identity.organizationId]);
      const released=await db.query(`UPDATE credit_reservation SET status='RELEASED' WHERE lesson_id=$1
        AND organization_id=$2 AND status='HELD' RETURNING id,wallet_id,quantity`,[lessonId,identity.organizationId]);
      for (const hold of released.rows) await record(db,identity,unitId,'credit.released','credit_reservation',hold.id,
        {reservationId:hold.id,walletId:hold.wallet_id,lessonId,quantity:hold.quantity},correlationId);
      await record(db,identity,unitId,'lesson.cancelled','lesson',lessonId,
        {lessonId,studentId:found.rows[0].student_id,reason},correlationId);
      return {id:lessonId,status:'CANCELLED_BY_CFC'};
    });
}

export async function completeLesson(pool: Pool, identity: Identity, lessonId: string, raw: unknown,
  key: string | undefined, correlationId: string) {
  if (!['development','test'].includes(process.env.NODE_ENV ?? ''))
    throw new HttpError(503,'ATTENDANCE_RULES_PENDING','Presença exige regras operacionais validadas');
  uuid(lessonId,'Aula'); const v=object(raw); only(v,['unitId','demoAttendanceConfirmed']);
  const unitId=uuid(v.unitId,'Unidade');
  if (v.demoAttendanceConfirmed!==true) throw new HttpError(409,'DEMO_CONFIRMATION_REQUIRED','Confirmação sintética necessária');
  const input={lessonId,unitId,demoAttendanceConfirmed:true};
  return idempotent(pool,identity,`POST /api/v1/lessons/${lessonId}/complete`,key,input,
    db=>requireUnit(db,identity,unitId,'lesson.complete'),async db=>{
      const found=await db.query(`SELECT student_id,status FROM lesson WHERE id=$1 AND organization_id=$2
        AND unit_id=$3 FOR UPDATE`,[lessonId,identity.organizationId,unitId]);
      if (!found.rowCount) throw new HttpError(404,'LESSON_NOT_FOUND','Aula não encontrada nesta unidade');
      if (!['RESERVED','CONFIRMED'].includes(found.rows[0].status))
        throw new HttpError(409,'LESSON_NOT_COMPLETABLE','Aula não pode ser concluída neste estado');
      const hold=await db.query(`SELECT id,wallet_id,quantity FROM credit_reservation
        WHERE lesson_id=$1 AND organization_id=$2 AND status='HELD' FOR UPDATE`,
        [lessonId,identity.organizationId]);
      if (hold.rowCount!==1) throw new HttpError(409,'CREDIT_HOLD_MISSING','Reserva de crédito ausente');
      const reservation=hold.rows[0];
      await db.query(`INSERT INTO lesson_attendance(lesson_id,student_present,instructor_present,checked_at)
        VALUES($1,true,true,now())`,[lessonId]);
      await db.query(`UPDATE credit_reservation SET status='CONSUMED' WHERE id=$1`,[reservation.id]);
      const entry=await db.query(`INSERT INTO credit_ledger_entry
        (organization_id,wallet_id,kind,quantity,source_type,source_id)
        VALUES($1,$2,'CONSUME',$3,'LESSON',$4) RETURNING id`,
        [identity.organizationId,reservation.wallet_id,-Number(reservation.quantity),lessonId]);
      await db.query(`UPDATE lesson SET status='COMPLETED' WHERE id=$1`,[lessonId]);
      await db.query(`UPDATE resource_booking SET status='RELEASED' WHERE lesson_id=$1 AND organization_id=$2
        AND status IN ('HELD','CONFIRMED')`,[lessonId,identity.organizationId]);
      await record(db,identity,unitId,'credit.consumed','credit_reservation',reservation.id,
        {reservationId:reservation.id,walletId:reservation.wallet_id,lessonId,
          entryId:entry.rows[0].id,quantity:Number(reservation.quantity)},correlationId);
      await record(db,identity,unitId,'lesson.completed','lesson',lessonId,
        {lessonId,studentId:found.rows[0].student_id},correlationId);
      return {id:lessonId,status:'COMPLETED'};
    });
}

export async function listStudentLessons(pool: Pool, identity: Identity, studentId: string, unitId: string) {
  uuid(studentId,'Aluno'); uuid(unitId,'Unidade');
  await requireUnit(pool,identity,unitId,'lesson.read');
  const student=await pool.query(`SELECT 1 FROM student WHERE id=$1 AND organization_id=$2 AND home_unit_id=$3`,
    [studentId,identity.organizationId,unitId]);
  if (!student.rowCount) throw new HttpError(404,'STUDENT_NOT_FOUND','Aluno não encontrado nesta unidade');
  const result=await pool.query(`SELECT l.id,l.process_id AS "processId",l.status,l.category,
    lower(l.during) AS "startsAt",upper(l.during) AS "endsAt",
    max(r.name) FILTER (WHERE r.kind='INSTRUCTOR') AS "instructorName",
    max(r.name) FILTER (WHERE r.kind='VEHICLE') AS "vehicleName"
    FROM lesson l LEFT JOIN resource_booking b ON b.lesson_id=l.id AND b.organization_id=l.organization_id
    LEFT JOIN resource r ON r.id=b.resource_id AND r.organization_id=b.organization_id
    WHERE l.organization_id=$1 AND l.unit_id=$2 AND l.student_id=$3
    GROUP BY l.id ORDER BY lower(l.during) DESC,l.id DESC LIMIT 100`,
    [identity.organizationId,unitId,studentId]);
  return {data:result.rows};
}

export async function listLessons(pool: Pool, identity: Identity, unitId: string) {
  uuid(unitId,'Unidade'); await requireUnit(pool,identity,unitId,'lesson.read');
  const result=await pool.query(`SELECT l.id,l.student_id AS "studentId",p.full_name AS "studentName",
    l.process_id AS "processId",l.status,l.category,
    lower(l.during) AS "startsAt",upper(l.during) AS "endsAt",
    max(r.name) FILTER (WHERE r.kind='INSTRUCTOR') AS "instructorName",
    max(r.name) FILTER (WHERE r.kind='VEHICLE') AS "vehicleName"
    FROM lesson l JOIN student s ON s.id=l.student_id AND s.organization_id=l.organization_id
    JOIN person p ON p.id=s.person_id AND p.organization_id=s.organization_id
    LEFT JOIN resource_booking b ON b.lesson_id=l.id AND b.organization_id=l.organization_id
    LEFT JOIN resource r ON r.id=b.resource_id AND r.organization_id=b.organization_id
    WHERE l.organization_id=$1 AND l.unit_id=$2
      AND lower(l.during)>=now()-interval '7 days'
    GROUP BY l.id,p.full_name ORDER BY lower(l.during),l.id LIMIT 100`,
    [identity.organizationId,unitId]);
  return {data:result.rows};
}
