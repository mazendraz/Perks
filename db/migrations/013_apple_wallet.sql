-- Apple Wallet passes (L10). The pass carries no barcode and no customer name: it mirrors
-- stamps and the reward, and links back to the device-bound web card for stamping.
CREATE TABLE wallet_passes (
 serial uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 membership_id uuid NOT NULL UNIQUE REFERENCES memberships(id) ON DELETE CASCADE,
 merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
 auth_token_hash text NOT NULL CHECK(auth_token_hash ~ '^[0-9a-f]{64}$'),
 fingerprint text NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE wallet_registrations (
 device_library_id text NOT NULL CHECK(device_library_id ~ '^[A-Za-z0-9._-]{1,128}$'),
 serial uuid NOT NULL REFERENCES wallet_passes(serial) ON DELETE CASCADE,
 push_token text NOT NULL CHECK(push_token ~ '^[0-9A-Fa-f]{16,200}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(device_library_id,serial)
);
CREATE INDEX wallet_registrations_serial ON wallet_registrations(serial);
ALTER TABLE wallet_passes ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wallet_passes,wallet_registrations FROM PUBLIC;

-- Internal: the card as the pass shows it. Never granted; only the definers below call it.
CREATE FUNCTION wallet_card_json(member_arg uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('id',ms.id,'merchant_id',m.id,'merchant_name',m.name,'program_name',p.name,'threshold',v.threshold,
  'balance',a.balance,'cycle_number',a.cycle_number,
  'pending_rewards',(SELECT count(*)::int FROM reward_grants r WHERE r.membership_id=ms.id AND r.status='available' AND r.expires_at>now()),
  'display_balance',CASE WHEN EXISTS(SELECT 1 FROM reward_grants r WHERE r.membership_id=ms.id AND r.status='available' AND r.expires_at>now()) THEN v.threshold ELSE a.balance END,
  'primary_color',m.primary_color,'accent_color',m.accent_color,'surface_color',m.surface_color,'template',m.template,
  'stamp_shape',m.stamp_shape,'stamp_icon',m.stamp_icon,'stamp_style',m.stamp_style,
  'logo_asset_id',CASE WHEN m.status IN ('active','trial') THEN m.logo_asset_id END,
  'reward_title',v.reward_title,'reward_terms',v.reward_terms,
  'active',ms.status='active' AND u.status='active',
  'earning_active',p.status='active' AND m.status<>'suspended' AND (v.ends_at IS NULL OR v.ends_at>now()) AND merchant_earning_allowed(m.id))
 FROM memberships ms JOIN users u ON u.id=ms.user_id JOIN merchants m ON m.id=ms.merchant_id JOIN programs p ON p.id=ms.program_id
 JOIN program_versions v ON v.id=ms.program_version_id JOIN loyalty_accounts a ON a.membership_id=ms.id
 WHERE ms.id=member_arg
$$;
CREATE FUNCTION wallet_fingerprint(card jsonb) RETURNS text LANGUAGE sql IMMUTABLE SET search_path=public,pg_temp AS $$
 SELECT md5(coalesce(card,'null'::jsonb)::text)
$$;
REVOKE ALL ON FUNCTION wallet_card_json(uuid),wallet_fingerprint(jsonb) FROM PUBLIC;

-- Customer download: only the card's owner may issue its pass. The API derives the token from the
-- serial (HMAC), so re-downloading on another device keeps every installed copy valid.
CREATE FUNCTION wallet_issue_pass(member_arg uuid,serial_arg uuid,token_hash_arg text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result uuid; mid uuid;
BEGIN
 SELECT ms.merchant_id INTO mid FROM memberships ms JOIN users u ON u.id=ms.user_id
 WHERE ms.id=member_arg AND ms.user_id=app_user() AND ms.status='active' AND u.status='active';
 IF mid IS NULL THEN RETURN NULL; END IF;
 INSERT INTO wallet_passes(serial,membership_id,merchant_id,auth_token_hash,fingerprint)
 VALUES(serial_arg,member_arg,mid,token_hash_arg,wallet_fingerprint(wallet_card_json(member_arg)))
 ON CONFLICT(membership_id) DO NOTHING RETURNING serial INTO result;
 IF result IS NULL THEN SELECT serial INTO result FROM wallet_passes WHERE membership_id=member_arg; END IF;
 RETURN result;
END $$;

-- Apple web service: every call is fenced by the pass's own authentication token.
CREATE FUNCTION wallet_pass_card(serial_arg uuid,token_hash_arg text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT wallet_card_json(w.membership_id) || jsonb_build_object('changed_at',w.changed_at)
 FROM wallet_passes w WHERE w.serial=serial_arg AND w.auth_token_hash=token_hash_arg
$$;
CREATE FUNCTION wallet_register(device_arg text,push_arg text,serial_arg uuid,token_hash_arg text) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE existed boolean;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM wallet_passes WHERE serial=serial_arg AND auth_token_hash=token_hash_arg) THEN RETURN 'unauthorized'; END IF;
 -- Bounded per pass so a leaked pass cannot grow the table without limit.
 IF (SELECT count(*) FROM wallet_registrations WHERE serial=serial_arg AND device_library_id<>device_arg)>=10 THEN RETURN 'limited'; END IF;
 SELECT true INTO existed FROM wallet_registrations WHERE device_library_id=device_arg AND serial=serial_arg;
 INSERT INTO wallet_registrations(device_library_id,serial,push_token) VALUES(device_arg,serial_arg,push_arg)
 ON CONFLICT(device_library_id,serial) DO UPDATE SET push_token=excluded.push_token,updated_at=clock_timestamp();
 RETURN CASE WHEN existed THEN 'exists' ELSE 'created' END;
END $$;
CREATE FUNCTION wallet_unregister(device_arg text,serial_arg uuid,token_hash_arg text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM wallet_passes WHERE serial=serial_arg AND auth_token_hash=token_hash_arg) THEN RETURN false; END IF;
 DELETE FROM wallet_registrations WHERE device_library_id=device_arg AND serial=serial_arg;
 RETURN true;
END $$;
-- Update tags are microseconds since the epoch, compared as integers so no change is missed.
CREATE FUNCTION wallet_updated_serials(device_arg text,since_arg bigint) RETURNS TABLE(serial uuid,tag bigint) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT w.serial,t.tag FROM wallet_registrations r JOIN wallet_passes w ON w.serial=r.serial
 CROSS JOIN LATERAL (SELECT floor(extract(epoch FROM w.changed_at)*1000000)::bigint AS tag) t
 WHERE r.device_library_id=device_arg AND (since_arg IS NULL OR t.tag>since_arg)
$$;

-- Worker: find passes whose visible content changed, stamp them changed and return push tokens.
CREATE FUNCTION wallet_claim_changes() RETURNS TABLE(serial uuid,push_tokens text[],active boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 RETURN QUERY
 WITH candidates AS (
  SELECT w.serial,wallet_card_json(w.membership_id) AS card FROM wallet_passes w
  WHERE EXISTS(SELECT 1 FROM wallet_registrations r WHERE r.serial=w.serial)
  FOR UPDATE OF w SKIP LOCKED
 ), changed AS (
  UPDATE wallet_passes w SET fingerprint=wallet_fingerprint(c.card),changed_at=clock_timestamp()
  FROM candidates c WHERE w.serial=c.serial AND w.fingerprint<>wallet_fingerprint(c.card)
  RETURNING w.serial,coalesce((c.card->>'active')::boolean,false) AS active
 )
 SELECT p.serial,array_agg(DISTINCT r.push_token),p.active FROM changed p JOIN wallet_registrations r ON r.serial=p.serial GROUP BY p.serial,p.active;
END $$;
CREATE FUNCTION wallet_forget_push_token(push_arg text) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 DELETE FROM wallet_registrations WHERE push_token=push_arg
$$;
-- After a deleted card's final (voided) update is pushed, drop its device registrations.
CREATE FUNCTION wallet_release_inactive(serial_arg uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 DELETE FROM wallet_registrations r USING wallet_passes w WHERE r.serial=serial_arg AND w.serial=r.serial
 AND NOT coalesce((wallet_card_json(w.membership_id)->>'active')::boolean,false)
$$;
REVOKE ALL ON FUNCTION wallet_issue_pass(uuid,uuid,text),wallet_pass_card(uuid,text),wallet_register(text,text,uuid,text),
 wallet_unregister(text,uuid,text),wallet_updated_serials(text,bigint),wallet_claim_changes(),wallet_forget_push_token(text),
 wallet_release_inactive(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wallet_issue_pass(uuid,uuid,text),wallet_pass_card(uuid,text),wallet_register(text,text,uuid,text),
 wallet_unregister(text,uuid,text),wallet_updated_serials(text,bigint) TO nuqta_runtime;
GRANT EXECUTE ON FUNCTION wallet_claim_changes(),wallet_forget_push_token(text),wallet_release_inactive(uuid),wallet_pass_card(uuid,text) TO nuqta_worker;
