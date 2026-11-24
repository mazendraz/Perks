ALTER TABLE merchant_onboarding_orders
 ADD COLUMN corrects_order_id uuid UNIQUE REFERENCES merchant_onboarding_orders(id),
 ADD COLUMN suspended_merchant_revision integer;

CREATE OR REPLACE FUNCTION suspend_rejected_onboarding_merchant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE suspended_revision integer;
BEGIN
 UPDATE merchants m SET status='suspended',suspend_reason=NEW.rejection_reason,revision=m.revision+1
 FROM merchant_onboarding_drafts d WHERE d.published_order_id=NEW.id AND d.merchant_id=m.id
 AND m.status<>'suspended' RETURNING m.revision INTO suspended_revision;
 IF suspended_revision IS NOT NULL THEN
  UPDATE merchant_onboarding_orders SET suspended_merchant_revision=suspended_revision WHERE id=NEW.id;
 END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION start_onboarding_correction(draft_arg uuid) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d merchant_onboarding_drafts; previous merchant_onboarding_orders; next_id uuid;
BEGIN
 SELECT * INTO d FROM merchant_onboarding_drafts WHERE id=draft_arg AND owner_id=app_user() FOR UPDATE;
 IF NOT FOUND OR d.merchant_id IS NULL THEN RAISE EXCEPTION 'NQ:NOT_FOUND'; END IF;
 SELECT * INTO previous FROM merchant_onboarding_orders WHERE id=d.published_order_id;
 IF previous.rejected_at IS NULL THEN RAISE EXCEPTION 'NQ:REVISION_CONFLICT'; END IF;
 LOOP
  SELECT id INTO next_id FROM merchant_onboarding_orders WHERE corrects_order_id=previous.id;
  IF NOT FOUND THEN
   INSERT INTO merchant_onboarding_orders(draft_id,plan_id,amount_minor,currency,duration_days,recipient_account,corrects_order_id)
    VALUES(d.id,previous.plan_id,previous.amount_minor,previous.currency,previous.duration_days,previous.recipient_account,previous.id)
    RETURNING id INTO next_id;
   RETURN next_id;
  END IF;
  SELECT * INTO previous FROM merchant_onboarding_orders WHERE id=next_id;
  IF previous.rejected_at IS NULL THEN RETURN next_id; END IF;
 END LOOP;
END $$;
REVOKE ALL ON FUNCTION start_onboarding_correction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION start_onboarding_correction(uuid) TO nuqta_runtime;

DROP POLICY merchant_onboarding_order_submit ON merchant_onboarding_orders;
CREATE POLICY merchant_onboarding_order_submit ON merchant_onboarding_orders FOR UPDATE
 USING (confirmed_at IS NULL AND rejected_at IS NULL AND EXISTS (
   SELECT 1 FROM merchant_onboarding_drafts d
   WHERE d.id = draft_id AND d.owner_id = app_user()
     AND (d.merchant_id IS NULL OR corrects_order_id IS NOT NULL)
 ))
 WITH CHECK (confirmed_at IS NULL AND rejected_at IS NULL AND EXISTS (
   SELECT 1 FROM merchant_onboarding_drafts d
   WHERE d.id = draft_id AND d.owner_id = app_user()
     AND (d.merchant_id IS NULL OR corrects_order_id IS NOT NULL)
 ));

CREATE FUNCTION restore_corrected_onboarding_merchant() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE d merchant_onboarding_drafts; original_revision integer;
BEGIN
 SELECT * INTO d FROM merchant_onboarding_drafts WHERE id=NEW.draft_id;
 IF d.merchant_id IS NULL THEN RETURN NEW; END IF;
 SELECT suspended_merchant_revision INTO original_revision
 FROM merchant_onboarding_orders WHERE id=d.published_order_id;
 UPDATE merchants SET status='active',suspend_reason=NULL,revision=revision+1
 WHERE id=d.merchant_id AND status='suspended' AND revision=original_revision;
 UPDATE merchant_onboarding_drafts SET published_order_id=NEW.id WHERE id=d.id;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION restore_corrected_onboarding_merchant() FROM PUBLIC;
CREATE TRIGGER merchant_onboarding_correction AFTER UPDATE OF confirmed_at ON merchant_onboarding_orders
 FOR EACH ROW WHEN (OLD.confirmed_at IS NULL AND NEW.confirmed_at IS NOT NULL AND NEW.corrects_order_id IS NOT NULL)
 EXECUTE FUNCTION restore_corrected_onboarding_merchant();
