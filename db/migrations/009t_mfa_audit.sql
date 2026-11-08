CREATE FUNCTION record_mfa_event(uid uuid,sid uuid,event_arg text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF event_arg NOT IN ('setup','enrolled','verified','recovered') OR NOT EXISTS(
  SELECT 1 FROM users u JOIN sessions s ON s.user_id=u.id WHERE u.id=uid AND u.status='active' AND s.id=sid AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND s.credential_version=u.password_version
 ) THEN RAISE EXCEPTION 'NQ:UNAUTHENTICATED';END IF;
 INSERT INTO audit_events(actor_id,action,target_id,detail) VALUES(uid,'auth.mfa.'||event_arg,uid,jsonb_build_object('sessionId',sid));
END $$;
REVOKE ALL ON FUNCTION record_mfa_event(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_mfa_event(uuid,uuid,text) TO nuqta_auth;
