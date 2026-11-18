-- Cards already saved in Apple Wallet and Google Wallet follow the current design by themselves.
-- The worker reports the design its build draws (a fingerprint of the artwork and pass fields);
-- when it differs from the last one, every saved card is re-sent once: Apple passes get a push and
-- Google cards are replaced. No migration is needed for the next design change.
CREATE TABLE wallet_design_state (
 id boolean PRIMARY KEY DEFAULT true CHECK (id),
 signature text NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE wallet_design_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON wallet_design_state FROM PUBLIC;

-- Returns true when the design changed and the saved cards were queued for a resend.
CREATE FUNCTION wallet_design_sync(signature_arg text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE current_signature text;
BEGIN
 IF signature_arg IS NULL OR length(signature_arg) NOT BETWEEN 8 AND 64 THEN
  RAISE EXCEPTION 'wallet_design_sync: invalid signature';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('wallet-design-sync'));
 SELECT signature INTO current_signature FROM wallet_design_state WHERE id;
 IF current_signature IS NOT DISTINCT FROM signature_arg THEN RETURN false; END IF;
 UPDATE wallet_passes SET fingerprint='' WHERE fingerprint<>'';
 UPDATE google_wallet_objects SET fingerprint='' WHERE fingerprint<>'';
 INSERT INTO wallet_design_state(id,signature) VALUES(true,signature_arg)
 ON CONFLICT(id) DO UPDATE SET signature=EXCLUDED.signature,changed_at=clock_timestamp();
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION wallet_design_sync(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wallet_design_sync(text) TO nuqta_worker;
