INSERT INTO permission(code,description) VALUES
  ('lesson.complete','Concluir aula e consumir crédito')
ON CONFLICT DO NOTHING;
