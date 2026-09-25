ALTER TABLE enrollment ADD CONSTRAINT active_enrollment_has_snapshot
  CHECK (status NOT IN ('ACTIVE','COMPLETED') OR package_snapshot IS NOT NULL);

CREATE FUNCTION guard_workflow_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM workflow_version WHERE definition_id=OLD.id AND published_at IS NOT NULL) THEN
    RAISE EXCEPTION 'published workflow definition is immutable';
  END IF;
  RETURN COALESCE(NEW,OLD);
END $$;
CREATE TRIGGER workflow_definition_guard BEFORE UPDATE OR DELETE ON workflow_definition
  FOR EACH ROW EXECUTE FUNCTION guard_workflow_definition();

CREATE FUNCTION validate_process_links() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_student uuid; v_unit uuid; v_service text; v_workflow_service text;
BEGIN
  SELECT e.student_id,e.unit_id,p.service_type INTO v_student,v_unit,v_service
  FROM enrollment e JOIN package_version pv ON pv.id=e.package_version_id AND pv.organization_id=e.organization_id
  JOIN package pa ON pa.id=pv.package_id AND pa.organization_id=pv.organization_id
  JOIN product p ON p.id=pa.product_id AND p.organization_id=pa.organization_id
  WHERE e.id=NEW.enrollment_id AND e.organization_id=NEW.organization_id;
  SELECT wd.service_type INTO v_workflow_service FROM workflow_version wv
    JOIN workflow_definition wd ON wd.id=wv.definition_id AND wd.organization_id=wv.organization_id
    WHERE wv.id=NEW.workflow_version_id AND wv.organization_id=NEW.organization_id AND wv.published_at IS NOT NULL;
  IF v_student IS DISTINCT FROM NEW.student_id OR v_unit IS DISTINCT FROM NEW.unit_id
    OR v_service IS DISTINCT FROM v_workflow_service THEN
    RAISE EXCEPTION 'process links do not match enrollment and published workflow';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER process_links_guard BEFORE INSERT OR UPDATE OF organization_id,unit_id,student_id,enrollment_id,workflow_version_id ON process
  FOR EACH ROW EXECUTE FUNCTION validate_process_links();

CREATE FUNCTION validate_step_workflow() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_process_workflow uuid; v_step_workflow uuid;
BEGIN
  SELECT workflow_version_id INTO v_process_workflow FROM process
    WHERE id=NEW.process_id AND organization_id=NEW.organization_id;
  SELECT workflow_version_id INTO v_step_workflow FROM workflow_step_definition
    WHERE id=NEW.definition_step_id AND organization_id=NEW.organization_id;
  IF v_process_workflow IS DISTINCT FROM v_step_workflow THEN
    RAISE EXCEPTION 'step definition belongs to another workflow';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER process_step_workflow_guard BEFORE INSERT OR UPDATE OF organization_id,process_id,definition_step_id ON process_step
  FOR EACH ROW EXECUTE FUNCTION validate_step_workflow();

CREATE FUNCTION validate_task_process_step() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.process_step_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM process_step ps JOIN process p ON p.id=ps.process_id AND p.organization_id=ps.organization_id
    WHERE ps.id=NEW.process_step_id AND ps.organization_id=NEW.organization_id
      AND ps.process_id=NEW.process_id AND p.unit_id=NEW.unit_id
  ) THEN RAISE EXCEPTION 'task step is outside process or unit'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER task_process_step_guard BEFORE INSERT OR UPDATE OF organization_id,unit_id,process_id,process_step_id ON task
  FOR EACH ROW EXECUTE FUNCTION validate_task_process_step();
