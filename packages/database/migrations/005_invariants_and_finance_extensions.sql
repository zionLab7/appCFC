CREATE TABLE payment_refund (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  payment_id uuid NOT NULL, amount_cents bigint NOT NULL CHECK(amount_cents>0),
  reason text NOT NULL, external_reference text, occurred_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,organization_id), UNIQUE(organization_id,external_reference),
  FOREIGN KEY(payment_id,organization_id) REFERENCES payment(id,organization_id)
);
CREATE TABLE payment_allocation_reversal (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  refund_id uuid NOT NULL, allocation_id uuid NOT NULL,
  amount_cents bigint NOT NULL CHECK(amount_cents>0),
  FOREIGN KEY(refund_id,organization_id) REFERENCES payment_refund(id,organization_id),
  FOREIGN KEY(allocation_id) REFERENCES payment_allocation(id)
);
CREATE TABLE cash_session (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL REFERENCES organization(id),
  unit_id uuid NOT NULL, opened_by uuid NOT NULL REFERENCES app_user(id),
  opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
  opening_cents bigint NOT NULL DEFAULT 0, closing_cents bigint,
  UNIQUE(id,organization_id), FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id)
);
CREATE TABLE cash_entry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  session_id uuid NOT NULL, kind text NOT NULL CHECK(kind IN ('RECEIPT','EXPENSE','CASH_IN','CASH_OUT')),
  amount_cents bigint NOT NULL CHECK(amount_cents>0), payment_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(session_id,organization_id) REFERENCES cash_session(id,organization_id),
  FOREIGN KEY(payment_id,organization_id) REFERENCES payment(id,organization_id)
);
CREATE TABLE bank_reconciliation (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL,
  bank_transaction_id uuid NOT NULL, payment_id uuid NOT NULL,
  matched_by uuid REFERENCES app_user(id), matched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(bank_transaction_id), UNIQUE(payment_id),
  FOREIGN KEY(bank_transaction_id) REFERENCES bank_transaction(id),
  FOREIGN KEY(payment_id,organization_id) REFERENCES payment(id,organization_id)
);

-- Tenant-scoped composite FK references for extension tables.
ALTER TABLE payment_allocation ADD CONSTRAINT payment_allocation_id_org_uniq UNIQUE(id,organization_id);
ALTER TABLE payment_allocation_reversal DROP CONSTRAINT payment_allocation_reversal_allocation_id_fkey;
ALTER TABLE payment_allocation_reversal ADD CONSTRAINT reversal_allocation_tenant_fk
  FOREIGN KEY(allocation_id,organization_id) REFERENCES payment_allocation(id,organization_id);
ALTER TABLE bank_transaction ADD CONSTRAINT bank_transaction_id_org_uniq UNIQUE(id,organization_id);
ALTER TABLE bank_reconciliation DROP CONSTRAINT bank_reconciliation_bank_transaction_id_fkey;
ALTER TABLE bank_reconciliation ADD CONSTRAINT reconciliation_transaction_tenant_fk
  FOREIGN KEY(bank_transaction_id,organization_id) REFERENCES bank_transaction(id,organization_id);

-- Every journal header must have balanced lines at commit, even if no lines
-- were ever inserted. The existing deferred line trigger covers line changes.
CREATE FUNCTION assert_journal_header_complete() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_count integer; v_debit bigint; v_credit bigint;
BEGIN
  SELECT count(*),coalesce(sum(debit_cents),0),coalesce(sum(credit_cents),0)
  INTO v_count,v_debit,v_credit FROM journal_line WHERE entry_id=NEW.id;
  IF v_count<2 OR v_debit<>v_credit THEN RAISE EXCEPTION 'unbalanced journal entry %',NEW.id; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_complete_after_header
  AFTER INSERT ON journal_entry DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_journal_header_complete();

-- Serializing on the wallet row makes concurrent grants/holds/consumption safe.
CREATE FUNCTION validate_credit_entry() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_balance bigint; v_held bigint;
BEGIN
  PERFORM 1 FROM credit_wallet WHERE id=NEW.wallet_id AND organization_id=NEW.organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet not found'; END IF;
  SELECT coalesce(sum(quantity),0) INTO v_balance FROM credit_ledger_entry WHERE wallet_id=NEW.wallet_id;
  SELECT coalesce(sum(quantity),0) INTO v_held FROM credit_reservation WHERE wallet_id=NEW.wallet_id AND status='HELD';
  IF v_balance+NEW.quantity-v_held<0 THEN RAISE EXCEPTION 'insufficient credit'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_credit_posting BEFORE INSERT ON credit_ledger_entry
  FOR EACH ROW EXECUTE FUNCTION validate_credit_entry();
CREATE FUNCTION validate_credit_hold() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_balance bigint; v_held bigint;
BEGIN
  PERFORM 1 FROM credit_wallet WHERE id=NEW.wallet_id AND organization_id=NEW.organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'wallet not found'; END IF;
  SELECT coalesce(sum(quantity),0) INTO v_balance FROM credit_ledger_entry WHERE wallet_id=NEW.wallet_id;
  SELECT coalesce(sum(quantity),0) INTO v_held FROM credit_reservation WHERE wallet_id=NEW.wallet_id AND status='HELD';
  IF v_balance-v_held-NEW.quantity<0 THEN RAISE EXCEPTION 'insufficient credit'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_new_hold BEFORE INSERT ON credit_reservation
  FOR EACH ROW EXECUTE FUNCTION validate_credit_hold();
CREATE FUNCTION validate_credit_hold_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.quantity<>OLD.quantity OR NEW.wallet_id<>OLD.wallet_id OR NEW.lesson_id<>OLD.lesson_id
    OR NEW.organization_id<>OLD.organization_id THEN RAISE EXCEPTION 'hold identity immutable'; END IF;
  IF OLD.status='HELD' AND NEW.status IN ('CONSUMED','RELEASED') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'invalid hold transition';
END $$;
CREATE TRIGGER validate_hold_change BEFORE UPDATE ON credit_reservation
  FOR EACH ROW EXECUTE FUNCTION validate_credit_hold_update();
CREATE TRIGGER credit_hold_no_delete BEFORE DELETE ON credit_reservation
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE FUNCTION validate_payment_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_installment bigint; v_payment bigint; v_allocated bigint;
BEGIN
  PERFORM 1 FROM payment WHERE id=NEW.payment_id AND organization_id=NEW.organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment not found'; END IF;
  PERFORM 1 FROM installment WHERE id=NEW.installment_id AND organization_id=NEW.organization_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'installment not found'; END IF;
  SELECT amount_cents INTO v_payment FROM payment WHERE id=NEW.payment_id;
  SELECT amount_cents INTO v_installment FROM installment WHERE id=NEW.installment_id;
  SELECT coalesce(sum(amount_cents),0) INTO v_allocated FROM payment_allocation WHERE payment_id=NEW.payment_id;
  IF v_allocated+NEW.amount_cents>v_payment THEN RAISE EXCEPTION 'payment overallocated'; END IF;
  SELECT coalesce(sum(amount_cents),0) INTO v_allocated FROM payment_allocation WHERE installment_id=NEW.installment_id;
  IF v_allocated+NEW.amount_cents>v_installment THEN RAISE EXCEPTION 'installment overpaid'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_allocation_before_insert BEFORE INSERT ON payment_allocation
  FOR EACH ROW EXECUTE FUNCTION validate_payment_allocation();
CREATE TRIGGER allocation_no_mutation BEFORE UPDATE OR DELETE ON payment_allocation
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
