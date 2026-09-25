-- Published definitions stay stable even when clients bypass the API.
ALTER TABLE enrollment ADD COLUMN package_snapshot jsonb;
ALTER TABLE process ADD CONSTRAINT process_one_per_enrollment UNIQUE(enrollment_id);
ALTER TABLE task ADD COLUMN process_step_id uuid;
ALTER TABLE task ADD CONSTRAINT task_process_step_fk
  FOREIGN KEY(process_step_id,organization_id) REFERENCES process_step(id,organization_id);
CREATE UNIQUE INDEX task_one_per_process_step ON task(process_step_id,kind) WHERE process_step_id IS NOT NULL;
CREATE UNIQUE INDEX package_one_draft ON package_version(package_id) WHERE published_at IS NULL;

CREATE FUNCTION guard_package_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'published package version is immutable';
  END IF;
  IF TG_OP='UPDATE' AND OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'published package version is immutable';
  END IF;
  IF TG_OP='UPDATE' AND NEW.published_at IS NOT NULL AND
    (NEW.organization_id,NEW.package_id,NEW.version,NEW.price_cents,NEW.currency,NEW.terms)
    IS DISTINCT FROM
    (OLD.organization_id,OLD.package_id,OLD.version,OLD.price_cents,OLD.currency,OLD.terms) THEN
    RAISE EXCEPTION 'publish cannot change package terms';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER package_version_guard BEFORE UPDATE OR DELETE ON package_version
  FOR EACH ROW EXECUTE FUNCTION guard_package_version();

CREATE FUNCTION guard_package_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_published timestamptz;
BEGIN
  SELECT published_at INTO v_published FROM package_version
    WHERE id=COALESCE(OLD.package_version_id,NEW.package_version_id) FOR UPDATE;
  IF v_published IS NOT NULL THEN RAISE EXCEPTION 'published package items are immutable'; END IF;
  IF TG_OP='UPDATE' AND NEW.package_version_id<>OLD.package_version_id THEN
    RAISE EXCEPTION 'package item cannot move between versions';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER package_item_guard BEFORE INSERT OR UPDATE OR DELETE ON package_item
  FOR EACH ROW EXECUTE FUNCTION guard_package_item();

CREATE FUNCTION guard_published_catalog_parent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME='package' AND EXISTS (
    SELECT 1 FROM package_version WHERE package_id=OLD.id AND published_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'published package identity is immutable'; END IF;
  IF TG_TABLE_NAME='product' AND EXISTS (
    SELECT 1 FROM package pa JOIN package_version pv ON pv.package_id=pa.id
    WHERE pa.product_id=OLD.id AND pv.published_at IS NOT NULL
  ) THEN RAISE EXCEPTION 'published product identity is immutable'; END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER package_parent_guard BEFORE UPDATE OR DELETE ON package
  FOR EACH ROW EXECUTE FUNCTION guard_published_catalog_parent();
CREATE TRIGGER product_parent_guard BEFORE UPDATE OR DELETE ON product
  FOR EACH ROW EXECUTE FUNCTION guard_published_catalog_parent();

CREATE FUNCTION guard_published_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' AND OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'published workflow is immutable';
  END IF;
  IF TG_OP='UPDATE' AND OLD.published_at IS NOT NULL THEN
    RAISE EXCEPTION 'published workflow is immutable';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER workflow_version_guard BEFORE UPDATE OR DELETE ON workflow_version
  FOR EACH ROW EXECUTE FUNCTION guard_published_workflow();
CREATE FUNCTION guard_workflow_step() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_published timestamptz;
BEGIN
  SELECT published_at INTO v_published FROM workflow_version
    WHERE id=COALESCE(OLD.workflow_version_id,NEW.workflow_version_id) FOR UPDATE;
  IF v_published IS NOT NULL THEN RAISE EXCEPTION 'published workflow steps are immutable'; END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER workflow_step_guard BEFORE INSERT OR UPDATE OR DELETE ON workflow_step_definition
  FOR EACH ROW EXECUTE FUNCTION guard_workflow_step();

INSERT INTO permission(code,description) VALUES
  ('catalog.read','Consultar catálogo'),('catalog.write','Editar catálogo'),('catalog.publish','Publicar catálogo'),
  ('enrollment.read','Consultar matrícula'),('process.read','Consultar processo')
ON CONFLICT DO NOTHING;
