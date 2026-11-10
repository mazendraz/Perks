-- Google Wallet loyalty objects (L10). Like the Apple pass: no barcode, no customer name.
-- Google holds the object; we remember which cards were offered and what Google last received.
CREATE TABLE google_wallet_objects (
 object_key uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 membership_id uuid NOT NULL UNIQUE REFERENCES memberships(id) ON DELETE CASCADE,
 merchant_id uuid NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
 fingerprint text NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE google_wallet_objects ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON google_wallet_objects FROM PUBLIC;

CREATE FUNCTION google_wallet_issue(member_arg uuid,key_arg uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE mid uuid; result uuid; card jsonb;
BEGIN
 SELECT ms.merchant_id INTO mid FROM memberships ms JOIN users u ON u.id=ms.user_id
 WHERE ms.id=member_arg AND ms.user_id=app_user() AND ms.status='active' AND u.status='active';
 IF mid IS NULL THEN RETURN NULL; END IF;
 card:=wallet_card_json(member_arg);
 INSERT INTO google_wallet_objects(object_key,membership_id,merchant_id,fingerprint)
 VALUES(key_arg,member_arg,mid,wallet_fingerprint(card))
 ON CONFLICT(membership_id) DO NOTHING RETURNING object_key INTO result;
 IF result IS NULL THEN SELECT object_key INTO result FROM google_wallet_objects WHERE membership_id=member_arg; END IF;
 RETURN jsonb_build_object('object_key',result,'card',card);
END $$;
-- The stamp strip Google fetches by URL: only what the strip draws, addressed by a random key.
CREATE FUNCTION google_wallet_strip(key_arg uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('threshold',c->'threshold','display_balance',c->'display_balance','primary_color',c->'primary_color',
  'accent_color',c->'accent_color','stamp_shape',c->'stamp_shape','stamp_icon',c->'stamp_icon','stamp_style',c->'stamp_style')
 FROM google_wallet_objects g CROSS JOIN LATERAL wallet_card_json(g.membership_id) c WHERE g.object_key=key_arg
$$;
CREATE FUNCTION google_wallet_claim_changes() RETURNS TABLE(object_key uuid,card jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 RETURN QUERY
 WITH candidates AS (
  SELECT g.object_key,g.fingerprint AS old,wallet_card_json(g.membership_id) AS card FROM google_wallet_objects g
  FOR UPDATE OF g SKIP LOCKED
 ), changed AS (
  UPDATE google_wallet_objects g SET fingerprint=wallet_fingerprint(c.card),changed_at=clock_timestamp()
  FROM candidates c WHERE g.object_key=c.object_key AND c.old<>wallet_fingerprint(c.card)
  RETURNING g.object_key
 )
 SELECT c.object_key,c.card FROM candidates c JOIN changed USING(object_key);
END $$;
-- A failed delivery is retried on the next round.
CREATE FUNCTION google_wallet_retry(key_arg uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 UPDATE google_wallet_objects SET fingerprint='' WHERE object_key=key_arg
$$;
REVOKE ALL ON FUNCTION google_wallet_issue(uuid,uuid),google_wallet_strip(uuid),google_wallet_claim_changes(),google_wallet_retry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION google_wallet_issue(uuid,uuid),google_wallet_strip(uuid) TO nuqta_runtime;
GRANT EXECUTE ON FUNCTION google_wallet_claim_changes(),google_wallet_retry(uuid) TO nuqta_worker;
