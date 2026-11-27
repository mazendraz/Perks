-- Self-service onboarding mail.
--  * merchant_welcome: the first email a new shop owner gets. It carries the same single-use
--    password link as password_reset, but greets a new account instead of reading like a reset
--    the owner never asked for.
--  * onboarding_payment_confirmed / onboarding_payment_rejected: the owner learns the outcome of
--    the InstaPay review without having to open the setup page to check.
--  * onboarding_receipt_submitted: every platform admin learns a receipt is waiting for review.
ALTER TABLE auth_mail_outbox DROP CONSTRAINT auth_mail_outbox_kind_check;
ALTER TABLE auth_mail_outbox ADD CONSTRAINT auth_mail_outbox_kind_check CHECK (kind IN (
 'password_reset','password_changed','merchant_welcome',
 'onboarding_payment_confirmed','onboarding_payment_rejected','onboarding_receipt_submitted'));

-- Same as 009u, with merchant_welcome treated like password_reset: it goes stale with its token.
CREATE OR REPLACE FUNCTION claim_auth_mail() RETURNS TABLE(mail_id uuid,kind text,email text,locale text,payload jsonb,expires_at timestamptz,lease_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE selected auth_mail_outbox;lease uuid;
BEGIN
 UPDATE auth_mail_outbox j SET status='blocked',last_error='AUTH_MAIL_STALE',lease_until=NULL WHERE j.status IN ('pending','failed') AND (
  j.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=j.user_id AND u.status='active') OR
  (j.kind IN ('password_reset','merchant_welcome') AND NOT EXISTS(SELECT 1 FROM password_reset_tokens t JOIN users u ON u.id=t.user_id WHERE t.id=j.reset_token_id AND t.user_id=j.user_id AND t.used_at IS NULL AND t.expires_at>clock_timestamp() AND t.credential_version=u.password_version))
 );
 UPDATE auth_mail_outbox SET status='blocked',last_error='MAX_ATTEMPTS',lease_until=NULL WHERE status IN ('failed','running') AND attempts>=5 AND (lease_until IS NULL OR lease_until<clock_timestamp());
 SELECT * INTO selected FROM auth_mail_outbox j WHERE ((j.status IN ('pending','failed') AND j.next_run_at<=clock_timestamp()) OR (j.status='running' AND j.lease_until<clock_timestamp())) AND j.attempts<5 ORDER BY j.next_run_at,j.id FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN;END IF;
 lease=gen_random_uuid();
 UPDATE auth_mail_outbox SET status='running',attempts=attempts+1,lease_id=lease,lease_until=clock_timestamp()+interval '60 seconds' WHERE id=selected.id;
 RETURN QUERY SELECT selected.id,selected.kind,u.email,selected.locale,selected.payload,selected.expires_at,lease FROM users u WHERE u.id=selected.user_id;
END $$;
REVOKE ALL ON FUNCTION claim_auth_mail() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_auth_mail() TO nuqta_worker;

CREATE FUNCTION notify_onboarding_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 d merchant_onboarding_drafts;
 owner_row users;
 shop text;
BEGIN
 SELECT * INTO d FROM merchant_onboarding_drafts WHERE id=NEW.draft_id;
 SELECT * INTO owner_row FROM users WHERE id=d.owner_id;
 shop := coalesce(d.details->>'name','');
 IF NEW.receipt_key IS NOT NULL AND NEW.receipt_key IS DISTINCT FROM OLD.receipt_key THEN
  INSERT INTO auth_mail_outbox(user_id,kind,credential_version,payload,locale,dedupe_key,expires_at)
  SELECT u.id,'onboarding_receipt_submitted',u.password_version,jsonb_build_object('shopName',shop),
         u.preferred_locale,'onboarding-receipt:'||NEW.receipt_key||':'||u.id,clock_timestamp()+interval '7 days'
  FROM users u WHERE u.global_role='platform_admin' AND u.status='active' AND u.email IS NOT NULL
  ON CONFLICT(dedupe_key) DO NOTHING;
 END IF;
 IF owner_row.id IS NOT NULL AND owner_row.email IS NOT NULL THEN
  IF NEW.confirmed_at IS NOT NULL AND OLD.confirmed_at IS NULL THEN
   INSERT INTO auth_mail_outbox(user_id,kind,credential_version,payload,locale,dedupe_key,expires_at)
   VALUES(owner_row.id,'onboarding_payment_confirmed',owner_row.password_version,
          jsonb_build_object('shopName',shop),owner_row.preferred_locale,
          'onboarding-confirmed:'||NEW.id,clock_timestamp()+interval '7 days')
   ON CONFLICT(dedupe_key) DO NOTHING;
  END IF;
  IF NEW.rejected_at IS NOT NULL AND OLD.rejected_at IS NULL THEN
   INSERT INTO auth_mail_outbox(user_id,kind,credential_version,payload,locale,dedupe_key,expires_at)
   VALUES(owner_row.id,'onboarding_payment_rejected',owner_row.password_version,
          jsonb_build_object('shopName',shop,'reason',coalesce(NEW.rejection_reason,''),
                             'suspended',d.merchant_id IS NOT NULL),
          owner_row.preferred_locale,'onboarding-rejected:'||NEW.id,clock_timestamp()+interval '7 days')
   ON CONFLICT(dedupe_key) DO NOTHING;
  END IF;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION notify_onboarding_order() FROM PUBLIC;
CREATE TRIGGER onboarding_order_mail AFTER UPDATE OF receipt_key,confirmed_at,rejected_at
 ON merchant_onboarding_orders FOR EACH ROW EXECUTE FUNCTION notify_onboarding_order();
