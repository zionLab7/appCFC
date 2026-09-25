CREATE TABLE resource (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  home_unit_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('INSTRUCTOR','VEHICLE','ROOM','SIMULATOR')),
  name text NOT NULL, category text, active boolean NOT NULL DEFAULT true,
  UNIQUE(id,organization_id), FOREIGN KEY(home_unit_id,organization_id) REFERENCES unit(id,organization_id)
);
CREATE TABLE resource_availability (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  resource_id uuid NOT NULL, weekday smallint NOT NULL CHECK(weekday BETWEEN 0 AND 6),
  starts_at time NOT NULL, ends_at time NOT NULL, valid_from date NOT NULL,
  valid_until date, CHECK(starts_at<ends_at),
  FOREIGN KEY(resource_id,organization_id) REFERENCES resource(id,organization_id)
);
CREATE TABLE resource_block (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  resource_id uuid NOT NULL, during tstzrange NOT NULL, reason text NOT NULL,
  CHECK(NOT isempty(during)), FOREIGN KEY(resource_id,organization_id) REFERENCES resource(id,organization_id)
);
CREATE INDEX resource_block_overlap_idx ON resource_block USING gist(resource_id,during);
CREATE TABLE lesson (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  unit_id uuid NOT NULL, student_id uuid NOT NULL, process_id uuid NOT NULL,
  during tstzrange NOT NULL, category text NOT NULL,
  status text NOT NULL DEFAULT 'RESERVED' CHECK(status IN
    ('DRAFT','RESERVED','CONFIRMED','CHECKED_IN','IN_PROGRESS','COMPLETED','STUDENT_ABSENT',
     'INSTRUCTOR_ABSENT','CANCELLED_BY_STUDENT','CANCELLED_BY_CFC','RESCHEDULED')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,organization_id),
  CHECK(NOT isempty(during) AND lower_inc(during) AND NOT upper_inc(during)),
  FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id),
  FOREIGN KEY(student_id,organization_id) REFERENCES student(id,organization_id),
  FOREIGN KEY(process_id,organization_id) REFERENCES process(id,organization_id),
  CONSTRAINT lesson_student_no_overlap EXCLUDE USING gist (student_id WITH =, during WITH &&)
    WHERE (status IN ('RESERVED','CONFIRMED','CHECKED_IN','IN_PROGRESS'))
);
CREATE TABLE resource_booking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  lesson_id uuid NOT NULL, resource_id uuid NOT NULL,
  during tstzrange NOT NULL, status text NOT NULL DEFAULT 'HELD'
    CHECK(status IN ('HELD','CONFIRMED','RELEASED')),
  UNIQUE(lesson_id,resource_id), CHECK(NOT isempty(during)),
  FOREIGN KEY(lesson_id,organization_id) REFERENCES lesson(id,organization_id),
  FOREIGN KEY(resource_id,organization_id) REFERENCES resource(id,organization_id),
  CONSTRAINT resource_no_overlap EXCLUDE USING gist (resource_id WITH =, during WITH &&)
    WHERE (status IN ('HELD','CONFIRMED'))
);
-- Reservation service must check that booking.during equals lesson.during and that
-- resource blocks/availability/category match. Exclusion constraints prevent races.
CREATE TABLE lesson_attendance (
  lesson_id uuid PRIMARY KEY REFERENCES lesson(id), student_present boolean,
  instructor_present boolean, checked_at timestamptz
);
CREATE TABLE lesson_evaluation (
  lesson_id uuid PRIMARY KEY REFERENCES lesson(id), score jsonb NOT NULL,
  instructor_user_id uuid REFERENCES app_user(id), recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credit_wallet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  enrollment_id uuid NOT NULL, item_type text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,organization_id), UNIQUE(enrollment_id,item_type),
  FOREIGN KEY(enrollment_id,organization_id) REFERENCES enrollment(id,organization_id)
);
CREATE TABLE credit_ledger_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  wallet_id uuid NOT NULL, kind text NOT NULL
    CHECK(kind IN ('GRANT','CONSUME','RESTORE','EXPIRE','ADJUST','REVERSAL')),
  quantity integer NOT NULL CHECK(quantity<>0), source_type text NOT NULL,
  source_id uuid NOT NULL, reversal_of uuid REFERENCES credit_ledger_entry(id),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(wallet_id,source_type,source_id,kind),
  FOREIGN KEY(wallet_id,organization_id) REFERENCES credit_wallet(id,organization_id)
);
CREATE TABLE credit_reservation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  wallet_id uuid NOT NULL, lesson_id uuid NOT NULL, quantity integer NOT NULL CHECK(quantity>0),
  status text NOT NULL DEFAULT 'HELD' CHECK(status IN ('HELD','CONSUMED','RELEASED')),
  UNIQUE(lesson_id,wallet_id),
  FOREIGN KEY(wallet_id,organization_id) REFERENCES credit_wallet(id,organization_id),
  FOREIGN KEY(lesson_id,organization_id) REFERENCES lesson(id,organization_id)
);
-- Production writes to both credit tables must use one transaction: SELECT wallet
-- FOR UPDATE, calculate SUM(ledger.quantity)-SUM(held.quantity), apply and append.

CREATE TABLE receivable (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  unit_id uuid NOT NULL, enrollment_id uuid NOT NULL,
  amount_cents bigint NOT NULL CHECK(amount_cents>0), currency char(3) NOT NULL DEFAULT 'BRL',
  status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','PARTIALLY_PAID','PAID','OVERDUE','CANCELLED')),
  created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,organization_id),
  FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id),
  FOREIGN KEY(enrollment_id,organization_id) REFERENCES enrollment(id,organization_id)
);
CREATE TABLE installment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  receivable_id uuid NOT NULL, number integer NOT NULL CHECK(number>0),
  due_date date NOT NULL, amount_cents bigint NOT NULL CHECK(amount_cents>0),
  UNIQUE(id,organization_id), UNIQUE(receivable_id,number),
  FOREIGN KEY(receivable_id,organization_id) REFERENCES receivable(id,organization_id)
);
CREATE TABLE payment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  unit_id uuid NOT NULL, amount_cents bigint NOT NULL CHECK(amount_cents>0), currency char(3) NOT NULL DEFAULT 'BRL',
  method text NOT NULL CHECK(method IN ('CASH','PIX','DEBIT_CARD','CREDIT_CARD','BOLETO','TRANSFER','GATEWAY')),
  status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','SETTLED','REFUNDED','FAILED')),
  external_reference text, occurred_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,organization_id),
  FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id),
  UNIQUE(organization_id,external_reference)
);
CREATE TABLE payment_allocation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  payment_id uuid NOT NULL, installment_id uuid NOT NULL, amount_cents bigint NOT NULL CHECK(amount_cents>0),
  UNIQUE(payment_id,installment_id),
  FOREIGN KEY(payment_id,organization_id) REFERENCES payment(id,organization_id),
  FOREIGN KEY(installment_id,organization_id) REFERENCES installment(id,organization_id)
);
CREATE TABLE financial_account (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  code text NOT NULL, name text NOT NULL, kind text NOT NULL,
  UNIQUE(id,organization_id), UNIQUE(organization_id,code)
);
CREATE TABLE journal_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  unit_id uuid, source_type text NOT NULL, source_id uuid NOT NULL,
  reversal_of uuid REFERENCES journal_entry(id), currency char(3) NOT NULL DEFAULT 'BRL',
  occurred_at timestamptz NOT NULL DEFAULT now(), UNIQUE(id,organization_id),
  UNIQUE(organization_id,source_type,source_id),
  FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id)
);
CREATE TABLE journal_line (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  entry_id uuid NOT NULL, account_id uuid NOT NULL,
  debit_cents bigint NOT NULL DEFAULT 0 CHECK(debit_cents>=0),
  credit_cents bigint NOT NULL DEFAULT 0 CHECK(credit_cents>=0),
  CHECK((debit_cents>0) <> (credit_cents>0)),
  FOREIGN KEY(entry_id,organization_id) REFERENCES journal_entry(id,organization_id),
  FOREIGN KEY(account_id,organization_id) REFERENCES financial_account(id,organization_id)
);
CREATE FUNCTION assert_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_entry uuid; v_count integer; v_debit bigint; v_credit bigint;
BEGIN
  v_entry := COALESCE(NEW.entry_id, OLD.entry_id);
  SELECT count(*),coalesce(sum(debit_cents),0),coalesce(sum(credit_cents),0)
    INTO v_count,v_debit,v_credit FROM journal_line WHERE entry_id=v_entry;
  IF v_count<2 OR v_debit<>v_credit THEN RAISE EXCEPTION 'unbalanced journal entry %',v_entry; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_balanced_after_line
  AFTER INSERT OR UPDATE OR DELETE ON journal_line DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_journal_balanced();
CREATE TABLE payable (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  unit_id uuid NOT NULL, vendor_name text NOT NULL, due_date date NOT NULL,
  amount_cents bigint NOT NULL CHECK(amount_cents>0), status text NOT NULL DEFAULT 'OPEN',
  FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id)
);
CREATE TABLE bank_transaction (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  external_id text NOT NULL, occurred_at timestamptz NOT NULL, amount_cents bigint NOT NULL,
  status text NOT NULL DEFAULT 'UNMATCHED', UNIQUE(organization_id,external_id)
);
