-- 1) Email ownership for new shop owners: a six-digit code instead of a link.
-- 2) Instant activation, reviewed afterwards: a shop goes live (and its subscription period starts)
--    as soon as its owner submits the InstaPay transfer; a platform admin then verifies or rejects
--    it. Rejection pauses the shop (data kept) until a corrected transfer is verified.
-- 3) The same rules for self-service renewals, plus reuse checks and audit entries.
-- Existing accounts keep signing in: every account that already has a password counts as verified.

-- ------------------------------------------------------------------ email verification
ALTER TABLE users ADD COLUMN email_verified_at timestamptz;
UPDATE users SET email_verified_at=created_at WHERE email IS NOT NULL AND password_hash IS NOT NULL;
GRANT SELECT (email_verified_at), UPDATE (email_verified_at) ON users TO nuqta_auth;

-- Only a keyed hash of each code is stored (bound to its row id). The latest code of a user is the
-- only one that counts, it lasts 10 minutes, works once and allows five wrong tries.
CREATE TABLE email_verification_codes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES users(id),
 code_hash text NOT NULL,
 expires_at timestamptz NOT NULL,
 attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
 used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX email_verification_codes_latest ON email_verification_codes(user_id, created_at DESC);
REVOKE ALL ON email_verification_codes FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE (attempts, used_at) ON email_verification_codes TO nuqta_auth;
ALTER TABLE email_verification_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY email_verification_codes_auth ON email_verification_codes
 USING (current_user='nuqta_auth') WITH CHECK (current_user='nuqta_auth');

ALTER TABLE auth_mail_outbox ADD COLUMN verification_code_id uuid REFERENCES email_verification_codes(id);
ALTER TABLE auth_mail_outbox DROP CONSTRAINT auth_mail_outbox_kind_check;
ALTER TABLE auth_mail_outbox ADD CONSTRAINT auth_mail_outbox_kind_check CHECK (kind IN (
 'password_reset','password_changed','merchant_welcome','email_verification',
 'onboarding_payment_confirmed','onboarding_payment_rejected','onboarding_receipt_submitted'));

-- Same as 069, plus: a code email goes stale once its code is used, expired, or replaced by a newer
-- one. A welcome email now only carries a password link when it was queued before this migration.
CREATE OR REPLACE FUNCTION claim_auth_mail() RETURNS TABLE(mail_id uuid,kind text,email text,locale text,payload jsonb,expires_at timestamptz,lease_id uuid) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE selected auth_mail_outbox;lease uuid;
BEGIN
 UPDATE auth_mail_outbox j SET status='blocked',last_error='AUTH_MAIL_STALE',lease_until=NULL WHERE j.status IN ('pending','failed') AND (
  j.expires_at<=clock_timestamp() OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=j.user_id AND u.status='active') OR
  ((j.kind='password_reset' OR (j.kind='merchant_welcome' AND j.reset_token_id IS NOT NULL)) AND NOT EXISTS(SELECT 1 FROM password_reset_tokens t JOIN users u ON u.id=t.user_id WHERE t.id=j.reset_token_id AND t.user_id=j.user_id AND t.used_at IS NULL AND t.expires_at>clock_timestamp() AND t.credential_version=u.password_version)) OR
  (j.kind='email_verification' AND NOT EXISTS(SELECT 1 FROM email_verification_codes v WHERE v.id=j.verification_code_id AND v.user_id=j.user_id AND v.used_at IS NULL AND v.expires_at>clock_timestamp() AND v.attempts<5
     AND NOT EXISTS(SELECT 1 FROM email_verification_codes n WHERE n.user_id=v.user_id AND n.created_at>v.created_at)))
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

-- ------------------------------------------------------------------ payment status and renewals
ALTER TABLE merchant_onboarding_orders
 ADD COLUMN purpose text NOT NULL DEFAULT 'activation' CHECK (purpose IN ('activation','renewal')),
 ADD COLUMN receipt_sha256 text,
 -- The subscription period this transfer pays for, fixed when the shop was activated or renewed.
 ADD COLUMN period_start timestamptz,
 ADD COLUMN period_end timestamptz;
GRANT UPDATE (receipt_sha256) ON merchant_onboarding_orders TO nuqta_runtime;
-- A shop now has one verified activation plus one verified order per renewal (corrections replace
-- a rejected order), so "one confirmed order per draft" only holds for the first activation.
DROP INDEX merchant_onboarding_one_confirmed_order;
CREATE UNIQUE INDEX merchant_onboarding_one_confirmed_activation
 ON merchant_onboarding_orders (draft_id)
 WHERE confirmed_reference IS NOT NULL AND purpose='activation' AND corrects_order_id IS NULL;

CREATE FUNCTION onboarding_payment_status(o merchant_onboarding_orders) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT CASE WHEN o.confirmed_at IS NOT NULL THEN 'verified'
  WHEN o.rejected_at IS NOT NULL THEN 'rejected'
  WHEN o.receipt_key IS NOT NULL THEN 'pending_review'
  ELSE 'awaiting_transfer' END
$$;
GRANT EXECUTE ON FUNCTION onboarding_payment_status(merchant_onboarding_orders) TO nuqta_runtime;

CREATE FUNCTION normalize_transfer_reference(value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT nullif(lower(regexp_replace(coalesce(value,''),'[[:space:]#_-]','','g')),'')
$$;

-- An owner whose transfer was rejected and never put right again is not trusted with instant
-- activation: a new shop or renewal from them waits for an admin to verify the transfer first.
CREATE FUNCTION onboarding_owner_needs_review(owner_arg uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (
  SELECT 1 FROM merchant_onboarding_orders r JOIN merchant_onboarding_drafts d ON d.id=r.draft_id
  WHERE d.owner_id=owner_arg AND r.rejected_at IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM merchant_onboarding_orders c
      WHERE c.draft_id=r.draft_id AND c.confirmed_at IS NOT NULL AND c.created_at>r.created_at))
$$;
REVOKE ALL ON FUNCTION onboarding_owner_needs_review(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION onboarding_owner_needs_review(uuid) TO nuqta_runtime;

-- One transfer pays for one period of one shop: neither its reference nor its receipt image may
-- come back on another order (rejected ones included: a rejected reference stays burnt).
CREATE FUNCTION check_onboarding_transfer_reuse() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ref text := normalize_transfer_reference(NEW.submitted_reference);
BEGIN
 IF NEW.receipt_key IS NULL OR NEW.receipt_key IS NOT DISTINCT FROM OLD.receipt_key THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtext('onboarding-transfer:'||coalesce(ref,'')));
 IF NEW.receipt_sha256 IS NOT NULL THEN
  PERFORM pg_advisory_xact_lock(hashtext('onboarding-receipt:'||NEW.receipt_sha256));
 END IF;
 IF EXISTS (SELECT 1 FROM merchant_onboarding_orders o WHERE o.id<>NEW.id AND (
      normalize_transfer_reference(o.submitted_reference)=ref
      OR normalize_transfer_reference(o.confirmed_reference)=ref
      OR (NEW.receipt_sha256 IS NOT NULL AND o.receipt_sha256=NEW.receipt_sha256)))
   OR EXISTS (SELECT 1 FROM subscription_payments p WHERE p.method='instapay'
      AND normalize_transfer_reference(p.payment_reference)=ref
      AND NOT EXISTS (SELECT 1 FROM subscription_payment_voids v WHERE v.payment_id=p.id)) THEN
  RAISE EXCEPTION 'NQ:ONBOARDING_TRANSFER_REUSED';
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION check_onboarding_transfer_reuse() FROM PUBLIC;
CREATE TRIGGER a_onboarding_transfer_reuse BEFORE UPDATE OF receipt_key ON merchant_onboarding_orders
 FOR EACH ROW EXECUTE FUNCTION check_onboarding_transfer_reuse();

-- Every submission and review decision lands in the audit log.
CREATE FUNCTION audit_onboarding_order() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d merchant_onboarding_drafts;
BEGIN
 SELECT * INTO d FROM merchant_onboarding_drafts WHERE id=NEW.draft_id;
 IF NEW.receipt_key IS NOT NULL AND NEW.receipt_key IS DISTINCT FROM OLD.receipt_key THEN
  INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
  VALUES(d.owner_id,d.merchant_id,'merchant.onboarding.transfer_submitted',NEW.id,
   jsonb_build_object('purpose',NEW.purpose,'amountMinor',NEW.amount_minor,'currency',NEW.currency,
     'reference',NEW.submitted_reference,'correction',NEW.corrects_order_id IS NOT NULL));
 END IF;
 IF NEW.confirmed_at IS NOT NULL AND OLD.confirmed_at IS NULL THEN
  INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
  VALUES(NEW.confirmed_by,d.merchant_id,'merchant.onboarding.transfer_verified',NEW.id,
   jsonb_build_object('purpose',NEW.purpose,'amountMinor',NEW.amount_minor,'reference',NEW.confirmed_reference));
 END IF;
 IF NEW.rejected_at IS NOT NULL AND OLD.rejected_at IS NULL THEN
  INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
  VALUES(NEW.rejected_by,d.merchant_id,'merchant.onboarding.transfer_rejected',NEW.id,
   jsonb_build_object('purpose',NEW.purpose,'reason',NEW.rejection_reason,
     'suspended',d.merchant_id IS NOT NULL));
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION audit_onboarding_order() FROM PUBLIC;
CREATE TRIGGER onboarding_order_audit AFTER UPDATE OF receipt_key,confirmed_at,rejected_at
 ON merchant_onboarding_orders FOR EACH ROW EXECUTE FUNCTION audit_onboarding_order();

-- An owner may submit the receipt of a correction or a renewal on an already published shop.
DROP POLICY merchant_onboarding_order_submit ON merchant_onboarding_orders;
CREATE POLICY merchant_onboarding_order_submit ON merchant_onboarding_orders FOR UPDATE
 USING (confirmed_at IS NULL AND rejected_at IS NULL AND EXISTS (
   SELECT 1 FROM merchant_onboarding_drafts d
   WHERE d.id = draft_id AND d.owner_id = app_user()
     AND (d.merchant_id IS NULL OR corrects_order_id IS NOT NULL OR purpose='renewal')
 ))
 WITH CHECK (confirmed_at IS NULL AND rejected_at IS NULL AND EXISTS (
   SELECT 1 FROM merchant_onboarding_drafts d
   WHERE d.id = draft_id AND d.owner_id = app_user()
     AND (d.merchant_id IS NULL OR corrects_order_id IS NOT NULL OR purpose='renewal')
 ));

-- A renewal opens at most 7 days before the period ends, only for an active shop whose earlier
-- transfers were all verified, and only one at a time; so months cannot be stacked on unverified
-- receipts. Returns the open renewal order (existing or new).
CREATE FUNCTION start_subscription_renewal(merchant_arg uuid, recipient_arg text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d merchant_onboarding_drafts; s merchant_subscriptions; open_id uuid;
BEGIN
 SELECT * INTO d FROM merchant_onboarding_drafts
 WHERE merchant_id=merchant_arg AND owner_id=app_user() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 IF NOT EXISTS (SELECT 1 FROM merchants WHERE id=merchant_arg AND status='active') THEN
  RAISE EXCEPTION 'NQ:ONBOARDING_RENEWAL_BLOCKED';
 END IF;
 SELECT id INTO open_id FROM merchant_onboarding_orders
 WHERE draft_id=d.id AND purpose='renewal' AND receipt_key IS NULL AND rejected_at IS NULL
 ORDER BY created_at DESC LIMIT 1;
 IF open_id IS NOT NULL THEN RETURN open_id; END IF;
 IF EXISTS (SELECT 1 FROM merchant_onboarding_orders WHERE draft_id=d.id AND confirmed_at IS NULL
            AND (receipt_key IS NOT NULL OR rejected_at IS NOT NULL))
    OR onboarding_owner_needs_review(d.owner_id) THEN
  RAISE EXCEPTION 'NQ:ONBOARDING_RENEWAL_BLOCKED';
 END IF;
 SELECT * INTO s FROM merchant_subscriptions WHERE merchant_id=merchant_arg FOR UPDATE;
 IF NOT FOUND OR s.current_period_end IS NULL OR s.price_minor<=0 OR s.currency<>'EGP'
    OR s.billing_period<>'monthly' THEN
  RAISE EXCEPTION 'NQ:ONBOARDING_RENEWAL_BLOCKED';
 END IF;
 IF s.current_period_end>clock_timestamp()+interval '7 days' THEN
  RAISE EXCEPTION 'NQ:ONBOARDING_RENEWAL_TOO_EARLY';
 END IF;
 INSERT INTO merchant_onboarding_orders(draft_id,plan_id,amount_minor,currency,duration_days,recipient_account,purpose)
 VALUES(d.id,s.plan_id,s.price_minor,'EGP',30,recipient_arg,'renewal') RETURNING id INTO open_id;
 RETURN open_id;
END $$;
REVOKE ALL ON FUNCTION start_subscription_renewal(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_subscription_renewal(uuid,text) TO nuqta_runtime;

-- Submitting a renewal transfer extends the subscription at once; its review follows. The shop's
-- standing now depends on this order, so a rejection pauses the shop like a rejected activation.
CREATE FUNCTION activate_onboarding_renewal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d merchant_onboarding_drafts; s merchant_subscriptions; starts timestamptz; ends timestamptz;
BEGIN
 SELECT * INTO d FROM merchant_onboarding_drafts WHERE id=NEW.draft_id;
 IF d.merchant_id IS NULL THEN RETURN NULL; END IF;
 SELECT * INTO s FROM merchant_subscriptions WHERE merchant_id=d.merchant_id FOR UPDATE;
 starts:=greatest(coalesce(s.current_period_end,clock_timestamp()),clock_timestamp());
 ends:=starts+make_interval(days=>NEW.duration_days);
 UPDATE merchant_onboarding_orders SET period_start=starts,period_end=ends WHERE id=NEW.id;
 UPDATE merchant_subscriptions SET
   status=CASE WHEN status IN ('past_due','grace') THEN 'active' ELSE status END,
   past_due_since=CASE WHEN status IN ('past_due','grace') THEN NULL ELSE past_due_since END,
   current_period_start=CASE WHEN current_period_end IS NULL OR current_period_end<=clock_timestamp() THEN starts ELSE current_period_start END,
   current_period_end=ends,revision=revision+1,updated_at=clock_timestamp()
 WHERE merchant_id=d.merchant_id;
 UPDATE feature_entitlements SET expires_at=greatest(expires_at,ends),revision=revision+1
 WHERE merchant_id=d.merchant_id;
 INSERT INTO subscription_events(merchant_id,actor_id,event_type,before,after,reason)
 VALUES(d.merchant_id,d.owner_id,'subscription.renewal_submitted',
  jsonb_build_object('currentPeriodEnd',s.current_period_end),
  jsonb_build_object('currentPeriodEnd',ends,'orderId',NEW.id),'Self-service InstaPay renewal (pending review)');
 UPDATE merchant_onboarding_drafts SET published_order_id=NEW.id WHERE id=d.id;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION activate_onboarding_renewal() FROM PUBLIC;
CREATE TRIGGER onboarding_renewal_activation AFTER UPDATE OF receipt_key ON merchant_onboarding_orders
 FOR EACH ROW WHEN (NEW.purpose='renewal' AND OLD.receipt_key IS NULL AND NEW.receipt_key IS NOT NULL)
 EXECUTE FUNCTION activate_onboarding_renewal();

-- Verifying a transfer records the payment for the period that started at activation (or at the
-- renewal), so a review never moves the subscription dates. A verified correction of a rejected
-- transfer starts a fresh period at verification, as before.
CREATE OR REPLACE FUNCTION record_onboarding_payment(order_arg uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o merchant_onboarding_orders; d merchant_onboarding_drafts; operation_id uuid; starts timestamptz; ends timestamptz;
BEGIN
 SELECT * INTO o FROM merchant_onboarding_orders WHERE id=order_arg;
 IF o.confirmed_at IS NULL THEN RETURN; END IF;
 SELECT * INTO d FROM merchant_onboarding_drafts WHERE id=o.draft_id AND published_order_id=o.id;
 IF d.merchant_id IS NULL THEN RETURN; END IF;
 INSERT INTO operations(actor_id,merchant_id,scope,idempotency_key,request_hash,status,result,committed_at)
 VALUES(o.confirmed_by,d.merchant_id,'merchant.onboarding.payment',o.id::text,o.id::text,'committed',
  jsonb_build_object('orderId',o.id),clock_timestamp())
 ON CONFLICT(actor_id,scope,idempotency_key) DO NOTHING RETURNING id INTO operation_id;
 IF operation_id IS NULL THEN RETURN; END IF;
 IF o.period_start IS NOT NULL THEN
  starts:=o.period_start;
  ends:=coalesce(o.period_end,starts+make_interval(days=>o.duration_days));
 ELSE
  SELECT current_period_start INTO starts FROM merchant_subscriptions WHERE merchant_id=d.merchant_id;
  starts:=coalesce(starts,o.confirmed_at);
  IF o.corrects_order_id IS NOT NULL THEN starts:=o.confirmed_at; END IF;
  ends:=starts+make_interval(days=>o.duration_days);
 END IF;
 INSERT INTO subscription_payments(merchant_id,amount_minor,currency,method,period_start,period_end,
   starts_at,ends_at,payment_reference,reason,recorded_by,operation_id)
 VALUES(d.merchant_id,o.amount_minor,o.currency,'instapay',(starts AT TIME ZONE 'Africa/Cairo')::date,
  (ends AT TIME ZONE 'Africa/Cairo')::date,starts,ends,left(o.confirmed_reference,100),
  CASE o.purpose WHEN 'renewal' THEN 'Verified self-service InstaPay renewal' ELSE 'Confirmed self-service InstaPay payment' END,
  o.confirmed_by,operation_id);
 UPDATE feature_entitlements SET billing_required=true,expires_at=greatest(coalesce(expires_at,ends),ends),revision=revision+1
 WHERE merchant_id=d.merchant_id;
 UPDATE merchant_subscriptions SET
   current_period_start=CASE WHEN starts<=clock_timestamp() OR current_period_start IS NULL THEN starts ELSE current_period_start END,
   current_period_end=CASE WHEN o.corrects_order_id IS NOT NULL THEN ends ELSE greatest(coalesce(current_period_end,ends),ends) END,
   revision=revision+1,updated_at=clock_timestamp() WHERE merchant_id=d.merchant_id;
END $$;
REVOKE ALL ON FUNCTION record_onboarding_payment(uuid) FROM PUBLIC;

-- Same as 062 with two changes: the activated order records its subscription period, and an owner
-- with an unresolved rejected transfer can only publish once an admin verified the new one.
CREATE OR REPLACE FUNCTION publish_merchant_onboarding(draft_arg uuid, revision_arg integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE
 d merchant_onboarding_drafts;
 o merchant_onboarding_orders;
 owner_row users;
 settings jsonb;
 mid uuid;
 bid uuid;
 pid uuid;
 vid uuid;
 sid uuid;
 placement_id uuid;
 code text := replace(gen_random_uuid()::text, '-', '');
 slug text;
 plan_key text;
 starts timestamptz := clock_timestamp();
BEGIN
 SELECT * INTO d FROM merchant_onboarding_drafts WHERE id=draft_arg AND owner_id=app_user() FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 IF d.publication IS NOT NULL THEN RETURN d.publication; END IF;
 IF d.revision<>revision_arg THEN RAISE EXCEPTION 'NQ:REVISION_CONFLICT'; END IF;
 SELECT * INTO owner_row FROM users WHERE id=d.owner_id AND status='active' AND email IS NOT NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 SELECT * INTO o FROM merchant_onboarding_orders
 WHERE draft_id=d.id AND receipt_key IS NOT NULL AND rejected_at IS NULL
 ORDER BY confirmed_at DESC NULLS LAST, created_at DESC, id DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:ONBOARDING_RECEIPT_REQUIRED'; END IF;
 IF o.confirmed_at IS NULL AND onboarding_owner_needs_review(d.owner_id) THEN
  RAISE EXCEPTION 'NQ:ONBOARDING_REVIEW_REQUIRED';
 END IF;
 SELECT key INTO plan_key FROM plans WHERE id=o.plan_id AND is_active AND is_public;
 IF plan_key IS NULL OR plan_key NOT IN ('starter','growth','pro') THEN
  RAISE EXCEPTION 'NQ:PLAN_LIMIT';
 END IF;
 settings:=d.details->'setup';
 IF coalesce(length(trim(d.details->>'name')),0)<2 OR settings IS NULL THEN
  RAISE EXCEPTION 'NQ:VALIDATION_FAILED';
 END IF;

 mid:=gen_random_uuid();
 slug:='shop-' || replace(mid::text,'-','');
 INSERT INTO merchants(id,slug,name,contact_email,primary_color,accent_color,surface_color)
 VALUES(mid,slug,d.details->>'name',owner_row.email,settings->>'cardColor','#ddd3a7','#f5f1e7');
 INSERT INTO feature_entitlements(merchant_id,plan,max_branches,max_staff,max_programs,max_customers,billing_required)
 VALUES(mid,plan_key,1,3,1,500,false);
 UPDATE entitlement_overrides SET revoked_at=clock_timestamp(),revoked_by=d.owner_id
 WHERE merchant_id=mid AND revoked_at IS NULL;
 UPDATE merchant_subscriptions
 SET plan_id=o.plan_id,status='active',price_minor=o.amount_minor,
     current_period_start=starts,current_period_end=starts+make_interval(days=>o.duration_days)
 WHERE merchant_id=mid;
 UPDATE merchant_onboarding_orders SET period_start=starts,period_end=starts+make_interval(days=>o.duration_days)
 WHERE id=o.id;
 INSERT INTO branches(merchant_id,name,address) VALUES(mid,settings->>'branchName',settings->>'branchAddress')
 RETURNING id INTO bid;
 INSERT INTO staff_memberships(merchant_id,user_id,email,name,role)
 VALUES(mid,d.owner_id,owner_row.email,owner_row.display_name,'owner') RETURNING id INTO sid;
 INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES(mid,sid,bid);
 INSERT INTO programs(merchant_id,name) VALUES(mid,d.details->>'name') RETURNING id INTO pid;
 INSERT INTO program_versions(merchant_id,program_id,version,threshold,max_per_tx,reward_title,reward_terms,validity_days)
 VALUES(mid,pid,1,(settings->>'threshold')::integer,1,settings->>'rewardTitle',settings->>'rewardTitle',30)
 RETURNING id INTO vid;
 INSERT INTO program_branches(merchant_id,program_version_id,branch_id) VALUES(mid,vid,bid);
 UPDATE programs SET current_version_id=vid WHERE id=pid;
 INSERT INTO placements(merchant_id,branch_id,label,kind,public_code,created_by)
 VALUES(mid,bid,settings->>'branchName','stand',code,d.owner_id) RETURNING id INTO placement_id;
 INSERT INTO placement_events(merchant_id,placement_id,actor_id,action,reason)
 VALUES(mid,placement_id,d.owner_id,'requested','QR generated by self-service onboarding');
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
 VALUES(d.owner_id,mid,'merchant.onboarding.published',mid,
  jsonb_build_object('orderId',o.id,'paymentStatus',onboarding_payment_status(o)));
 UPDATE merchant_onboarding_drafts SET merchant_id=mid,published_order_id=o.id,
  publication=jsonb_build_object('merchantId',mid,'placementId',placement_id,'code',code)
 WHERE id=d.id RETURNING publication INTO d.publication;
 RETURN d.publication;
END $$;
REVOKE ALL ON FUNCTION publish_merchant_onboarding(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publish_merchant_onboarding(uuid,integer) TO nuqta_runtime;

-- Same as 071, with the renewal flag in the owner's emails.
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
  SELECT u.id,'onboarding_receipt_submitted',u.password_version,
         jsonb_build_object('shopName',shop,'renewal',NEW.purpose='renewal'),
         u.preferred_locale,'onboarding-receipt:'||NEW.id||':'||u.id,clock_timestamp()+interval '7 days'
  FROM users u WHERE u.global_role='platform_admin' AND u.status='active' AND u.email IS NOT NULL
  ON CONFLICT(dedupe_key) DO NOTHING;
 END IF;
 IF owner_row.id IS NOT NULL AND owner_row.email IS NOT NULL THEN
  IF NEW.confirmed_at IS NOT NULL AND OLD.confirmed_at IS NULL THEN
   INSERT INTO auth_mail_outbox(user_id,kind,credential_version,payload,locale,dedupe_key,expires_at)
   VALUES(owner_row.id,'onboarding_payment_confirmed',owner_row.password_version,
          jsonb_build_object('shopName',shop,'live',d.merchant_id IS NOT NULL,'renewal',NEW.purpose='renewal'),
          owner_row.preferred_locale,'onboarding-confirmed:'||NEW.id,clock_timestamp()+interval '7 days')
   ON CONFLICT(dedupe_key) DO NOTHING;
  END IF;
  IF NEW.rejected_at IS NOT NULL AND OLD.rejected_at IS NULL THEN
   INSERT INTO auth_mail_outbox(user_id,kind,credential_version,payload,locale,dedupe_key,expires_at)
   VALUES(owner_row.id,'onboarding_payment_rejected',owner_row.password_version,
          jsonb_build_object('shopName',shop,'reason',coalesce(NEW.rejection_reason,''),
                             'suspended',d.merchant_id IS NOT NULL,'renewal',NEW.purpose='renewal'),
          owner_row.preferred_locale,'onboarding-rejected:'||NEW.id,clock_timestamp()+interval '7 days')
   ON CONFLICT(dedupe_key) DO NOTHING;
  END IF;
 END IF;
 RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION notify_onboarding_order() FROM PUBLIC;
