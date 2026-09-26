CREATE OR REPLACE FUNCTION validate_payment_allocation() RETURNS trigger LANGUAGE plpgsql AS $$
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
  SELECT coalesce(sum(pa.amount_cents-coalesce(rev.amount_cents,0)),0) INTO v_allocated
    FROM payment_allocation pa LEFT JOIN (
      SELECT allocation_id,sum(amount_cents) AS amount_cents FROM payment_allocation_reversal GROUP BY allocation_id
    ) rev ON rev.allocation_id=pa.id WHERE pa.installment_id=NEW.installment_id;
  IF v_allocated+NEW.amount_cents>v_installment THEN RAISE EXCEPTION 'installment overpaid'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION validate_payment_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_amount bigint; v_refunded bigint; v_status text;
BEGIN
  SELECT amount_cents,status INTO v_amount,v_status FROM payment
    WHERE id=NEW.payment_id AND organization_id=NEW.organization_id FOR UPDATE;
  IF v_amount IS NULL OR v_status NOT IN ('SETTLED','REFUNDED') THEN RAISE EXCEPTION 'payment not refundable'; END IF;
  SELECT coalesce(sum(amount_cents),0) INTO v_refunded FROM payment_refund WHERE payment_id=NEW.payment_id;
  IF v_refunded+NEW.amount_cents>v_amount THEN RAISE EXCEPTION 'payment overrefunded'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_refund_guard BEFORE INSERT ON payment_refund
  FOR EACH ROW EXECUTE FUNCTION validate_payment_refund();

CREATE FUNCTION validate_allocation_reversal() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_payment uuid; v_allocation_amount bigint; v_refund_payment uuid; v_refund_amount bigint;
DECLARE v_reversed bigint;
BEGIN
  SELECT payment_id,amount_cents INTO v_payment,v_allocation_amount FROM payment_allocation
    WHERE id=NEW.allocation_id AND organization_id=NEW.organization_id FOR UPDATE;
  SELECT payment_id,amount_cents INTO v_refund_payment,v_refund_amount FROM payment_refund
    WHERE id=NEW.refund_id AND organization_id=NEW.organization_id FOR UPDATE;
  IF v_payment IS NULL OR v_refund_payment IS NULL OR v_payment<>v_refund_payment THEN
    RAISE EXCEPTION 'refund allocation belongs to another payment'; END IF;
  SELECT coalesce(sum(amount_cents),0) INTO v_reversed FROM payment_allocation_reversal
    WHERE allocation_id=NEW.allocation_id;
  IF v_reversed+NEW.amount_cents>v_allocation_amount THEN RAISE EXCEPTION 'allocation overreversed'; END IF;
  SELECT coalesce(sum(amount_cents),0) INTO v_reversed FROM payment_allocation_reversal
    WHERE refund_id=NEW.refund_id;
  IF v_reversed+NEW.amount_cents>v_refund_amount THEN RAISE EXCEPTION 'refund overallocated'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_reversal_guard BEFORE INSERT ON payment_allocation_reversal
  FOR EACH ROW EXECUTE FUNCTION validate_allocation_reversal();

CREATE TRIGGER payment_refund_no_mutation BEFORE UPDATE OR DELETE ON payment_refund
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
CREATE TRIGGER payment_reversal_no_mutation BEFORE UPDATE OR DELETE ON payment_allocation_reversal
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();
