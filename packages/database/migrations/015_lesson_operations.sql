INSERT INTO permission(code,description) VALUES
  ('resource.read','Consultar instrutores e veículos'),
  ('resource.write','Cadastrar recursos e bloqueios'),
  ('lesson.read','Consultar aulas da unidade'),
  ('lesson.cancel','Cancelar reserva de aula')
ON CONFLICT DO NOTHING;

CREATE INDEX resource_unit_active_idx ON resource(organization_id,home_unit_id,kind,active);
CREATE INDEX lesson_student_start_idx ON lesson(organization_id,student_id,created_at DESC);
CREATE INDEX resource_availability_resource_idx ON resource_availability(resource_id,weekday,valid_from);
