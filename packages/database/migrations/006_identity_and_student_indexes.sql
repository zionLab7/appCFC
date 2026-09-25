-- OIDC subjects are immutable external identifiers; email is display data only.
CREATE TABLE user_identity (
  issuer text NOT NULL,
  subject text NOT NULL,
  user_id uuid NOT NULL REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (issuer, subject),
  UNIQUE (issuer, user_id)
);
CREATE INDEX student_page_idx ON student (organization_id, created_at, id);
CREATE INDEX person_document_lookup_idx ON person (organization_id, document_kind, document_number)
  WHERE document_number IS NOT NULL;
