CREATE TABLE product (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  code text NOT NULL, name text NOT NULL, service_type text NOT NULL,
  UNIQUE(id,organization_id), UNIQUE(organization_id,code)
);
CREATE TABLE package (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  product_id uuid NOT NULL, name text NOT NULL, active boolean NOT NULL DEFAULT true,
  UNIQUE(id,organization_id), FOREIGN KEY(product_id,organization_id) REFERENCES product(id,organization_id)
);
CREATE TABLE package_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  package_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
  price_cents bigint NOT NULL CHECK(price_cents>=0), currency char(3) NOT NULL DEFAULT 'BRL',
  terms jsonb NOT NULL DEFAULT '{}'::jsonb, published_at timestamptz,
  UNIQUE(id,organization_id), UNIQUE(package_id,version),
  FOREIGN KEY(package_id,organization_id) REFERENCES package(id,organization_id)
);
CREATE TABLE package_item (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  package_version_id uuid NOT NULL, item_type text NOT NULL, quantity integer NOT NULL CHECK(quantity>0),
  FOREIGN KEY(package_version_id,organization_id) REFERENCES package_version(id,organization_id)
);
CREATE TABLE lead (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  unit_id uuid NOT NULL, person_id uuid, source text, status text NOT NULL DEFAULT 'NEW',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,organization_id),
  FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id),
  FOREIGN KEY(person_id,organization_id) REFERENCES person(id,organization_id)
);
CREATE TABLE quote (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  unit_id uuid NOT NULL, lead_id uuid, package_version_id uuid NOT NULL,
  quoted_price_cents bigint NOT NULL CHECK(quoted_price_cents>=0), status text NOT NULL DEFAULT 'DRAFT',
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,organization_id),
  FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id),
  FOREIGN KEY(lead_id,organization_id) REFERENCES lead(id,organization_id),
  FOREIGN KEY(package_version_id,organization_id) REFERENCES package_version(id,organization_id)
);
CREATE TABLE enrollment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  unit_id uuid NOT NULL, student_id uuid NOT NULL, package_version_id uuid NOT NULL,
  quote_id uuid, status text NOT NULL DEFAULT 'DRAFT'
    CHECK(status IN ('DRAFT','PENDING_SIGNATURE','ACTIVE','SUSPENDED','CANCELLED','COMPLETED')),
  agreed_price_cents bigint NOT NULL CHECK(agreed_price_cents>=0),
  created_at timestamptz NOT NULL DEFAULT now(), activated_at timestamptz,
  UNIQUE(id,organization_id),
  FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id),
  FOREIGN KEY(student_id,organization_id) REFERENCES student(id,organization_id),
  FOREIGN KEY(package_version_id,organization_id) REFERENCES package_version(id,organization_id),
  FOREIGN KEY(quote_id,organization_id) REFERENCES quote(id,organization_id)
);
CREATE INDEX enrollment_student_idx ON enrollment(organization_id,student_id,created_at DESC);
CREATE TABLE contract (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  enrollment_id uuid NOT NULL, status text NOT NULL DEFAULT 'DRAFT',
  document_id uuid, signed_at timestamptz, UNIQUE(id,organization_id),
  FOREIGN KEY(enrollment_id,organization_id) REFERENCES enrollment(id,organization_id)
);

CREATE TABLE workflow_definition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  code text NOT NULL, service_type text NOT NULL, UNIQUE(id,organization_id), UNIQUE(organization_id,code)
);
CREATE TABLE workflow_version (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  definition_id uuid NOT NULL, version integer NOT NULL CHECK(version>0),
  published_at timestamptz, UNIQUE(id,organization_id), UNIQUE(definition_id,version),
  FOREIGN KEY(definition_id,organization_id) REFERENCES workflow_definition(id,organization_id)
);
CREATE TABLE workflow_step_definition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  workflow_version_id uuid NOT NULL, code text NOT NULL, label text NOT NULL,
  stage text NOT NULL, sort_order integer NOT NULL,
  prerequisites jsonb NOT NULL DEFAULT '[]', completion_rule jsonb NOT NULL DEFAULT '{}',
  allowed_actions jsonb NOT NULL DEFAULT '[]', assigned_role text, sla_hours integer,
  UNIQUE(id,organization_id), UNIQUE(workflow_version_id,code),
  FOREIGN KEY(workflow_version_id,organization_id) REFERENCES workflow_version(id,organization_id)
);
CREATE TABLE process (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  unit_id uuid NOT NULL, student_id uuid NOT NULL, enrollment_id uuid NOT NULL,
  workflow_version_id uuid NOT NULL, status text NOT NULL DEFAULT 'CREATED'
    CHECK(status IN ('CREATED','ACTIVE','WAITING','BLOCKED','COMPLETED','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,organization_id),
  FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id),
  FOREIGN KEY(student_id,organization_id) REFERENCES student(id,organization_id),
  FOREIGN KEY(enrollment_id,organization_id) REFERENCES enrollment(id,organization_id),
  FOREIGN KEY(workflow_version_id,organization_id) REFERENCES workflow_version(id,organization_id)
);
CREATE TABLE process_step (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  process_id uuid NOT NULL, definition_step_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'NOT_STARTED'
    CHECK(status IN ('NOT_STARTED','READY','IN_PROGRESS','WAITING_EXTERNAL','WAITING_STUDENT','BLOCKED','COMPLETED','FAILED','WAIVED','CANCELLED')),
  completed_at timestamptz, UNIQUE(id,organization_id), UNIQUE(process_id,definition_step_id),
  FOREIGN KEY(process_id,organization_id) REFERENCES process(id,organization_id),
  FOREIGN KEY(definition_step_id,organization_id) REFERENCES workflow_step_definition(id,organization_id)
);
CREATE TABLE process_transition (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  process_step_id uuid NOT NULL, from_status text NOT NULL, to_status text NOT NULL,
  reason text, actor_user_id uuid REFERENCES app_user(id),
  occurred_at timestamptz NOT NULL DEFAULT now(), correlation_id uuid NOT NULL,
  FOREIGN KEY(process_step_id,organization_id) REFERENCES process_step(id,organization_id)
);
CREATE TABLE task (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  unit_id uuid NOT NULL, process_id uuid, kind text NOT NULL, status text NOT NULL DEFAULT 'OPEN',
  assigned_role text, assigned_user_id uuid REFERENCES app_user(id), due_at timestamptz,
  context jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,organization_id), FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id),
  FOREIGN KEY(process_id,organization_id) REFERENCES process(id,organization_id)
);
CREATE INDEX task_queue_idx ON task(organization_id,unit_id,status,due_at);
