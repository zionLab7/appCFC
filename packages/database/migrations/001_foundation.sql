CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE organization (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE legal_entity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  name text NOT NULL, tax_id text, UNIQUE(id,organization_id), UNIQUE(organization_id,tax_id)
);
CREATE TABLE unit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  legal_entity_id uuid, code text NOT NULL, name text NOT NULL, active boolean NOT NULL DEFAULT true,
  UNIQUE(id,organization_id), UNIQUE(organization_id,code),
  FOREIGN KEY (legal_entity_id,organization_id) REFERENCES legal_entity(id,organization_id)
);
CREATE TABLE app_user (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, display_name text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','DISABLED')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE role (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  code text NOT NULL, name text NOT NULL, UNIQUE(id,organization_id), UNIQUE(organization_id,code)
);
CREATE TABLE permission (code text PRIMARY KEY, description text NOT NULL);
CREATE TABLE role_permission (
  role_id uuid NOT NULL REFERENCES role(id), permission_code text NOT NULL REFERENCES permission(code),
  PRIMARY KEY(role_id,permission_code)
);
CREATE TABLE user_unit_membership (
  organization_id uuid NOT NULL REFERENCES organization(id), unit_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES app_user(id), role_id uuid NOT NULL,
  active boolean NOT NULL DEFAULT true, PRIMARY KEY(unit_id,user_id,role_id),
  FOREIGN KEY (unit_id,organization_id) REFERENCES unit(id,organization_id),
  FOREIGN KEY (role_id,organization_id) REFERENCES role(id,organization_id)
);
CREATE INDEX membership_user_idx ON user_unit_membership(user_id,organization_id) WHERE active;

CREATE TABLE person (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  full_name text NOT NULL, birth_date date, document_kind text, document_number text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,organization_id), CHECK((document_kind IS NULL)=(document_number IS NULL))
);
CREATE UNIQUE INDEX person_document_uniq ON person(organization_id,document_kind,document_number)
  WHERE document_number IS NOT NULL;
CREATE INDEX person_name_search_idx ON person(organization_id,lower(full_name));
CREATE TABLE person_contact (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  person_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('PHONE','EMAIL')),
  value text NOT NULL, is_primary boolean NOT NULL DEFAULT false,
  UNIQUE(id,organization_id), FOREIGN KEY(person_id,organization_id) REFERENCES person(id,organization_id)
);
CREATE TABLE person_address (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  person_id uuid NOT NULL, line1 text NOT NULL, city text NOT NULL,
  state_code char(2), postal_code text,
  FOREIGN KEY(person_id,organization_id) REFERENCES person(id,organization_id)
);
CREATE TABLE student (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  person_id uuid NOT NULL, home_unit_id uuid, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,organization_id), UNIQUE(organization_id,person_id),
  FOREIGN KEY(person_id,organization_id) REFERENCES person(id,organization_id),
  FOREIGN KEY(home_unit_id,organization_id) REFERENCES unit(id,organization_id)
);
CREATE TABLE student_note (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  student_id uuid NOT NULL, body text NOT NULL, author_user_id uuid REFERENCES app_user(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(student_id,organization_id) REFERENCES student(id,organization_id)
);
CREATE TABLE audit_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  unit_id uuid, actor_user_id uuid REFERENCES app_user(id), action text NOT NULL,
  entity_type text NOT NULL, entity_id uuid NOT NULL, reason text,
  before_json jsonb, after_json jsonb, correlation_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id)
);
CREATE INDEX audit_scope_time_idx ON audit_event(organization_id,occurred_at DESC);
CREATE TABLE outbox_event (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  unit_id uuid, type text NOT NULL, aggregate_type text NOT NULL, aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL, occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz, attempts integer NOT NULL DEFAULT 0,
  FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id)
);
CREATE INDEX outbox_pending_idx ON outbox_event(occurred_at) WHERE published_at IS NULL;
CREATE TABLE idempotency_record (
  organization_id uuid NOT NULL REFERENCES organization(id), actor_key text NOT NULL,
  endpoint text NOT NULL, idempotency_key text NOT NULL, request_hash text NOT NULL,
  status_code integer, response_json jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(organization_id,actor_key,endpoint,idempotency_key)
);
