-- Notifications are transaction-bound hints. Consumers must read authorized state;
-- payloads contain opaque IDs only, never a name, phone, email, balance or token.
CREATE FUNCTION notify_customer_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE holder uuid; branch uuid;
BEGIN
 IF TG_TABLE_NAME='ledger_entries' THEN
  SELECT m.user_id,t.branch_id INTO holder,branch FROM memberships m
   JOIN loyalty_transactions t ON t.id=NEW.transaction_id AND t.merchant_id=m.merchant_id
   WHERE m.id=NEW.membership_id AND m.merchant_id=NEW.merchant_id;
 ELSE
  holder:=NEW.user_id; branch:=NEW.branch_id;
 END IF;
 IF holder IS NOT NULL THEN
  PERFORM pg_notify('nuqta_customer_activity',jsonb_build_object(
   'kind',CASE WHEN TG_TABLE_NAME='ledger_entries' THEN 'ledger' ELSE 'request' END,
   'id',NEW.id,'membershipId',NEW.membership_id,'merchantId',NEW.merchant_id,
   'branchId',branch,'userId',holder)::text);
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION notify_customer_activity() FROM PUBLIC;
CREATE TRIGGER live_ledger_event AFTER INSERT ON ledger_entries
 FOR EACH ROW EXECUTE FUNCTION notify_customer_activity();
CREATE TRIGGER live_request_event AFTER INSERT OR UPDATE ON stamp_requests
 FOR EACH ROW EXECUTE FUNCTION notify_customer_activity();
