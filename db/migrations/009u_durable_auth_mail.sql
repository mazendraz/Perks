ALTER TABLE users ADD COLUMN preferred_locale text NOT NULL DEFAULT 'ar' CHECK(preferred_locale IN ('ar','en'));
CREATE TABLE auth_mail_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),
 kind text NOT NULL CHECK(kind IN ('password_reset','password_changed')),reset_token_id uuid REFERENCES password_reset_tokens(id),
 credential_version integer NOT NULL,payload jsonb NOT NULL DEFAULT '{}',locale text NOT NULL CHECK(locale IN ('ar','en')),
 dedupe_key text NOT NULL UNIQUE,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','sent','failed','blocked','unknown')),
 attempts integer NOT NULL DEFAULT 0,next_run_at timestamptz NOT NULL DEFAULT now(),lease_id uuid,lease_until timestamptz,last_error text
);
CREATE INDEX auth_mail_due ON auth_mail_outbox(next_run_at) WHERE status IN ('pending','running','failed');
REVOKE ALL ON auth_mail_outbox FROM PUBLIC;
GRANT SELECT,INSERT ON auth_mail_outbox TO nuqta_auth;
ALTER TABLE auth_mail_outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY auth_mail_auth ON auth_mail_outbox USING(current_user='nuqta_auth') WITH CHECK(current_user='nuqta_auth');

CREATE FUNCTION notify_password_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.password_hash IS NOT NULL AND NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN
  INSERT INTO auth_mail_outbox(user_id,kind,credential_version,locale,dedupe_key,expires_at)
   VALUES(NEW.id,'password_changed',NEW.password_version,NEW.preferred_locale,'password-changed:'||NEW.id||':'||NEW.password_version,clock_timestamp()+interval '1 day') ON CONFLICT(dedupe_key) DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION notify_password_change() FROM PUBLIC;
CREATE TRIGGER password_change_mail AFTER UPDATE OF password_hash ON users FOR EACH ROW EXECUTE FUNCTION notify_password_change();

CREATE FUNCTION claim_auth_mail() RETURNS TABLE(mail_id uuid,kind text,email text,locale text,payload jsonb,expires_at timestamptz,lease_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE selected auth_mail_outbox;lease uuid;
BEGIN
 UPDATE auth_mail_outbox j SET status='blocked',last_error='AUTH_MAIL_STALE',lease_until=NULL WHERE j.status IN ('pending','failed') AND (
  j.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=j.user_id AND u.status='active') OR
  (j.kind='password_reset' AND NOT EXISTS(SELECT 1 FROM password_reset_tokens t JOIN users u ON u.id=t.user_id WHERE t.id=j.reset_token_id AND t.user_id=j.user_id AND t.used_at IS NULL AND t.expires_at>clock_timestamp() AND t.credential_version=u.password_version))
 );
 UPDATE auth_mail_outbox SET status='blocked',last_error='MAX_ATTEMPTS',lease_until=NULL WHERE status IN ('failed','running') AND attempts>=5 AND (lease_until IS NULL OR lease_until<clock_timestamp());
 SELECT * INTO selected FROM auth_mail_outbox j WHERE ((j.status IN ('pending','failed') AND j.next_run_at<=clock_timestamp()) OR (j.status='running' AND j.lease_until<clock_timestamp())) AND j.attempts<5 ORDER BY j.next_run_at,j.id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN;END IF;
 lease=gen_random_uuid();
 UPDATE auth_mail_outbox SET status='running',attempts=attempts+1,lease_id=lease,lease_until=clock_timestamp()+interval '60 seconds' WHERE id=selected.id;
 RETURN QUERY SELECT selected.id,selected.kind,u.email,selected.locale,selected.payload,selected.expires_at,lease FROM users u WHERE u.id=selected.user_id;
END $$;
CREATE FUNCTION finish_auth_mail(mail_arg uuid,lease_arg uuid,status_arg text,error_arg text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE changed integer;
BEGIN
 IF status_arg NOT IN ('sent','failed','blocked','unknown') OR (error_arg IS NOT NULL AND error_arg NOT IN ('SMTP_UNKNOWN','SMTP_UNAVAILABLE','SMTP_REJECTED','MAIL_INTENT_CONFLICT','MAIL_EXECUTION_FAILED')) THEN RAISE EXCEPTION 'NQ:INVALID_MAIL_OUTCOME';END IF;
 UPDATE auth_mail_outbox SET status=status_arg,last_error=error_arg,lease_until=NULL,next_run_at=clock_timestamp()+interval '30 seconds' WHERE id=mail_arg AND lease_id=lease_arg AND status='running' AND lease_until>clock_timestamp();
 GET DIAGNOSTICS changed=ROW_COUNT;RETURN changed=1;
END $$;
REVOKE ALL ON FUNCTION claim_auth_mail(),finish_auth_mail(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_auth_mail(),finish_auth_mail(uuid,uuid,text,text) TO nuqta_worker;

CREATE TABLE mail_delivery_receipts (
 id uuid PRIMARY KEY,payload_hash text NOT NULL,dispatch_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('sending','sent','unknown','retryable','rejected')),
 error_code text,started_at timestamptz NOT NULL DEFAULT now(),finished_at timestamptz
);
REVOKE ALL ON mail_delivery_receipts FROM PUBLIC;
CREATE FUNCTION begin_mail_delivery(id_arg uuid,hash_arg text,dispatch_arg uuid) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE receipt mail_delivery_receipts;
BEGIN
 IF hash_arg !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'NQ:MAIL_INTENT_CONFLICT';END IF;
 INSERT INTO mail_delivery_receipts(id,payload_hash,dispatch_id,state) VALUES(id_arg,hash_arg,dispatch_arg,'sending') ON CONFLICT DO NOTHING;
 SELECT * INTO receipt FROM mail_delivery_receipts WHERE id=id_arg FOR UPDATE;
 IF receipt.payload_hash<>hash_arg THEN RETURN 'conflict';END IF;
 IF receipt.state='sent' THEN RETURN 'sent';END IF;
 IF receipt.dispatch_id=dispatch_arg THEN RETURN 'dispatch';END IF;
 IF receipt.state='retryable' THEN UPDATE mail_delivery_receipts SET state='sending',dispatch_id=dispatch_arg,started_at=clock_timestamp(),finished_at=NULL,error_code=NULL WHERE id=id_arg;RETURN 'dispatch';END IF;
 IF receipt.state='sending' THEN UPDATE mail_delivery_receipts SET state='unknown',error_code='SMTP_UNKNOWN' WHERE id=id_arg;END IF;
 RETURN CASE WHEN receipt.state='rejected' THEN 'rejected' ELSE 'unknown' END;
END $$;
CREATE FUNCTION finish_mail_delivery(id_arg uuid,dispatch_arg uuid,state_arg text,error_arg text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE changed integer;
BEGIN
 IF state_arg NOT IN ('sent','unknown','retryable','rejected') OR (error_arg IS NOT NULL AND error_arg NOT IN ('SMTP_UNKNOWN','SMTP_UNAVAILABLE','SMTP_REJECTED')) THEN RAISE EXCEPTION 'NQ:INVALID_MAIL_OUTCOME';END IF;
 UPDATE mail_delivery_receipts SET state=state_arg,error_code=error_arg,finished_at=clock_timestamp() WHERE id=id_arg AND dispatch_id=dispatch_arg AND state='sending';
 GET DIAGNOSTICS changed=ROW_COUNT;RETURN changed=1;
END $$;
REVOKE ALL ON FUNCTION begin_mail_delivery(uuid,text,uuid),finish_mail_delivery(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION begin_mail_delivery(uuid,text,uuid),finish_mail_delivery(uuid,uuid,text,text) TO nuqta_worker;

CREATE FUNCTION invitation_mail_context(mid uuid,iid uuid,hash_arg text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('name',m.name,'email',i.email,'locale',(SELECT preferred_locale FROM users WHERE email=i.email),'expiresAt',i.expires_at) FROM invitations i JOIN merchants m ON m.id=i.merchant_id WHERE i.id=iid AND i.merchant_id=mid AND i.status='pending' AND i.expires_at>clock_timestamp() AND i.token_hash=hash_arg
$$;
REVOKE ALL ON FUNCTION invitation_mail_context(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION invitation_mail_context(uuid,uuid,text) TO nuqta_worker;
