INSERT INTO permission(code,description) VALUES
  ('report.read','Consultar relatório operacional da unidade')
ON CONFLICT DO NOTHING;

CREATE INDEX process_unit_status_idx ON process(organization_id,unit_id,status);
CREATE INDEX receivable_unit_idx ON receivable(organization_id,unit_id,status);
