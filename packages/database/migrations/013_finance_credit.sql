INSERT INTO permission(code,description) VALUES
  ('credit.read','Consultar créditos da matrícula'),
  ('finance.read','Consultar recebíveis e pagamentos da unidade')
ON CONFLICT DO NOTHING;

-- One synthetic commercial receivable is created per activation. Later payment
-- plans can split this receivable into more installments without duplicating it.
CREATE UNIQUE INDEX receivable_one_per_enrollment ON receivable(enrollment_id);
CREATE INDEX credit_ledger_wallet_idx ON credit_ledger_entry(wallet_id,occurred_at,id);
CREATE INDEX payment_allocation_installment_idx ON payment_allocation(installment_id);

CREATE FUNCTION assert_payment_allocation_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_payment_unit uuid; v_installment_unit uuid; v_payment_status text;
BEGIN
  SELECT unit_id,status INTO v_payment_unit,v_payment_status FROM payment
    WHERE id=NEW.payment_id AND organization_id=NEW.organization_id;
  SELECT r.unit_id INTO v_installment_unit FROM installment i
    JOIN receivable r ON r.id=i.receivable_id AND r.organization_id=i.organization_id
    WHERE i.id=NEW.installment_id AND i.organization_id=NEW.organization_id;
  IF v_payment_unit IS NULL OR v_installment_unit IS NULL OR v_payment_unit<>v_installment_unit
     OR v_payment_status<>'SETTLED' THEN
    RAISE EXCEPTION 'payment allocation outside settled unit';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_allocation_scope BEFORE INSERT ON payment_allocation
  FOR EACH ROW EXECUTE FUNCTION assert_payment_allocation_scope();
