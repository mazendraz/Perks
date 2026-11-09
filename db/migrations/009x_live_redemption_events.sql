-- Removing the customer's polling must preserve the holder's mandatory
-- redemption-confirmation flow, including creation before any ledger entry.
CREATE FUNCTION notify_redemption_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM pg_notify('nuqta_customer_activity',jsonb_build_object(
  'kind','challenge','id',NEW.id,'membershipId',NEW.membership_id,
  'merchantId',NEW.merchant_id,'branchId',NEW.branch_id,'userId',NEW.holder_user_id)::text);
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION notify_redemption_activity() FROM PUBLIC;
CREATE TRIGGER live_redemption_event AFTER INSERT OR UPDATE ON redemption_challenges
 FOR EACH ROW EXECUTE FUNCTION notify_redemption_activity();
