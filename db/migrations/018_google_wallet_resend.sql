-- Google cards are now replaced whole (PUT) and carry the new card face, logo and title.
-- Every saved card is sent once more, so the QR code and the old layout disappear from
-- cards customers saved before.
UPDATE google_wallet_objects SET fingerprint='';

-- An Apple reminder changes wallet_card_json (reminder_templates) but nothing on the Google
-- card, so it is left out of the Google fingerprint: a reminder no longer triggers a resend.
CREATE OR REPLACE FUNCTION google_wallet_claim_changes() RETURNS TABLE(object_key uuid,card jsonb) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 RETURN QUERY
 WITH candidates AS (
  SELECT g.object_key,g.fingerprint AS old,wallet_card_json(g.membership_id)-'reminder_templates' AS card FROM google_wallet_objects g
  FOR UPDATE OF g SKIP LOCKED
 ), changed AS (
  UPDATE google_wallet_objects g SET fingerprint=wallet_fingerprint(c.card),changed_at=clock_timestamp()
  FROM candidates c WHERE g.object_key=c.object_key AND c.old<>wallet_fingerprint(c.card)
  RETURNING g.object_key
 )
 SELECT c.object_key,c.card FROM candidates c JOIN changed USING(object_key);
END $$;

-- Same fingerprint at issue time, so saving a card does not cause an immediate resend.
CREATE OR REPLACE FUNCTION google_wallet_issue(member_arg uuid,key_arg uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE mid uuid; result uuid; card jsonb;
BEGIN
 SELECT ms.merchant_id INTO mid FROM memberships ms JOIN users u ON u.id=ms.user_id
 WHERE ms.id=member_arg AND ms.user_id=app_user() AND ms.status='active' AND u.status='active';
 IF mid IS NULL THEN RETURN NULL; END IF;
 card:=wallet_card_json(member_arg);
 INSERT INTO google_wallet_objects(object_key,membership_id,merchant_id,fingerprint)
 VALUES(key_arg,member_arg,mid,wallet_fingerprint(card-'reminder_templates'))
 ON CONFLICT(membership_id) DO NOTHING RETURNING object_key INTO result;
 IF result IS NULL THEN SELECT object_key INTO result FROM google_wallet_objects WHERE membership_id=member_arg; END IF;
 RETURN jsonb_build_object('object_key',result,'card',card);
END $$;
