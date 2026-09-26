INSERT INTO permission(code,description) VALUES
 ('exam.read','Consultar exames práticos da unidade'),
 ('exam.schedule','Agendar exame prático interno'),
 ('exam.cancel','Cancelar agendamento de exame prático'),
 ('exam.result','Registrar resultado de exame prático')
ON CONFLICT DO NOTHING;
INSERT INTO role_permission(role_id,permission_code)
 SELECT r.id,p.code FROM role r CROSS JOIN permission p
 WHERE r.code IN ('MANAGER','SECRETARY','COORDINATOR') AND p.code IN
 ('exam.read','exam.schedule','exam.cancel','exam.result')
ON CONFLICT DO NOTHING;

CREATE TABLE practical_exam (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id uuid NOT NULL REFERENCES organization(id),
 unit_id uuid NOT NULL,
 student_id uuid NOT NULL,
 process_id uuid NOT NULL,
 instructor_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 during tstzrange NOT NULL,
 category text NOT NULL,
 location text NOT NULL,
 status text NOT NULL DEFAULT 'SCHEDULED' CHECK(status IN ('SCHEDULED','CANCELLED','COMPLETED')),
 result text NOT NULL DEFAULT 'PENDING' CHECK(result IN ('PENDING','PASSED','FAILED')),
 cancellation_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,organization_id),
 FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id),
 FOREIGN KEY(student_id,organization_id) REFERENCES student(id,organization_id),
 FOREIGN KEY(process_id,organization_id) REFERENCES process(id,organization_id),
 FOREIGN KEY(instructor_id,organization_id) REFERENCES resource(id,organization_id),
 FOREIGN KEY(vehicle_id,organization_id) REFERENCES resource(id,organization_id),
 CHECK(NOT isempty(during) AND lower_inc(during) AND NOT upper_inc(during)),
 CONSTRAINT practical_exam_student_no_overlap EXCLUDE USING gist(student_id WITH =,during WITH &&)
  WHERE(status='SCHEDULED')
);
CREATE INDEX practical_exam_unit_time_idx ON practical_exam(organization_id,unit_id,created_at DESC);
ALTER TABLE resource_block ADD COLUMN practical_exam_id uuid;
ALTER TABLE resource_block ADD CONSTRAINT resource_block_practical_exam_fk
 FOREIGN KEY(practical_exam_id,organization_id) REFERENCES practical_exam(id,organization_id);
CREATE UNIQUE INDEX resource_block_exam_resource_unique ON resource_block(practical_exam_id,resource_id)
 WHERE practical_exam_id IS NOT NULL;
