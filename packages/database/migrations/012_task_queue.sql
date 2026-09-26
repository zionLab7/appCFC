INSERT INTO permission(code,description) VALUES
  ('task.read','Consultar tarefas da unidade')
ON CONFLICT DO NOTHING;

-- The queue sorts open work by deadline, placing tasks without a deadline last.
CREATE INDEX task_queue_page_idx ON task
  (organization_id,unit_id,status,
   (coalesce(due_at,'9999-12-31 23:59:59+00'::timestamptz)),id);
