ALTER TABLE customer_exports ALTER COLUMN expires_at SET DEFAULT now()+interval '24 hours';
-- Expired proof rows keep their audit identity, without retaining auth sessions forever.
ALTER TABLE presentation_tokens ALTER COLUMN session_id DROP NOT NULL;
ALTER TABLE presentation_tokens DROP CONSTRAINT presentation_tokens_session_id_fkey;
ALTER TABLE presentation_tokens ADD CONSTRAINT presentation_tokens_session_id_fkey FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE redemption_challenges ALTER COLUMN cashier_session_id DROP NOT NULL;
ALTER TABLE redemption_challenges DROP CONSTRAINT redemption_challenges_cashier_session_id_fkey;
ALTER TABLE redemption_challenges ADD CONSTRAINT redemption_challenges_cashier_session_id_fkey FOREIGN KEY(cashier_session_id) REFERENCES sessions(id) ON DELETE SET NULL;
ALTER TABLE mfa_enrollments DROP CONSTRAINT mfa_enrollments_session_id_fkey;
ALTER TABLE mfa_enrollments ADD CONSTRAINT mfa_enrollments_session_id_fkey FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE;
CREATE INDEX presentation_session_retention ON presentation_tokens(session_id);
CREATE INDEX redemption_session_retention ON redemption_challenges(cashier_session_id);
CREATE FUNCTION sweep_expired_sessions() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE removed integer;
BEGIN
 IF session_user<>'nuqta_worker' THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 DELETE FROM sessions WHERE id IN(SELECT id FROM sessions WHERE expires_at<clock_timestamp()-interval '90 days'
 ORDER BY expires_at,id LIMIT 500 FOR UPDATE SKIP LOCKED);
 GET DIAGNOSTICS removed=ROW_COUNT;
 RETURN removed;
END $$;
REVOKE ALL ON FUNCTION sweep_expired_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sweep_expired_sessions() TO nuqta_worker;
