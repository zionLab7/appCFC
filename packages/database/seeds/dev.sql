-- Synthetic organization and personas only. Safe to reapply on a local DB.
INSERT INTO organization(id,name) VALUES('00000000-0000-4000-8000-000000000001','GP CFC Demonstração') ON CONFLICT DO NOTHING;
INSERT INTO legal_entity(id,organization_id,name,tax_id) VALUES
('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000001','GP CFC DEMO',NULL)
ON CONFLICT DO NOTHING;
INSERT INTO unit(id,organization_id,legal_entity_id,code,name) VALUES
('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','PONTE_RASA','Ponte Rasa'),
('00000000-0000-4000-8000-000000000012','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','PENHA','Penha'),
('00000000-0000-4000-8000-000000000013','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000010','MOOCA','Mooca')
ON CONFLICT DO NOTHING;
INSERT INTO app_user(id,email,display_name) VALUES
('00000000-0000-4000-8000-000000000101','admin@example.invalid','Gestor Demo') ON CONFLICT DO NOTHING;
INSERT INTO user_identity(issuer,subject,user_id) VALUES
('http://localhost:8080/realms/gp-cfc-dev','00000000-0000-4000-8000-000000000101',
 '00000000-0000-4000-8000-000000000101') ON CONFLICT DO NOTHING;
INSERT INTO role(id,organization_id,code,name) VALUES
('00000000-0000-4000-8000-000000000201','00000000-0000-4000-8000-000000000001','MANAGER','Gestor') ON CONFLICT DO NOTHING;
INSERT INTO permission(code,description) VALUES
('student.read','Consultar aluno'),('student.write','Editar aluno'),
('enrollment.write','Criar matrícula'),('process.transition','Avançar processo'),
('lesson.book','Reservar aula'),('payment.receive','Receber pagamento'),
('payment.refund','Estornar pagamento'),('automation.execute','Iniciar automação'),
('audit.read','Consultar auditoria') ON CONFLICT DO NOTHING;
INSERT INTO role_permission(role_id,permission_code)
  SELECT '00000000-0000-4000-8000-000000000201',code FROM permission ON CONFLICT DO NOTHING;
INSERT INTO user_unit_membership(organization_id,unit_id,user_id,role_id)
  SELECT '00000000-0000-4000-8000-000000000001',id,
    '00000000-0000-4000-8000-000000000101','00000000-0000-4000-8000-000000000201'
  FROM unit WHERE organization_id='00000000-0000-4000-8000-000000000001' ON CONFLICT DO NOTHING;
INSERT INTO person(id,organization_id,full_name) VALUES
('00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000001','Aluno Exemplo') ON CONFLICT DO NOTHING;
INSERT INTO student(id,organization_id,person_id,home_unit_id) VALUES
('00000000-0000-4000-8000-000000000401','00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000301','00000000-0000-4000-8000-000000000011') ON CONFLICT DO NOTHING;
INSERT INTO product(id,organization_id,code,name,service_type) VALUES
('00000000-0000-4000-8000-000000000501','00000000-0000-4000-8000-000000000001','PRIMEIRA_B','Primeira habilitação B','FIRST_LICENSE') ON CONFLICT DO NOTHING;
INSERT INTO package(id,organization_id,product_id,name) VALUES
('00000000-0000-4000-8000-000000000601','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000501','Pacote Demo') ON CONFLICT DO NOTHING;
INSERT INTO package_version(id,organization_id,package_id,version,price_cents,published_at) VALUES
('00000000-0000-4000-8000-000000000701','00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000601',1,100000,now()) ON CONFLICT DO NOTHING;
INSERT INTO workflow_definition(id,organization_id,code,service_type) VALUES
('00000000-0000-4000-8000-000000000801','00000000-0000-4000-8000-000000000001','SP_FIRST_B_DEMO','FIRST_LICENSE') ON CONFLICT DO NOTHING;
INSERT INTO workflow_version(id,organization_id,definition_id,version,published_at) VALUES
('00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000801',1,now()) ON CONFLICT DO NOTHING;
-- v2 is the first executable synthetic workflow. v1 remains a historical empty example.
INSERT INTO workflow_version(id,organization_id,definition_id,version) VALUES
('00000000-0000-4000-8000-000000000902','00000000-0000-4000-8000-000000000001',
 '00000000-0000-4000-8000-000000000801',2) ON CONFLICT DO NOTHING;
INSERT INTO workflow_step_definition(id,organization_id,workflow_version_id,code,label,stage,sort_order,prerequisites,completion_rule,allowed_actions,assigned_role,sla_hours)
SELECT gen_random_uuid(),'00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000902',v.code,v.label,'DEMO',v.sort_order,v.prerequisites::jsonb,'{}','[]','SECRETARY',48
FROM (VALUES
 ('REGISTRATION','Conferir matrícula',10,'[]'),
 ('DOCUMENTS','Conferir documentos',20,'["REGISTRATION"]'),
 ('NEXT_STEP','Próxima ação simulada',30,'["DOCUMENTS"]')
) AS v(code,label,sort_order,prerequisites)
WHERE NOT EXISTS (SELECT 1 FROM workflow_step_definition s WHERE s.workflow_version_id='00000000-0000-4000-8000-000000000902' AND s.code=v.code);
UPDATE workflow_version SET published_at=now()
  WHERE id='00000000-0000-4000-8000-000000000902' AND published_at IS NULL;
INSERT INTO role_permission(role_id,permission_code)
  SELECT '00000000-0000-4000-8000-000000000201',code FROM permission ON CONFLICT DO NOTHING;
