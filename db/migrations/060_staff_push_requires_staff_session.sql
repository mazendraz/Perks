-- Staff notifications (customer first names, branch and scan activity) belong to a staff
-- sign-in. A customer device session represents the cardholder even when the same legacy user
-- also works at a shop, so it can never hold a staff push subscription: refuse it on every
-- write, and remove any that were recorded before this check existed. The recipient lookups
-- read only push_subscriptions, so nothing left behind can be delivered to.
CREATE FUNCTION push_subscription_staff_session() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.session_id IS NULL OR NOT EXISTS(
  SELECT 1 FROM sessions s WHERE s.id=NEW.session_id AND s.user_id=NEW.user_id AND s.auth_method<>'device'
 ) THEN RAISE EXCEPTION 'NQ:FORBIDDEN';END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION push_subscription_staff_session() FROM PUBLIC;
CREATE TRIGGER push_subscription_staff_session BEFORE INSERT OR UPDATE OF session_id,user_id
 ON push_subscriptions FOR EACH ROW EXECUTE FUNCTION push_subscription_staff_session();
DELETE FROM push_subscriptions p USING sessions s WHERE s.id=p.session_id AND s.auth_method='device';
