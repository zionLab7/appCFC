CREATE TABLE document (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  unit_id uuid, owner_type text NOT NULL, owner_id uuid NOT NULL, kind text NOT NULL,
  status text NOT NULL DEFAULT 'REQUESTED', current_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,organization_id),
  FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id)
);
CREATE TABLE document_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  document_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
  object_key text NOT NULL, sha256 char(64) NOT NULL, size_bytes bigint NOT NULL CHECK(size_bytes>=0),
  uploaded_at timestamptz NOT NULL DEFAULT now(), UNIQUE(document_id,version),
  FOREIGN KEY(document_id,organization_id) REFERENCES document(id,organization_id)
);
ALTER TABLE contract ADD CONSTRAINT contract_document_fk
  FOREIGN KEY(document_id,organization_id) REFERENCES document(id,organization_id);
CREATE TABLE communication_thread (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  student_id uuid NOT NULL, channel text NOT NULL, provider_ref text,
  UNIQUE(id,organization_id), FOREIGN KEY(student_id,organization_id) REFERENCES student(id,organization_id)
);
CREATE TABLE communication_message (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  thread_id uuid NOT NULL, direction text NOT NULL CHECK(direction IN ('IN','OUT')),
  status text NOT NULL, body_redacted text, occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(thread_id,organization_id) REFERENCES communication_thread(id,organization_id)
);
CREATE TABLE communication_consent (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  student_id uuid NOT NULL, channel text NOT NULL, purpose text NOT NULL,
  status text NOT NULL CHECK(status IN ('GRANTED','REVOKED')),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(student_id,organization_id) REFERENCES student(id,organization_id)
);
CREATE TABLE automation_job (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  unit_id uuid NOT NULL, process_id uuid, provider text NOT NULL, operation text NOT NULL,
  credential_ref text, request_json jsonb NOT NULL,
  status text NOT NULL DEFAULT 'QUEUED' CHECK(status IN
    ('QUEUED','RUNNING','WAITING_HUMAN','RETRY_SCHEDULED','SUCCEEDED','FAILED_RETRYABLE','FAILED_PERMANENT','CANCELLED')),
  attempt_count integer NOT NULL DEFAULT 0, next_attempt_at timestamptz,
  idempotency_key text NOT NULL, result_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,organization_id), UNIQUE(organization_id,provider,operation,idempotency_key),
  FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id),
  FOREIGN KEY(process_id,organization_id) REFERENCES process(id,organization_id)
);
CREATE INDEX automation_dispatch_idx ON automation_job(next_attempt_at,created_at)
  WHERE status IN ('QUEUED','RETRY_SCHEDULED');
CREATE TABLE automation_attempt (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  job_id uuid NOT NULL, attempt_number integer NOT NULL, started_at timestamptz NOT NULL,
  finished_at timestamptz, error_class text, evidence_object_key text,
  UNIQUE(job_id,attempt_number),
  FOREIGN KEY(job_id,organization_id) REFERENCES automation_job(id,organization_id)
);
CREATE TABLE integration_external_reference (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  provider text NOT NULL, external_id text NOT NULL, entity_type text NOT NULL,
  entity_id uuid NOT NULL, UNIQUE(organization_id,provider,external_id)
);
CREATE TABLE webhook_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  provider text NOT NULL, external_id text NOT NULL, signature_valid boolean NOT NULL,
  payload_ref text NOT NULL, processed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id,provider,external_id)
);
CREATE TABLE business_rule_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  unit_id uuid, code text NOT NULL, version integer NOT NULL CHECK(version>0),
  rule_json jsonb NOT NULL, published_at timestamptz,
  UNIQUE(organization_id,unit_id,code,version),
  FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id)
);

-- Append-only at the DB layer. Corrections use reversing rows/new versions.
CREATE FUNCTION reject_immutable_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable table: append a compensating record'; END $$;
CREATE TRIGGER credit_immutable BEFORE UPDATE OR DELETE ON credit_ledger_entry
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER journal_lines_immutable BEFORE UPDATE OR DELETE ON journal_line
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER journal_entries_immutable BEFORE UPDATE OR DELETE ON journal_entry
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER audit_immutable BEFORE UPDATE OR DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER process_transitions_immutable BEFORE UPDATE OR DELETE ON process_transition
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

-- Additional service-level guards still required: aggregate consistency of a
-- process/enrollment, credit nonnegative balance, payment allocations, booking
-- availability, signed document access and all cross-unit authorization.
