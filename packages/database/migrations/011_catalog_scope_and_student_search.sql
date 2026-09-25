-- New API-created packages belong to one unit. Existing catalog rows remain
-- shared (NULL) so historical development enrollments keep their meaning.
ALTER TABLE package ADD COLUMN unit_id uuid;
ALTER TABLE package ADD CONSTRAINT package_unit_tenant_fk
  FOREIGN KEY(unit_id,organization_id) REFERENCES unit(id,organization_id);
CREATE INDEX package_scope_idx ON package(organization_id,unit_id);

CREATE FUNCTION validate_enrollment_package_scope() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_package_unit uuid;
BEGIN
  SELECT pa.unit_id INTO v_package_unit
  FROM package_version pv JOIN package pa ON pa.id=pv.package_id AND pa.organization_id=pv.organization_id
  WHERE pv.id=NEW.package_version_id AND pv.organization_id=NEW.organization_id;
  IF FOUND AND v_package_unit IS NOT NULL AND v_package_unit<>NEW.unit_id THEN
    RAISE EXCEPTION 'package version is outside enrollment unit';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER enrollment_package_scope_guard
  BEFORE INSERT OR UPDATE OF organization_id,unit_id,package_version_id ON enrollment
  FOR EACH ROW EXECUTE FUNCTION validate_enrollment_package_scope();

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX person_name_trgm_idx ON person USING gin (lower(full_name) gin_trgm_ops);
CREATE INDEX person_contact_value_trgm_idx ON person_contact USING gin (value gin_trgm_ops)
  WHERE kind='PHONE';
CREATE INDEX audit_timeline_idx ON audit_event(organization_id,occurred_at DESC,id DESC);
