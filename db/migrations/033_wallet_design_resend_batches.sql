-- A new Wallet design reaches saved cards in small batches instead of all at once. Rebuilding an
-- Apple pass is real work for the server, so thousands of passes at once would slow down normal
-- stamping. Each card remembers the design it was last sent; the worker re-sends a few hundred
-- cards a minute until every card has the current one.
ALTER TABLE wallet_passes ADD COLUMN design_sent text;
ALTER TABLE google_wallet_objects ADD COLUMN design_sent text;

-- A card issued now is already drawn with the current design.
CREATE FUNCTION wallet_design_stamp_new() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 NEW.design_sent:=(SELECT signature FROM wallet_design_state WHERE id);
 RETURN NEW;
END $$;
CREATE TRIGGER wallet_passes_design_sent BEFORE INSERT ON wallet_passes
 FOR EACH ROW EXECUTE FUNCTION wallet_design_stamp_new();
CREATE TRIGGER google_wallet_objects_design_sent BEFORE INSERT ON google_wallet_objects
 FOR EACH ROW EXECUTE FUNCTION wallet_design_stamp_new();

-- Only records the design now; wallet_design_resend sends it out.
CREATE OR REPLACE FUNCTION wallet_design_sync(signature_arg text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_signature text;
BEGIN
 IF signature_arg IS NULL OR length(signature_arg) NOT BETWEEN 8 AND 64 THEN
  RAISE EXCEPTION 'wallet_design_sync: invalid signature';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('wallet-design-sync'));
 SELECT signature INTO current_signature FROM wallet_design_state WHERE id;
 IF current_signature IS NOT DISTINCT FROM signature_arg THEN RETURN false; END IF;
 INSERT INTO wallet_design_state(id,signature) VALUES(true,signature_arg)
 ON CONFLICT(id) DO UPDATE SET signature=EXCLUDED.signature,changed_at=clock_timestamp();
 RETURN true;
END $$;

-- Queues up to apple_limit Apple passes (only ones installed on a device) and google_limit Google
-- cards that have not had the current design yet. Returns how many were queued.
CREATE FUNCTION wallet_design_resend(apple_limit integer,google_limit integer) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_signature text; apple_count integer; google_count integer;
BEGIN
 SELECT signature INTO current_signature FROM wallet_design_state WHERE id;
 IF current_signature IS NULL THEN RETURN 0; END IF;
 WITH batch AS (
  SELECT w.serial FROM wallet_passes w
  WHERE w.design_sent IS DISTINCT FROM current_signature
   AND EXISTS(SELECT 1 FROM wallet_registrations r WHERE r.serial=w.serial)
  LIMIT greatest(apple_limit,0) FOR UPDATE OF w SKIP LOCKED
 )
 UPDATE wallet_passes w SET fingerprint='',design_sent=current_signature FROM batch WHERE w.serial=batch.serial;
 GET DIAGNOSTICS apple_count = ROW_COUNT;
 WITH batch AS (
  SELECT g.object_key FROM google_wallet_objects g
  WHERE g.design_sent IS DISTINCT FROM current_signature
  LIMIT greatest(google_limit,0) FOR UPDATE OF g SKIP LOCKED
 )
 UPDATE google_wallet_objects g SET fingerprint='',design_sent=current_signature FROM batch WHERE g.object_key=batch.object_key;
 GET DIAGNOSTICS google_count = ROW_COUNT;
 RETURN apple_count+google_count;
END $$;
REVOKE ALL ON FUNCTION wallet_design_resend(integer,integer),wallet_design_stamp_new() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wallet_design_resend(integer,integer) TO nuqta_worker;
