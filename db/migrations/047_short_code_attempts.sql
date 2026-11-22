-- Wrong 6-digit customer codes, counted in the database (replaces an in-memory counter).
-- The old counter lived in one API process: it reset on every restart, was not shared between
-- servers, and was kept per session, so signing in again gave a fresh 8 guesses.
-- Now: at most 8 wrong codes per staff member in 10 minutes, whatever server or session.

CREATE TABLE short_code_failures (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX short_code_failures_recent ON short_code_failures(user_id,at DESC);
ALTER TABLE short_code_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON short_code_failures FROM PUBLIC;

-- The signed-in staff member (app.user_id) may try another code.
CREATE FUNCTION short_code_attempt_allowed() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT app_user() IS NOT NULL AND (SELECT count(*) FROM short_code_failures
  WHERE user_id=app_user() AND at>clock_timestamp()-interval '10 minutes')<8
$$;
REVOKE ALL ON FUNCTION short_code_attempt_allowed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION short_code_attempt_allowed() TO nuqta_runtime;

-- Records one wrong code for the signed-in staff member and forgets anything older than a day.
CREATE FUNCTION short_code_failed() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF app_user() IS NULL THEN RETURN; END IF;
 DELETE FROM short_code_failures WHERE user_id=app_user() AND at<clock_timestamp()-interval '1 day';
 INSERT INTO short_code_failures(user_id) VALUES(app_user());
END $$;
REVOKE ALL ON FUNCTION short_code_failed() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION short_code_failed() TO nuqta_runtime;
