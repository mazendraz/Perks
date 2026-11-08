CREATE TABLE tenant_customer_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),user_id uuid NOT NULL REFERENCES users(id),
 alias text NOT NULL CHECK(length(alias) BETWEEN 1 AND 60),contact_email text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(merchant_id,user_id),UNIQUE(merchant_id,id),UNIQUE(merchant_id,id,user_id)
);
CREATE TABLE memberships (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,profile_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES users(id),
 program_id uuid NOT NULL,program_version_id uuid NOT NULL,status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 source text NOT NULL DEFAULT 'link' CHECK(source IN ('qr','nfc','link')),origin_branch_id uuid,joined_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(merchant_id,profile_id,program_id),UNIQUE(merchant_id,id),UNIQUE(merchant_id,id,program_version_id),
 FOREIGN KEY(merchant_id,profile_id,user_id) REFERENCES tenant_customer_profiles(merchant_id,id,user_id),
 FOREIGN KEY(merchant_id,program_id,program_version_id) REFERENCES program_versions(merchant_id,program_id,id),
 FOREIGN KEY(merchant_id,origin_branch_id) REFERENCES branches(merchant_id,id)
);
CREATE INDEX membership_user_joined ON memberships(user_id,joined_at DESC);
CREATE TABLE loyalty_accounts (
 membership_id uuid PRIMARY KEY,merchant_id uuid NOT NULL,program_version_id uuid NOT NULL,balance integer NOT NULL DEFAULT 0 CHECK(balance>=0),
 revision integer NOT NULL DEFAULT 1,last_purchase_at timestamptz,
 FOREIGN KEY(merchant_id,membership_id,program_version_id) REFERENCES memberships(merchant_id,id,program_version_id)
);
CREATE TABLE terms_acceptances (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,membership_id uuid NOT NULL,user_id uuid NOT NULL REFERENCES users(id),
 program_version_id uuid NOT NULL,terms_text text NOT NULL,terms_hash text NOT NULL,accepted_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(membership_id,program_version_id),FOREIGN KEY(merchant_id,membership_id,program_version_id) REFERENCES memberships(merchant_id,id,program_version_id)
);
CREATE TRIGGER terms_immutable BEFORE UPDATE OR DELETE ON terms_acceptances FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE consent_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL REFERENCES merchants(id),user_id uuid NOT NULL REFERENCES users(id),
 channel text NOT NULL CHECK(channel IN ('email','sms','whatsapp','push')),purpose text NOT NULL DEFAULT 'marketing' CHECK(purpose='marketing'),
 granted boolean NOT NULL,text_version text NOT NULL DEFAULT '1',created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER consent_events_immutable BEFORE UPDATE OR DELETE ON consent_events FOR EACH ROW EXECUTE FUNCTION immutable_row();
CREATE TABLE consent_current (
 merchant_id uuid NOT NULL REFERENCES merchants(id),user_id uuid NOT NULL REFERENCES users(id),channel text NOT NULL,
 granted boolean NOT NULL DEFAULT false,revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(merchant_id,user_id,channel),CHECK(channel IN ('email','sms','whatsapp','push'))
);
CREATE TABLE presentation_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),merchant_id uuid NOT NULL,membership_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES users(id),
 purpose text NOT NULL CHECK(purpose IN ('customer_presentation','cashier_lookup')),token_hash text NOT NULL UNIQUE,
 session_id uuid NOT NULL REFERENCES sessions(id),branch_id uuid,expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(merchant_id,membership_id) REFERENCES memberships(merchant_id,id),FOREIGN KEY(merchant_id,branch_id) REFERENCES branches(merchant_id,id)
);
CREATE INDEX presentation_expiry ON presentation_tokens(expires_at);
CREATE FUNCTION customer_access(mid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM memberships WHERE merchant_id=mid AND user_id=app_user())
$$;
CREATE FUNCTION member_access(msid uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS(SELECT 1 FROM memberships m WHERE m.id=msid AND (m.user_id=app_user() OR tenant_access(m.merchant_id)))
$$;
CREATE FUNCTION enroll_customer(mid uuid,pid uuid,version_arg uuid,alias_arg text,source_arg text,branch_arg uuid,consents_arg jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE account users; merchant merchants; prog programs; ver program_versions; profile uuid; existing memberships; membership uuid; limits feature_entitlements; ch text; accept_text text;
BEGIN
 SELECT * INTO account FROM users WHERE id=app_user() AND status='active';IF NOT FOUND THEN RAISE EXCEPTION 'NQ:UNAUTHENTICATED';END IF;
 SELECT * INTO merchant FROM merchants WHERE id=mid FOR SHARE;IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF merchant.status='suspended' THEN RAISE EXCEPTION 'NQ:MERCHANT_PAUSED';END IF;
 SELECT * INTO prog FROM programs WHERE id=pid AND merchant_id=mid FOR SHARE;IF NOT FOUND OR prog.status<>'active' THEN RAISE EXCEPTION 'NQ:PROGRAM_INACTIVE';END IF;
 SELECT * INTO ver FROM program_versions WHERE id=prog.current_version_id;
 IF version_arg<>ver.id THEN RAISE EXCEPTION 'NQ:PROGRAM_VERSION_CHANGED';END IF;
 IF ver.starts_at>clock_timestamp() OR (ver.ends_at IS NOT NULL AND ver.ends_at<=clock_timestamp()) THEN RAISE EXCEPTION 'NQ:PROGRAM_INACTIVE';END IF;
 IF branch_arg IS NOT NULL AND NOT EXISTS(SELECT 1 FROM branches WHERE id=branch_arg AND merchant_id=mid AND status='active') THEN RAISE EXCEPTION 'NQ:BRANCH_UNAUTHORIZED';END IF;
 SELECT * INTO limits FROM feature_entitlements WHERE merchant_id=mid FOR UPDATE;IF NOT FOUND THEN RAISE EXCEPTION 'NQ:ENTITLEMENTS_NOT_CONFIGURED';END IF;
 SELECT * INTO existing FROM memberships WHERE merchant_id=mid AND program_id=pid AND user_id=account.id;
 IF FOUND THEN RETURN jsonb_build_object('membershipId',existing.id,'alreadyMember',true);END IF;
 SELECT id INTO profile FROM tenant_customer_profiles WHERE merchant_id=mid AND user_id=account.id;
 IF profile IS NULL THEN
  IF (SELECT count(*) FROM tenant_customer_profiles WHERE merchant_id=mid)>=limits.max_customers THEN RAISE EXCEPTION 'NQ:PLAN_LIMIT';END IF;
  INSERT INTO tenant_customer_profiles(merchant_id,user_id,alias,contact_email) VALUES(mid,account.id,alias_arg,account.email) RETURNING id INTO profile;
 END IF;
 INSERT INTO memberships(merchant_id,profile_id,user_id,program_id,program_version_id,source,origin_branch_id) VALUES(mid,profile,account.id,pid,ver.id,source_arg,branch_arg) RETURNING id INTO membership;
 INSERT INTO loyalty_accounts(membership_id,merchant_id,program_version_id) VALUES(membership,mid,ver.id);
 accept_text=merchant.terms||E'\n'||ver.reward_terms;
 INSERT INTO terms_acceptances(merchant_id,membership_id,user_id,program_version_id,terms_text,terms_hash) VALUES(mid,membership,account.id,ver.id,accept_text,encode(sha256(convert_to(accept_text,'UTF8')),'hex'));
 FOREACH ch IN ARRAY ARRAY['email','sms','whatsapp'] LOOP
  INSERT INTO consent_events(merchant_id,user_id,channel,granted) VALUES(mid,account.id,ch,coalesce((consents_arg->>ch)::boolean,false));
  INSERT INTO consent_current(merchant_id,user_id,channel,granted) VALUES(mid,account.id,ch,coalesce((consents_arg->>ch)::boolean,false)) ON CONFLICT DO NOTHING;
 END LOOP;
 INSERT INTO audit_events(actor_id,merchant_id,action,target_id,detail) VALUES(account.id,mid,'membership.enroll',membership,jsonb_build_object('programVersionId',ver.id,'source',source_arg));
 RETURN jsonb_build_object('membershipId',membership,'alreadyMember',false);
END $$;
CREATE FUNCTION my_cards() RETURNS SETOF jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',ms.id,'merchant_id',m.id,'merchant_slug',m.slug,'merchant_name',m.name,'alias',cp.alias,'program_id',p.id,'program_version_id',v.id,'program_version',v.version,'program_name',p.name,'threshold',v.threshold,'balance',a.balance,'revision',a.revision,'primary_color',m.primary_color,'accent_color',m.accent_color,'surface_color',m.surface_color,'template',m.template,'reward_title',v.reward_title,'reward_terms',v.reward_terms,'status',ms.status,'merchant_status',m.status,'earning_active',p.status='active' AND m.status<>'suspended' AND (v.ends_at IS NULL OR v.ends_at>now()),'joined_at',ms.joined_at)
 FROM memberships ms JOIN tenant_customer_profiles cp ON cp.id=ms.profile_id JOIN merchants m ON m.id=ms.merchant_id JOIN programs p ON p.id=ms.program_id JOIN program_versions v ON v.id=ms.program_version_id JOIN loyalty_accounts a ON a.membership_id=ms.id
 WHERE ms.user_id=app_user() ORDER BY ms.joined_at DESC
$$;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_access ON memberships USING(user_id=app_user() OR tenant_access(merchant_id));
ALTER TABLE tenant_customer_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profile_access ON tenant_customer_profiles USING(user_id=app_user() OR tenant_access(merchant_id)) WITH CHECK(user_id=app_user());
ALTER TABLE loyalty_accounts ENABLE ROW LEVEL SECURITY;
CREATE POLICY account_access ON loyalty_accounts USING(member_access(membership_id)) WITH CHECK(tenant_access(merchant_id));
ALTER TABLE terms_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY own_terms ON terms_acceptances USING(user_id=app_user() OR tenant_access(merchant_id));
ALTER TABLE presentation_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY token_access ON presentation_tokens USING(created_by=app_user() OR tenant_access(merchant_id)) WITH CHECK(created_by=app_user() AND member_access(membership_id));
ALTER TABLE consent_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_event_access ON consent_events USING(user_id=app_user() OR tenant_access(merchant_id)) WITH CHECK(user_id=app_user() AND customer_access(merchant_id));
ALTER TABLE consent_current ENABLE ROW LEVEL SECURITY;
CREATE POLICY consent_current_access ON consent_current USING(user_id=app_user() OR tenant_access(merchant_id)) WITH CHECK(user_id=app_user() AND customer_access(merchant_id));
ALTER POLICY audit_access ON audit_events USING(tenant_access(merchant_id) OR is_platform_admin() OR actor_id=app_user()) WITH CHECK(actor_id=app_user() AND (merchant_id IS NULL OR tenant_access(merchant_id) OR customer_access(merchant_id)));
ALTER POLICY scoped_rows ON program_versions USING(tenant_access(merchant_id) OR EXISTS(SELECT 1 FROM memberships m WHERE m.program_version_id=program_versions.id AND m.user_id=app_user())) WITH CHECK(tenant_access(merchant_id));
GRANT SELECT ON memberships,loyalty_accounts,terms_acceptances TO nuqta_runtime;
GRANT SELECT,UPDATE ON tenant_customer_profiles TO nuqta_runtime;
GRANT UPDATE ON loyalty_accounts TO nuqta_runtime;
GRANT SELECT,INSERT ON presentation_tokens,consent_events TO nuqta_runtime;
GRANT SELECT,INSERT,UPDATE ON consent_current TO nuqta_runtime;
GRANT EXECUTE ON FUNCTION customer_access(uuid),member_access(uuid),enroll_customer(uuid,uuid,uuid,text,text,uuid,jsonb),my_cards() TO nuqta_runtime;
