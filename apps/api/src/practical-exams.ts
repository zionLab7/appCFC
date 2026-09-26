import type { Pool } from 'pg';
import { HttpError, type Identity } from './auth.js';
import { idempotent, object, only, record, requireUnit, shortText, uuid } from './operations.js';

function examWindow(start: unknown, end: unknown) {
  if (typeof start!=='string' || typeof end!=='string' ||
    !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(start) || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(end) ||
    !Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)))
    throw new HttpError(400,'INVALID_TIME','Informe início e fim com fuso horário');
  const startsAt=new Date(start).toISOString(),endsAt=new Date(end).toISOString();
  const duration=Date.parse(endsAt)-Date.parse(startsAt);
  if (duration<30*60_000 || duration>240*60_000)
    throw new HttpError(400,'INVALID_WINDOW','Exame deve durar entre 30 e 240 minutos');
  return {startsAt,endsAt};
}

export async function listPracticalExams(pool: Pool, identity: Identity, unitId: string, day = '') {
  uuid(unitId,'Unidade'); await requireUnit(pool,identity,unitId,'exam.read');
  const parsedDay=Date.parse(day+'T12:00:00Z');
  if (day && (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(parsedDay) ||
    new Date(parsedDay).toISOString().slice(0,10)!==day))
    throw new HttpError(400,'INVALID_DATE','Dia inválido');
  const result=await pool.query(`SELECT x.id,x.student_id AS "studentId",x.process_id AS "processId",
    p.full_name AS "studentName",x.category,x.location,x.status,x.result,
    x.instructor_id AS "instructorId",x.vehicle_id AS "vehicleId",
    ir.name AS "instructorName",vr.name AS "vehicleName",
    lower(x.during) AS "startsAt",upper(x.during) AS "endsAt"
    FROM practical_exam x JOIN student s ON s.id=x.student_id AND s.organization_id=x.organization_id
    JOIN person p ON p.id=s.person_id AND p.organization_id=s.organization_id
    JOIN resource ir ON ir.id=x.instructor_id AND ir.organization_id=x.organization_id
    JOIN resource vr ON vr.id=x.vehicle_id AND vr.organization_id=x.organization_id
    WHERE x.organization_id=$1 AND x.unit_id=$2 AND
      (($3='' AND lower(x.during)>=now()-interval '30 days') OR
       ($3<>'' AND lower(x.during)>=(nullif($3,'')::date::timestamp AT TIME ZONE 'America/Sao_Paulo')
        AND lower(x.during)<((nullif($3,'')::date+1)::timestamp AT TIME ZONE 'America/Sao_Paulo')))
    ORDER BY lower(x.during),x.id LIMIT 200`,[identity.organizationId,unitId,day]);
  return {data:result.rows};
}

export async function schedulePracticalExam(pool: Pool, identity: Identity, raw: unknown,
  key: string | undefined, correlationId: string) {
  if (!['development','test'].includes(process.env.NODE_ENV ?? ''))
    throw new HttpError(503,'EXAM_RULES_PENDING','Agendamento oficial requer regras operacionais validadas');
  const v=object(raw);
  only(v,['unitId','studentId','processId','startsAt','endsAt','category','location','instructorId','vehicleId']);
  const unitId=uuid(v.unitId,'Unidade'),studentId=uuid(v.studentId,'Aluno'),processId=uuid(v.processId,'Processo');
  const instructorId=uuid(v.instructorId,'Instrutor'),vehicleId=uuid(v.vehicleId,'Veículo');
  const {startsAt,endsAt}=examWindow(v.startsAt,v.endsAt);
  const category=String(v.category??'').trim().toUpperCase(),location=shortText(v.location,'Local',160);
  if (!/^[A-Z0-9_]{1,20}$/.test(category)) throw new HttpError(400,'INVALID_CATEGORY','Categoria inválida');
  const input={unitId,studentId,processId,startsAt,endsAt,category,location,instructorId,vehicleId};
  return idempotent(pool,identity,'POST /api/v1/practical-exams',key,input,
    db=>requireUnit(db,identity,unitId,'exam.schedule'),async db=>{
      if (Date.parse(startsAt)<Date.now()+60_000) throw new HttpError(409,'PAST_WINDOW','Horário precisa ser futuro');
      const process=await db.query(`SELECT 1 FROM process p JOIN enrollment e
        ON e.id=p.enrollment_id AND e.organization_id=p.organization_id
        WHERE p.id=$1 AND p.organization_id=$2 AND p.unit_id=$3 AND p.student_id=$4
          AND p.status='ACTIVE' AND e.status='ACTIVE'`,[processId,identity.organizationId,unitId,studentId]);
      if (!process.rowCount) throw new HttpError(404,'PROCESS_NOT_ACTIVE','Processo ativo não encontrado nesta unidade');
      await db.query(`SELECT id FROM student WHERE id=$1 AND organization_id=$2 FOR UPDATE`,
        [studentId,identity.organizationId]);
      const studentConflict=await db.query(`SELECT 1 FROM lesson WHERE organization_id=$1
        AND student_id=$2 AND status IN ('RESERVED','CONFIRMED','CHECKED_IN','IN_PROGRESS')
        AND during && tstzrange($3,$4,'[)') LIMIT 1`,[identity.organizationId,studentId,startsAt,endsAt]);
      if (studentConflict.rowCount) throw new HttpError(409,'STUDENT_LESSON_CONFLICT','Aluno já tem aula neste horário');
      const exams=await db.query(`SELECT 1 FROM practical_exam WHERE organization_id=$1
        AND student_id=$2 AND status='SCHEDULED' AND during && tstzrange($3,$4,'[)') LIMIT 1`,
        [identity.organizationId,studentId,startsAt,endsAt]);
      if (exams.rowCount) throw new HttpError(409,'STUDENT_EXAM_CONFLICT','Aluno já tem exame neste horário');
      const resources=await db.query(`SELECT id,kind,category FROM resource
        WHERE organization_id=$1 AND home_unit_id=$2 AND active AND id IN ($3,$4) ORDER BY id FOR UPDATE`,
        [identity.organizationId,unitId,instructorId,vehicleId]);
      if (instructorId===vehicleId || resources.rowCount!==2 ||
        resources.rows.find(r=>r.id===instructorId)?.kind!=='INSTRUCTOR' ||
        resources.rows.find(r=>r.id===vehicleId)?.kind!=='VEHICLE' ||
        resources.rows.some(r=>r.category && r.category!==category))
        throw new HttpError(409,'RESOURCE_NOT_ELIGIBLE','Instrutor ou veículo incompatível com a categoria');
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
        const blocked=await db.query(`SELECT 1 FROM resource_block WHERE organization_id=$1 AND resource_id=$2
          AND during && tstzrange($3,$4,'[)') LIMIT 1`,
          [identity.organizationId,resourceId,startsAt,endsAt]);
        if (blocked.rowCount) throw new HttpError(409,'RESOURCE_BLOCKED','Recurso ocupado neste horário');
        const lesson=await db.query(`SELECT 1 FROM resource_booking WHERE organization_id=$1 AND resource_id=$2
          AND status IN ('HELD','CONFIRMED') AND during && tstzrange($3,$4,'[)') LIMIT 1`,
          [identity.organizationId,resourceId,startsAt,endsAt]);
        if (lesson.rowCount) throw new HttpError(409,'RESOURCE_BOOKED','Recurso reservado para aula neste horário');
      }
      const result=await db.query(`INSERT INTO practical_exam
        (organization_id,unit_id,student_id,process_id,instructor_id,vehicle_id,during,category,location)
        VALUES($1,$2,$3,$4,$5,$6,tstzrange($7,$8,'[)'),$9,$10) RETURNING id`,
        [identity.organizationId,unitId,studentId,processId,instructorId,vehicleId,startsAt,endsAt,category,location]);
      const examId=result.rows[0].id as string;
      for (const resourceId of [instructorId,vehicleId]) await db.query(`INSERT INTO resource_block
        (organization_id,resource_id,during,reason,practical_exam_id)
        VALUES($1,$2,tstzrange($3,$4,'[)'),'Exame prático interno',$5)`,
        [identity.organizationId,resourceId,startsAt,endsAt,examId]);
      await record(db,identity,unitId,'practical_exam.scheduled','practical_exam',examId,
        {examId,studentId,processId,startsAt,endsAt,category,location,instructorId,vehicleId},correlationId);
      return {id:examId,status:'SCHEDULED',result:'PENDING',...input};
    },201);
}

export async function cancelPracticalExam(pool: Pool, identity: Identity, examId: string, raw: unknown,
  key: string | undefined, correlationId: string) {
  uuid(examId,'Exame'); const v=object(raw); only(v,['unitId','reason']);
  const unitId=uuid(v.unitId,'Unidade'),reason=shortText(v.reason,'Motivo',200);
  return idempotent(pool,identity,`POST /api/v1/practical-exams/${examId}/cancel`,key,{examId,unitId,reason},
    db=>requireUnit(db,identity,unitId,'exam.cancel'),async db=>{
      const found=await db.query(`SELECT student_id,status FROM practical_exam WHERE id=$1
        AND organization_id=$2 AND unit_id=$3 FOR UPDATE`,[examId,identity.organizationId,unitId]);
      if (!found.rowCount) throw new HttpError(404,'EXAM_NOT_FOUND','Exame não encontrado nesta unidade');
      if (found.rows[0].status!=='SCHEDULED') throw new HttpError(409,'EXAM_NOT_CANCELLABLE','Exame não pode ser cancelado');
      await db.query(`UPDATE practical_exam SET status='CANCELLED',cancellation_reason=$2,
        updated_at=now() WHERE id=$1`,[examId,reason]);
      await db.query(`DELETE FROM resource_block WHERE practical_exam_id=$1 AND organization_id=$2`,
        [examId,identity.organizationId]);
      await record(db,identity,unitId,'practical_exam.cancelled','practical_exam',examId,
        {examId,studentId:found.rows[0].student_id,reason},correlationId);
      return {id:examId,status:'CANCELLED'};
    });
}

export async function recordPracticalExamResult(pool: Pool, identity: Identity, examId: string, raw: unknown,
  key: string | undefined, correlationId: string) {
  uuid(examId,'Exame'); const v=object(raw); only(v,['unitId','result']);
  const unitId=uuid(v.unitId,'Unidade'),result=v.result;
  if (!['PASSED','FAILED'].includes(String(result))) throw new HttpError(400,'INVALID_RESULT','Resultado inválido');
  return idempotent(pool,identity,`POST /api/v1/practical-exams/${examId}/result`,key,{examId,unitId,result},
    db=>requireUnit(db,identity,unitId,'exam.result'),async db=>{
      const found=await db.query(`SELECT student_id,status,upper(during) AS ends_at FROM practical_exam
        WHERE id=$1 AND organization_id=$2 AND unit_id=$3 FOR UPDATE`,[examId,identity.organizationId,unitId]);
      if (!found.rowCount) throw new HttpError(404,'EXAM_NOT_FOUND','Exame não encontrado nesta unidade');
      if (found.rows[0].status!=='SCHEDULED' || Date.parse(found.rows[0].ends_at)>Date.now())
        throw new HttpError(409,'EXAM_NOT_FINISHED','Registre o resultado após o horário do exame');
      await db.query(`UPDATE practical_exam SET status='COMPLETED',result=$2,updated_at=now() WHERE id=$1`,[examId,result]);
      await record(db,identity,unitId,'practical_exam.result_recorded','practical_exam',examId,
        {examId,studentId:found.rows[0].student_id,result},correlationId);
      return {id:examId,status:'COMPLETED',result};
    });
}
