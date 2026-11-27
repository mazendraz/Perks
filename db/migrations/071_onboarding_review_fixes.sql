-- Review fixes for self-service onboarding (067-070).

-- The key of an order's plan, whatever the plan: a new owner cannot read the plans table, and an
-- order quoted before 067 may be for a plan the self-service catalog no longer lists. Plan keys
-- are public names (starter, growth, …), so only the key is exposed.
CREATE FUNCTION onboarding_plan_key(plan_arg uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT key FROM plans WHERE id=plan_arg
$$;
REVOKE ALL ON FUNCTION onboarding_plan_key(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION onboarding_plan_key(uuid) TO nuqta_runtime;

-- Mail for the payment review:
--  * admins hear about a receipt once per order, not again on every re-upload;
--  * a confirmation tells an owner who has not published yet to publish (live=false), instead of
--    sending them to a dashboard they cannot open yet.
CREATE OR REPLACE FUNCTION notify_onboarding_order() RETURNS trigger
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
         u.preferred_locale,'onboarding-receipt:'||NEW.id||':'||u.id,clock_timestamp()+interval '7 days'
  FROM users u WHERE u.global_role='platform_admin' AND u.status='active' AND u.email IS NOT NULL
  ON CONFLICT(dedupe_key) DO NOTHING;
 END IF;
 IF owner_row.id IS NOT NULL AND owner_row.email IS NOT NULL THEN
  IF NEW.confirmed_at IS NOT NULL AND OLD.confirmed_at IS NULL THEN
   INSERT INTO auth_mail_outbox(user_id,kind,credential_version,payload,locale,dedupe_key,expires_at)
   VALUES(owner_row.id,'onboarding_payment_confirmed',owner_row.password_version,
          jsonb_build_object('shopName',shop,'live',d.merchant_id IS NOT NULL),owner_row.preferred_locale,
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
