-- "Reached" used to mean APNs or Google accepted the request, which says nothing about the phone.
-- An iPhone that got the push downloads the updated pass from our web service: that download is
-- the proof that the message is on the phone. It is recorded per delivery.
ALTER TABLE wallet_message_deliveries ADD COLUMN fetched_at timestamptz;

-- Called by the Apple web service after it served a pass (200, not 304) that carries delivery_arg.
-- Fenced by the pass's own token and by the delivery belonging to that pass's card.
CREATE FUNCTION wallet_pass_fetched(serial_arg uuid,token_hash_arg text,delivery_arg uuid) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 UPDATE wallet_message_deliveries d SET fetched_at=clock_timestamp()
 FROM wallet_passes w
 WHERE w.serial=serial_arg AND w.auth_token_hash=token_hash_arg
  AND d.id=delivery_arg AND d.membership_id=w.membership_id AND d.channel='apple' AND d.fetched_at IS NULL
$$;
REVOKE ALL ON FUNCTION wallet_pass_fetched(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION wallet_pass_fetched(uuid,text,uuid) TO nuqta_runtime;
