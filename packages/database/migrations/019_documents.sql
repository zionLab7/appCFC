INSERT INTO permission(code,description) VALUES
 ('document.read','Consultar documentos da unidade'),
 ('document.write','Solicitar e enviar documentos'),
 ('document.review','Aceitar ou rejeitar documentos')
ON CONFLICT DO NOTHING;

INSERT INTO role_permission(role_id,permission_code)
 SELECT r.id,p.code FROM role r CROSS JOIN permission p
 WHERE r.code IN ('MANAGER','SECRETARY') AND p.code IN ('document.read','document.write')
ON CONFLICT DO NOTHING;
INSERT INTO role_permission(role_id,permission_code)
 SELECT r.id,'document.review' FROM role r WHERE r.code='MANAGER'
ON CONFLICT DO NOTHING;

ALTER TABLE document ADD CONSTRAINT document_status_check
 CHECK(status IN ('REQUESTED','SUBMITTED','ACCEPTED','REJECTED'));
ALTER TABLE document ADD COLUMN reviewed_at timestamptz;
ALTER TABLE document ADD COLUMN reviewed_by uuid REFERENCES app_user(id);
ALTER TABLE document ADD COLUMN review_reason text;
ALTER TABLE document_version ADD COLUMN mime_type text NOT NULL DEFAULT 'application/octet-stream';
ALTER TABLE document_version ADD CONSTRAINT document_version_mime_check
 CHECK(mime_type IN ('application/pdf','image/jpeg','image/png','application/octet-stream'));
CREATE UNIQUE INDEX contract_enrollment_unique ON contract(organization_id,enrollment_id);
CREATE INDEX document_owner_idx ON document(organization_id,unit_id,owner_type,owner_id,created_at DESC);
