-- Security H1: staff-assisted card recovery no longer hands a bearer link to staff.
--
-- New flow ("pairing code"):
--  1. The customer opens /r/<merchantId> on their own phone. That device (its httpOnly
--     device cookie) starts a pairing and sees a short code. The code is shown only on
--     the customer's device; the database keeps a keyed hash of it.
--  2. Staff find the customer by full phone and enter the code. Owners/managers approve
--     directly; a cashier's claim waits for an owner/manager decision.
--  3. The customer's device consumes the approved pairing and gets a session.
--
-- Limits so a staff member cannot quietly take over a customer:
--  * A staff-paired device is scoped to the pairing merchant(s) only (trust_level
--    'staff_paired' + customer_device_merchants). The scope is enforced in the database
--    through customer_scope_ok(), applied per transaction by apply_customer_device_scope().
--  * Staff pairing never revokes the customer's existing devices or sessions.
--  * Every other active device of the customer gets a notice, and an unscoped device can
--    remove the new device from that notice.
--  * Every step is audited with the staff id; unusual per-staff counts are flagged to owners.
--  * Future server-sent OTP: add a pairing method 'otp' (customer_pairings.method) and a
--    function that sets trust_level='otp_verified' and clears the device's scope rows.
--    The scope machinery below then lifts automatically; nothing else changes.

-- Retire the old bearer links. Unused links stop working at deploy; history is kept.
UPDATE customer_recoveries SET expires_at=clock_timestamp() WHERE used_at IS NULL AND expires_at>clock_timestamp();
REVOKE EXECUTE ON FUNCTION create_customer_recovery(uuid,uuid,uuid,text) FROM nuqta_runtime;
REVOKE EXECUTE ON FUNCTION customer_recovery_preview(text),consume_customer_recovery(text,text,text,boolean) FROM nuqta_auth;

ALTER TABLE customer_devices ADD COLUMN trust_level text NOT NULL DEFAULT 'self_registered'
 CHECK(trust_level IN ('self_registered','staff_paired','otp_verified'));
GRANT SELECT(trust_level) ON customer_devices TO nuqta_runtime;

CREATE TABLE customer_pairings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 method text NOT NULL DEFAULT 'staff_code' CHECK(method IN ('staff_code')),
 device_hash text NOT NULL CHECK(device_hash ~ '^[a-f0-9]{64}$'),
 code_hash text NOT NULL CHECK(code_hash ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','awaiting_approval','approved','consumed','rejected','cancelled','expired')),
 customer_id uuid REFERENCES customer_identities(customer_id),
 profile_id uuid,branch_id uuid,
 requested_by uuid REFERENCES users(id),requested_role text CHECK(requested_role IN ('owner','manager','cashier')),
 approved_by uuid REFERENCES users(id),decided_by uuid REFERENCES users(id),
 device_id uuid REFERENCES customer_devices(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes',
 claimed_at timestamptz,decided_at timestamptz,consumed_at timestamptz,
 FOREIGN KEY(merchant_id,branch_id) REFERENCES branches(merchant_id,id),
 FOREIGN KEY(merchant_id,profile_id) REFERENCES tenant_customer_profiles(merchant_id,id),
 CHECK((status='waiting')=(customer_id IS NULL) OR status IN ('cancelled','expired')),
 CHECK(status<>'approved' OR approved_by IS NOT NULL)
);
CREATE UNIQUE INDEX customer_pairing_open_code ON customer_pairings(merchant_id,code_hash) WHERE status='waiting';
CREATE INDEX customer_pairing_device ON customer_pairings(device_hash,merchant_id,created_at);
CREATE INDEX customer_pairing_customer ON customer_pairings(customer_id,created_at);
CREATE INDEX customer_pairing_staff ON customer_pairings(merchant_id,requested_by,claimed_at);
CREATE INDEX customer_pairing_queue ON customer_pairings(merchant_id,created_at) WHERE status='awaiting_approval';

CREATE TABLE customer_device_merchants (
 device_id uuid NOT NULL REFERENCES customer_devices(id),
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 pairing_id uuid NOT NULL REFERENCES customer_pairings(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(device_id,merchant_id)
);

CREATE TABLE customer_device_notices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 customer_id uuid NOT NULL REFERENCES customer_identities(customer_id),
 device_id uuid NOT NULL REFERENCES customer_devices(id),
 kind text NOT NULL CHECK(kind IN ('device_paired')),
 merchant_id uuid NOT NULL REFERENCES merchants(id),
 paired_device_id uuid NOT NULL REFERENCES customer_devices(id),
 pairing_id uuid NOT NULL REFERENCES customer_pairings(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 dismissed_at timestamptz,
 UNIQUE(device_id,pairing_id)
);
CREATE INDEX customer_device_notice_open ON customer_device_notices(device_id) WHERE dismissed_at IS NULL;

ALTER TABLE customer_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_device_merchants ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_device_notices ENABLE ROW LEVEL SECURITY;
-- The auth role reads a pairing's customer only to take the customer lifecycle lock first.
CREATE POLICY customer_pairing_auth ON customer_pairings TO nuqta_auth USING(true);
GRANT SELECT(id,customer_id,device_hash) ON customer_pairings TO nuqta_auth;

-- Scope primitive. Empty/unset = not a device session (staff, workers, auth pool) = unrestricted.
CREATE FUNCTION customer_scope_ok(mid uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT CASE coalesce(current_setting('app.customer_scope',true),'')
  WHEN '' THEN true WHEN '*' THEN true
  ELSE mid IS NOT NULL AND mid::text=ANY(string_to_array(current_setting('app.customer_scope',true),',')) END
$$;
CREATE FUNCTION customer_scope_unrestricted() RETURNS boolean LANGUAGE sql STABLE AS $$
 SELECT coalesce(current_setting('app.customer_scope',true),'') IN ('','*')
$$;
-- Evaluated inside RLS policies, so every role that reads those tables must be able to call them.
REVOKE ALL ON FUNCTION customer_scope_ok(uuid),customer_scope_unrestricted() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION customer_scope_ok(uuid),customer_scope_unrestricted() TO nuqta_runtime,nuqta_auth,nuqta_worker;

-- Called for every device-session transaction, right after customer_session_current().
CREATE FUNCTION apply_customer_device_scope(session_arg uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d customer_devices;scope text;
BEGIN
 SELECT dv.* INTO d FROM sessions s JOIN customer_devices dv ON dv.id=s.customer_device_id AND dv.customer_id=s.user_id
  WHERE s.id=session_arg AND s.user_id=app_user() AND s.auth_method='device';
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:UNAUTHENTICATED';END IF;
 IF d.trust_level='staff_paired' THEN
  SELECT coalesce(string_agg(merchant_id::text,','),'none') INTO scope FROM customer_device_merchants WHERE device_id=d.id;
 ELSE scope:='*';
 END IF;
 PERFORM set_config('app.customer_scope',scope,true);
 RETURN scope;
END $$;
REVOKE ALL ON FUNCTION apply_customer_device_scope(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION apply_customer_device_scope(uuid) TO nuqta_runtime;

-- Row-level scope for customer-owned rows.
CREATE OR REPLACE FUNCTION customer_access(mid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT customer_scope_ok(mid) AND EXISTS(SELECT 1 FROM memberships WHERE merchant_id=mid AND user_id=app_user())
$$;
CREATE OR REPLACE FUNCTION member_access(msid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM memberships m WHERE m.id=msid AND ((m.user_id=app_user() AND customer_scope_ok(m.merchant_id)) OR tenant_access(m.merchant_id)))
$$;
ALTER POLICY membership_access ON memberships USING((user_id=app_user() AND customer_scope_ok(merchant_id)) OR tenant_access(merchant_id));
ALTER POLICY profile_access ON tenant_customer_profiles USING((user_id=app_user() AND customer_scope_ok(merchant_id)) OR tenant_access(merchant_id)) WITH CHECK(user_id=app_user() AND customer_scope_ok(merchant_id));
ALTER POLICY own_terms ON terms_acceptances USING((user_id=app_user() AND customer_scope_ok(merchant_id)) OR tenant_access(merchant_id));
ALTER POLICY token_access ON presentation_tokens USING((created_by=app_user() AND customer_scope_ok(merchant_id)) OR tenant_access(merchant_id)) WITH CHECK(created_by=app_user() AND member_access(membership_id));
ALTER POLICY consent_event_access ON consent_events USING((user_id=app_user() AND customer_scope_ok(merchant_id)) OR tenant_access(merchant_id)) WITH CHECK(user_id=app_user() AND customer_access(merchant_id));
ALTER POLICY consent_current_access ON consent_current USING((user_id=app_user() AND customer_scope_ok(merchant_id)) OR tenant_access(merchant_id)) WITH CHECK(user_id=app_user() AND customer_access(merchant_id));
ALTER POLICY challenge_access ON redemption_challenges USING((holder_user_id=app_user() AND customer_scope_ok(merchant_id)) OR tenant_access(merchant_id)) WITH CHECK((holder_user_id=app_user() AND customer_scope_ok(merchant_id)) OR tenant_access(merchant_id));
ALTER POLICY redemption_access ON reward_redemptions USING((holder_user_id=app_user() AND customer_scope_ok(merchant_id)) OR tenant_access(merchant_id));
ALTER POLICY request_access ON stamp_requests USING((user_id=app_user() AND customer_scope_ok(merchant_id)) OR branch_access(merchant_id,branch_id)) WITH CHECK((user_id=app_user() AND customer_scope_ok(merchant_id)) OR branch_access(merchant_id,branch_id));
ALTER POLICY collection_check_access ON stamp_collection_checks USING((user_id=app_user() AND customer_scope_ok(merchant_id)) OR branch_access(merchant_id,branch_id)) WITH CHECK(user_id=app_user() AND customer_scope_ok(merchant_id));
ALTER POLICY scoped_rows ON program_versions USING(tenant_access(merchant_id) OR EXISTS(SELECT 1 FROM memberships m WHERE m.program_version_id=program_versions.id AND m.user_id=app_user() AND customer_scope_ok(m.merchant_id))) WITH CHECK(tenant_access(merchant_id));

-- SECURITY DEFINER customer functions bypass RLS, so each ownership check gets the scope too.
-- Exact-text patching: the migration fails loudly if a function body is not what we expect.
CREATE FUNCTION pg_temp.patch_function(sig regprocedure,old_text text,new_text text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE def text;n integer;
BEGIN
 def:=pg_get_functiondef(sig);
 n:=(length(def)-length(replace(def,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'patch_function %: expected exactly one match, found %',sig,n;END IF;
 EXECUTE replace(def,old_text,new_text);
END $$;
SELECT pg_temp.patch_function('my_cards()',
 'WHERE ms.user_id=app_user() ORDER BY',
 'WHERE ms.user_id=app_user() AND customer_scope_ok(ms.merchant_id) ORDER BY');
SELECT pg_temp.patch_function('collect_stamp_automatically(uuid,uuid,uuid)',
 'WHERE id=member_arg AND user_id=app_user() AND status=''active'' FOR SHARE',
 'WHERE id=member_arg AND user_id=app_user() AND status=''active'' AND customer_scope_ok(merchant_id) FOR SHARE');
SELECT pg_temp.patch_function('collection_context(uuid,uuid)',
 'WHERE id=member_arg AND user_id=app_user() AND status=''active'';',
 'WHERE id=member_arg AND user_id=app_user() AND status=''active'' AND customer_scope_ok(merchant_id);');
SELECT pg_temp.patch_function('collection_eligibility(uuid,integer)',
 '(ms.user_id=app_user() OR tenant_access(ms.merchant_id))',
 '((ms.user_id=app_user() AND customer_scope_ok(ms.merchant_id)) OR tenant_access(ms.merchant_id))');
SELECT pg_temp.patch_function('customer_request_policy(uuid)',
 'ms.id=member_arg AND ms.user_id=app_user()',
 'ms.id=member_arg AND ms.user_id=app_user() AND customer_scope_ok(ms.merchant_id)');
SELECT pg_temp.patch_function('customer_stamp_artwork(uuid)',
 'm.id=member_arg AND m.user_id=app_user()',
 'm.id=member_arg AND m.user_id=app_user() AND customer_scope_ok(m.merchant_id)');
SELECT pg_temp.patch_function('wallet_issue_pass(uuid,uuid,text)',
 'ms.id=member_arg AND ms.user_id=app_user()',
 'ms.id=member_arg AND ms.user_id=app_user() AND customer_scope_ok(ms.merchant_id)');
SELECT pg_temp.patch_function('google_wallet_issue(uuid,uuid)',
 'ms.id=member_arg AND ms.user_id=app_user()',
 'ms.id=member_arg AND ms.user_id=app_user() AND customer_scope_ok(ms.merchant_id)');
SELECT pg_temp.patch_function('set_customer_contact_phone(uuid,text,boolean)',
 'WHERE merchant_id=mid AND user_id=app_user() FOR UPDATE',
 'WHERE merchant_id=mid AND user_id=app_user() AND customer_scope_ok(mid) FOR UPDATE');
SELECT pg_temp.patch_function('customer_contact_state(uuid,uuid)',
 ' IF NOT is_platform_admin() AND cp.user_id<>app_user()',
 ' IF cp.user_id=app_user() AND NOT customer_scope_ok(mid) THEN RAISE EXCEPTION ''NQ:NOT_FOUND'';END IF;
 IF NOT is_platform_admin() AND cp.user_id<>app_user()');
SELECT pg_temp.patch_function('enroll_customer(uuid,uuid,uuid,text,text,uuid,jsonb)',
 'IF merchant.status=''suspended'' THEN RAISE EXCEPTION ''NQ:MERCHANT_PAUSED'';END IF;',
 'IF merchant.status=''suspended'' THEN RAISE EXCEPTION ''NQ:MERCHANT_PAUSED'';END IF;
 IF NOT customer_scope_ok(mid) THEN RAISE EXCEPTION ''NQ:DEVICE_SCOPE_RECOVERY_REQUIRED'';END IF;');
-- A staff-paired device can never delete the customer's whole identity (all shops).
SELECT pg_temp.patch_function('delete_customer_identity(uuid)',
 ' IF NOT customer_session_current(session_arg) THEN RAISE EXCEPTION ''NQ:UNAUTHENTICATED'';END IF;',
 ' IF NOT customer_session_current(session_arg) THEN RAISE EXCEPTION ''NQ:UNAUTHENTICATED'';END IF;
 IF NOT customer_scope_unrestricted() THEN RAISE EXCEPTION ''NQ:DEVICE_SCOPE_RECOVERY_REQUIRED'';END IF;');
-- Registration runs on the auth pool (no session scope), so check the bound device directly:
-- a staff-paired device cannot join another shop by typing the same phone number.
SELECT pg_temp.patch_function('register_customer_device(text,text,text,text,text,uuid,uuid,uuid,uuid,text,text,text,text,text,uuid)',
 'uid:=bound.customer_id;did:=bound.id;',
 'IF bound.trust_level=''staff_paired'' AND NOT EXISTS(SELECT 1 FROM customer_device_merchants WHERE device_id=bound.id AND merchant_id=mid) THEN RAISE EXCEPTION ''NQ:DEVICE_SCOPE_RECOVERY_REQUIRED'';END IF;
  uid:=bound.customer_id;did:=bound.id;');

-- Privacy deletion (and restore re-anonymization) also closes any open pairing.
SELECT pg_temp.patch_function('anonymize_customer_record(uuid,timestamptz)',
 ' UPDATE customer_recoveries SET used_at=coalesce(used_at,clock_timestamp()),expires_at=least(expires_at,clock_timestamp()) WHERE customer_id=uid;',
 ' UPDATE customer_recoveries SET used_at=coalesce(used_at,clock_timestamp()),expires_at=least(expires_at,clock_timestamp()) WHERE customer_id=uid;
 UPDATE customer_pairings SET status=''cancelled'' WHERE customer_id=uid AND status IN (''awaiting_approval'',''approved'');
 DELETE FROM customer_device_merchants WHERE device_id IN(SELECT id FROM customer_devices WHERE customer_id=uid);');

-- 1. Customer device starts a pairing (auth pool; device cookie hash + CSRF checked by the API).
CREATE FUNCTION start_customer_pairing(mid uuid,device_arg text,code_arg text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE merchant merchants;open_row customer_pairings;new_row customer_pairings;
BEGIN
 SELECT * INTO merchant FROM merchants WHERE id=mid;
 IF NOT FOUND OR merchant.status NOT IN ('active','trial') THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-pairing-device:'||device_arg,0));
 UPDATE customer_pairings SET status='expired' WHERE status IN ('waiting','awaiting_approval','approved') AND expires_at<=clock_timestamp() AND (device_hash=device_arg OR merchant_id=mid);
 -- A claimed pairing resumes instead of starting over (the customer reopened the link).
 SELECT * INTO open_row FROM customer_pairings WHERE device_hash=device_arg AND merchant_id=mid AND status IN ('awaiting_approval','approved') ORDER BY created_at DESC LIMIT 1;
 IF FOUND THEN
  RETURN jsonb_build_object('id',open_row.id,'status',open_row.status,'expiresAt',open_row.expires_at,'merchantName',merchant.name);
 END IF;
 IF (SELECT count(*) FROM customer_pairings WHERE device_hash=device_arg AND created_at>clock_timestamp()-interval '1 hour')>=6 THEN
  RETURN jsonb_build_object('limited',true);
 END IF;
 UPDATE customer_pairings SET status='cancelled' WHERE device_hash=device_arg AND merchant_id=mid AND status='waiting';
 INSERT INTO customer_pairings(merchant_id,device_hash,code_hash) VALUES(mid,device_arg,code_arg) RETURNING * INTO new_row;
 RETURN jsonb_build_object('id',new_row.id,'status',new_row.status,'expiresAt',new_row.expires_at,'merchantName',merchant.name);
END $$;

CREATE FUNCTION customer_pairing_status(id_arg uuid,device_arg text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',p.id,'status',CASE WHEN p.status IN ('waiting','awaiting_approval','approved') AND p.expires_at<=clock_timestamp() THEN 'expired' ELSE p.status END,
  'expiresAt',p.expires_at,'merchantId',m.id,'merchantName',m.name)
 FROM customer_pairings p JOIN merchants m ON m.id=p.merchant_id WHERE p.id=id_arg AND p.device_hash=device_arg
$$;

CREATE FUNCTION customer_pairing_merchant(mid uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('merchantId',id,'merchantName',name) FROM merchants WHERE id=mid AND status IN ('active','trial')
$$;

-- 2. Staff enter the code shown on the customer's phone.
CREATE FUNCTION claim_customer_pairing(mid uuid,bid uuid,uid uuid,code_arg text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE role_arg text;phone text;target jsonb;p customer_pairings;day_start timestamptz;
BEGIN
 role_arg:=customer_recovery_role(mid,bid);
 IF role_arg='cashier' AND NOT (SELECT cashier_recovery_enabled FROM merchants WHERE id=mid) THEN RAISE EXCEPTION 'NQ:CASHIER_RECOVERY_DISABLED';END IF;
 IF (SELECT status FROM merchants WHERE id=mid) NOT IN ('active','trial') THEN RAISE EXCEPTION 'NQ:MERCHANT_PAUSED';END IF;
 SELECT phone_e164 INTO phone FROM customer_identities WHERE customer_id=uid;
 target:=lookup_customer_phone(mid,bid,phone);
 IF target IS NULL OR (target->>'customerId')::uuid IS DISTINCT FROM uid THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 SELECT * INTO p FROM customer_pairings WHERE merchant_id=mid AND code_hash=code_arg AND status='waiting' AND expires_at>clock_timestamp() FOR UPDATE;
 IF NOT FOUND THEN
  INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
   VALUES(app_user(),mid,'customer.pairing.code_rejected',uid,jsonb_build_object('branchId',bid,'staffId',app_user(),'role',role_arg));
  RETURN jsonb_build_object('invalid',true);
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('customer-recovery:'||uid::text,0));
 day_start:=date_trunc('day',clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
 IF (SELECT count(*) FROM customer_pairings WHERE customer_id=uid AND claimed_at>=day_start)>=10 THEN
  INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES(app_user(),mid,'customer.pairing.limit',uid,jsonb_build_object('branchId',bid,'staffId',app_user()));
  RETURN jsonb_build_object('limited',true);
 END IF;
 UPDATE customer_pairings SET customer_id=uid,profile_id=(target->>'profileId')::uuid,branch_id=bid,requested_by=app_user(),requested_role=role_arg,
  claimed_at=clock_timestamp(),expires_at=clock_timestamp()+interval '24 hours',
  status=CASE WHEN role_arg='cashier' THEN 'awaiting_approval' ELSE 'approved' END,
  approved_by=CASE WHEN role_arg='cashier' THEN NULL ELSE app_user() END,
  decided_by=CASE WHEN role_arg='cashier' THEN NULL ELSE app_user() END,
  decided_at=CASE WHEN role_arg='cashier' THEN NULL ELSE clock_timestamp() END
  WHERE id=p.id RETURNING * INTO p;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
  VALUES(app_user(),mid,CASE WHEN p.status='approved' THEN 'customer.pairing.approved' ELSE 'customer.pairing.requested' END,uid,
   jsonb_build_object('pairingId',p.id,'branchId',bid,'staffId',app_user(),'role',role_arg,'purpose','requested_by_customer'));
 RETURN jsonb_build_object('id',p.id,'status',p.status,'name',target->>'name');
END $$;

-- 3. Owner/manager queue + staff with unusual recovery counts (>=5 claims in 7 days).
CREATE FUNCTION customer_pairing_queue(mid uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.status='active' AND u.status='active' AND s.role IN ('owner','manager')) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 RETURN jsonb_build_object(
  'pending',coalesce((SELECT jsonb_agg(jsonb_build_object('id',p.id,'customerName',cp.alias,'phone',mask_customer_phone(ci.phone_e164),
    'branchName',b.name,'requestedBy',coalesce(st.name,ru.display_name),'requestedAt',p.claimed_at,'expiresAt',p.expires_at) ORDER BY p.claimed_at)
   FROM customer_pairings p JOIN tenant_customer_profiles cp ON cp.id=p.profile_id AND cp.merchant_id=p.merchant_id
   JOIN customer_identities ci ON ci.customer_id=p.customer_id JOIN branches b ON b.id=p.branch_id AND b.merchant_id=p.merchant_id
   JOIN users ru ON ru.id=p.requested_by LEFT JOIN staff_memberships st ON st.merchant_id=p.merchant_id AND st.user_id=p.requested_by
   WHERE p.merchant_id=mid AND p.status='awaiting_approval' AND p.expires_at>clock_timestamp()),'[]'::jsonb),
  'flaggedStaff',coalesce((SELECT jsonb_agg(jsonb_build_object('staffName',name,'count',n) ORDER BY n DESC) FROM (
    SELECT coalesce(st.name,u.display_name) AS name,count(*)::int AS n FROM customer_pairings p JOIN users u ON u.id=p.requested_by
    LEFT JOIN staff_memberships st ON st.merchant_id=p.merchant_id AND st.user_id=p.requested_by
    WHERE p.merchant_id=mid AND p.claimed_at>clock_timestamp()-interval '7 days' GROUP BY 1 HAVING count(*)>=5) f),'[]'::jsonb));
END $$;

CREATE FUNCTION decide_customer_pairing(mid uuid,id_arg uuid,approve boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE role_arg text;p customer_pairings;
BEGIN
 SELECT s.role INTO role_arg FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=mid AND s.user_id=app_user() AND s.status='active' AND u.status='active' AND s.role IN ('owner','manager');
 IF role_arg IS NULL THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 SELECT * INTO p FROM customer_pairings WHERE id=id_arg AND merchant_id=mid FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF p.status<>'awaiting_approval' OR p.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'NQ:PAIRING_NOT_PENDING';END IF;
 IF p.requested_by=app_user() THEN RAISE EXCEPTION 'NQ:PAIRING_SELF_APPROVAL';END IF;
 UPDATE customer_pairings SET status=CASE WHEN approve THEN 'approved' ELSE 'rejected' END,
  approved_by=CASE WHEN approve THEN app_user() END,decided_by=app_user(),decided_at=clock_timestamp() WHERE id=p.id RETURNING * INTO p;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
  VALUES(app_user(),mid,CASE WHEN approve THEN 'customer.pairing.approved' ELSE 'customer.pairing.rejected' END,p.customer_id,
   jsonb_build_object('pairingId',p.id,'branchId',p.branch_id,'staffId',p.requested_by,'approverId',app_user(),'approverRole',role_arg));
 RETURN jsonb_build_object('id',p.id,'status',p.status);
END $$;

-- 4. The customer's own device consumes the approved pairing. Never revokes anything.
CREATE FUNCTION consume_customer_pairing(id_arg uuid,device_arg text,agent_arg text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE p customer_pairings;d customer_devices;added boolean:=false;membership uuid;
BEGIN
 SELECT * INTO p FROM customer_pairings WHERE id=id_arg AND device_hash=device_arg FOR UPDATE;
 IF NOT FOUND OR p.status<>'approved' OR p.expires_at<=clock_timestamp() THEN RETURN NULL;END IF;
 IF (SELECT status FROM merchants WHERE id=p.merchant_id) NOT IN ('active','trial') THEN RETURN NULL;END IF;
 IF NOT EXISTS(SELECT 1 FROM users WHERE id=p.customer_id AND status='active' AND global_role='customer') THEN RETURN NULL;END IF;
 -- The staff who requested/approved must still be active at this merchant.
 IF NOT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=p.merchant_id AND s.user_id=p.requested_by AND s.status='active' AND u.status='active')
  OR NOT EXISTS(SELECT 1 FROM staff_memberships s JOIN users u ON u.id=s.user_id WHERE s.merchant_id=p.merchant_id AND s.user_id=p.approved_by AND s.status='active' AND u.status='active' AND s.role IN ('owner','manager'))
  OR (p.requested_role='cashier' AND NOT (SELECT cashier_recovery_enabled FROM merchants WHERE id=p.merchant_id)) THEN RETURN NULL;END IF;
 SELECT * INTO d FROM customer_devices WHERE token_hash=device_arg FOR UPDATE;
 IF FOUND AND d.customer_id<>p.customer_id THEN RETURN jsonb_build_object('deviceConflict',true);END IF;
 IF NOT FOUND THEN
  INSERT INTO customer_devices(customer_id,token_hash,user_agent_family,trust_level) VALUES(p.customer_id,device_arg,agent_arg,'staff_paired') RETURNING * INTO d;
  added:=true;
 ELSIF d.revoked_at IS NOT NULL OR d.expires_at<=clock_timestamp() THEN
  -- A revived device restarts with only this merchant's scope.
  DELETE FROM customer_device_merchants WHERE device_id=d.id;
  UPDATE customer_devices SET revoked_at=NULL,trust_level='staff_paired',last_seen_at=clock_timestamp(),expires_at=clock_timestamp()+interval '365 days',user_agent_family=agent_arg WHERE id=d.id RETURNING * INTO d;
  added:=true;
 END IF;
 IF d.trust_level='staff_paired' THEN
  INSERT INTO customer_device_merchants(device_id,merchant_id,pairing_id) VALUES(d.id,p.merchant_id,p.id) ON CONFLICT DO NOTHING;
  added:=added OR FOUND;
 END IF;
 IF added THEN
  INSERT INTO customer_device_notices(customer_id,device_id,kind,merchant_id,paired_device_id,pairing_id)
   SELECT p.customer_id,o.id,'device_paired',p.merchant_id,d.id,p.id FROM customer_devices o
   WHERE o.customer_id=p.customer_id AND o.id<>d.id AND o.revoked_at IS NULL AND o.expires_at>clock_timestamp();
 END IF;
 UPDATE customer_pairings SET status='consumed',consumed_at=clock_timestamp(),device_id=d.id WHERE id=p.id;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
  VALUES(p.customer_id,p.merchant_id,'customer.pairing.consumed',p.customer_id,
   jsonb_build_object('pairingId',p.id,'deviceId',d.id,'staffId',p.requested_by,'approverId',p.approved_by,'trustLevel',d.trust_level,'revokedOldDevices',false));
 SELECT id INTO membership FROM memberships WHERE user_id=p.customer_id AND merchant_id=p.merchant_id AND status='active' ORDER BY joined_at DESC LIMIT 1;
 RETURN jsonb_build_object('membershipId',membership);
END $$;

-- 5. Notices on the customer's other devices.
CREATE FUNCTION my_device_notices(session_arg uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'kind',n.kind,'merchantName',m.name,'createdAt',n.created_at,
   'deviceFamily',pd.user_agent_family,'deviceActive',pd.revoked_at IS NULL,
   'canRemove',me.trust_level<>'staff_paired' AND pd.revoked_at IS NULL) ORDER BY n.created_at DESC),'[]'::jsonb)
 FROM sessions s JOIN customer_devices me ON me.id=s.customer_device_id AND me.customer_id=s.user_id
 JOIN customer_device_notices n ON n.device_id=me.id AND n.dismissed_at IS NULL
 JOIN merchants m ON m.id=n.merchant_id JOIN customer_devices pd ON pd.id=n.paired_device_id
 WHERE s.id=session_arg AND s.user_id=app_user() AND s.auth_method='device'
$$;

CREATE FUNCTION resolve_device_notice(session_arg uuid,id_arg uuid,remove_device boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE me customer_devices;n customer_device_notices;
BEGIN
 SELECT d.* INTO me FROM sessions s JOIN customer_devices d ON d.id=s.customer_device_id AND d.customer_id=s.user_id
  WHERE s.id=session_arg AND s.user_id=app_user() AND s.auth_method='device';
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:UNAUTHENTICATED';END IF;
 SELECT * INTO n FROM customer_device_notices WHERE id=id_arg AND device_id=me.id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF remove_device THEN
  -- Only a device the customer set up themselves can remove a staff-paired one.
  IF me.trust_level='staff_paired' THEN RAISE EXCEPTION 'NQ:DEVICE_SCOPE_RECOVERY_REQUIRED';END IF;
  UPDATE customer_devices SET revoked_at=clock_timestamp() WHERE id=n.paired_device_id AND customer_id=me.customer_id AND revoked_at IS NULL;
  UPDATE sessions SET revoked_at=clock_timestamp() WHERE customer_device_id=n.paired_device_id AND user_id=me.customer_id AND revoked_at IS NULL;
  INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail)
   VALUES(me.customer_id,n.merchant_id,'customer.pairing.device_removed',me.customer_id,jsonb_build_object('pairingId',n.pairing_id,'deviceId',n.paired_device_id));
 END IF;
 UPDATE customer_device_notices SET dismissed_at=clock_timestamp() WHERE id=n.id;
 RETURN jsonb_build_object('id',n.id,'removed',remove_device);
END $$;

REVOKE ALL ON FUNCTION start_customer_pairing(uuid,text,text),customer_pairing_status(uuid,text),customer_pairing_merchant(uuid),
 claim_customer_pairing(uuid,uuid,uuid,text),customer_pairing_queue(uuid),decide_customer_pairing(uuid,uuid,boolean),
 consume_customer_pairing(uuid,text,text),my_device_notices(uuid),resolve_device_notice(uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_customer_pairing(uuid,text,text),customer_pairing_status(uuid,text),customer_pairing_merchant(uuid),
 consume_customer_pairing(uuid,text,text) TO nuqta_auth;
GRANT EXECUTE ON FUNCTION claim_customer_pairing(uuid,uuid,uuid,text),customer_pairing_queue(uuid),decide_customer_pairing(uuid,uuid,boolean),
 my_device_notices(uuid),resolve_device_notice(uuid,uuid,boolean) TO nuqta_runtime;
