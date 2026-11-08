CREATE FUNCTION guard_published_program_branch() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM program_versions target JOIN programs p ON p.id=target.program_id JOIN program_versions current ON current.id=p.current_version_id WHERE target.id=NEW.program_version_id AND current.version>=target.version) OR EXISTS(SELECT 1 FROM memberships WHERE program_version_id=NEW.program_version_id) THEN RAISE EXCEPTION 'published program branch snapshot is immutable';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER no_published_branch_insert BEFORE INSERT ON program_branches FOR EACH ROW EXECUTE FUNCTION guard_published_program_branch();
