-- Apple Wallet: a pass update that APNs did not take (network error, 429, 5xx, 403) is pushed again
-- with backoff, instead of being lost until the card next changes.
ALTER TABLE wallet_passes
 ADD COLUMN push_attempts integer NOT NULL DEFAULT 0 CHECK(push_attempts>=0),
 ADD COLUMN push_retry_at timestamptz;

-- Same as 013, but a pass waiting for its retry time is left alone until then.
CREATE OR REPLACE FUNCTION wallet_claim_changes() RETURNS TABLE(serial uuid,push_tokens text[],active boolean) LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 RETURN QUERY
 WITH candidates AS (
  SELECT w.serial,wallet_card_json(w.membership_id) AS card FROM wallet_passes w
  WHERE EXISTS(SELECT 1 FROM wallet_registrations r WHERE r.serial=w.serial)
   AND (w.push_retry_at IS NULL OR w.push_retry_at<=clock_timestamp())
  FOR UPDATE OF w SKIP LOCKED
 ), changed AS (
  UPDATE wallet_passes w SET fingerprint=wallet_fingerprint(c.card),changed_at=clock_timestamp()
  FROM candidates c WHERE w.serial=c.serial AND w.fingerprint<>wallet_fingerprint(c.card)
  RETURNING w.serial,coalesce((c.card->>'active')::boolean,false) AS active
 )
 SELECT p.serial,array_agg(DISTINCT r.push_token),p.active FROM changed p JOIN wallet_registrations r ON r.serial=p.serial GROUP BY p.serial,p.active;
END $$;

-- After a push round for a pass: retry=false clears the backoff; retry=true marks the pass changed
-- again ('' never equals a real md5) and waits 15s, 30s, 1m ... up to 30m. After 8 failed rounds the
-- update waits for the card's next change. Returns the attempt number when a retry was scheduled.
CREATE FUNCTION wallet_push_result(serial_arg uuid,retry boolean) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE n integer;
BEGIN
 IF NOT retry THEN
  UPDATE wallet_passes SET push_attempts=0,push_retry_at=NULL WHERE serial=serial_arg AND (push_attempts<>0 OR push_retry_at IS NOT NULL);
  RETURN 0;
 END IF;
 UPDATE wallet_passes SET push_attempts=push_attempts+1 WHERE serial=serial_arg RETURNING push_attempts INTO n;
 IF n IS NULL THEN RETURN 0; END IF;
 IF n>8 THEN
  UPDATE wallet_passes SET push_attempts=0,push_retry_at=NULL WHERE serial=serial_arg;
  RETURN 0;
 END IF;
 UPDATE wallet_passes SET fingerprint='',
  push_retry_at=clock_timestamp()+least(interval '30 minutes',make_interval(secs=>15*power(2,n-1)))
 WHERE serial=serial_arg;
 RETURN n;
END $$;
REVOKE ALL ON FUNCTION wallet_push_result(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wallet_push_result(uuid,boolean) TO nuqta_worker;
