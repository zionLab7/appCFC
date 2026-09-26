CREATE TRIGGER document_versions_immutable BEFORE UPDATE OR DELETE ON document_version
  FOR EACH ROW EXECUTE FUNCTION reject_immutable_mutation();

CREATE FUNCTION contract_document_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.document_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM document d JOIN enrollment e
      ON e.id=NEW.enrollment_id AND e.organization_id=NEW.organization_id
    WHERE d.id=NEW.document_id AND d.organization_id=NEW.organization_id
      AND d.unit_id=e.unit_id AND d.owner_type='ENROLLMENT'
      AND d.owner_id=NEW.enrollment_id AND d.kind='CONTRACT'
  ) THEN RAISE EXCEPTION 'contract document must belong to the same enrollment';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER contract_document_consistency_check BEFORE INSERT OR UPDATE OF document_id,enrollment_id
  ON contract FOR EACH ROW EXECUTE FUNCTION contract_document_consistency();
