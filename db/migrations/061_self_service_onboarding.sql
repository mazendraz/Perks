CREATE TABLE merchant_onboarding_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES users(id),
 merchant_id uuid UNIQUE REFERENCES merchants(id),
 details jsonb NOT NULL DEFAULT '{}',
 revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX merchant_onboarding_one_open_draft
 ON merchant_onboarding_drafts (owner_id) WHERE merchant_id IS NULL;

CREATE TABLE merchant_onboarding_orders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 draft_id uuid NOT NULL REFERENCES merchant_onboarding_drafts(id),
 plan_id uuid NOT NULL REFERENCES plans(id),
 amount_minor integer NOT NULL CHECK (amount_minor > 0),
 currency text NOT NULL CHECK (currency = 'EGP'),
 duration_days integer NOT NULL CHECK (duration_days > 0),
 recipient_account text NOT NULL CHECK (btrim(recipient_account) <> ''),
 submitted_reference text,
 receipt_key uuid,
 receipt_image bytea,
 confirmed_reference text,
 confirmed_by uuid REFERENCES users(id),
 confirmed_at timestamptz,
 rejected_at timestamptz,
 rejected_by uuid REFERENCES users(id),
 rejection_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((receipt_key IS NULL) = (submitted_reference IS NULL)),
 CHECK ((receipt_key IS NULL) = (receipt_image IS NULL)),
 CHECK (receipt_image IS NULL OR octet_length(receipt_image) <= 2000000),
 CHECK ((confirmed_reference IS NULL) = (confirmed_at IS NULL)),
 CHECK ((confirmed_by IS NULL) = (confirmed_at IS NULL)),
 CHECK ((rejected_by IS NULL) = (rejected_at IS NULL)),
 CHECK ((rejection_reason IS NULL) = (rejected_at IS NULL)),
 CHECK (rejected_at IS NULL OR (receipt_key IS NOT NULL AND confirmed_at IS NULL)),
 CHECK (confirmed_reference IS NULL OR
   (receipt_key IS NOT NULL AND btrim(confirmed_reference) <> ''))
);
CREATE UNIQUE INDEX merchant_onboarding_confirmed_transfer
 ON merchant_onboarding_orders (recipient_account, lower(btrim(confirmed_reference)))
 WHERE confirmed_reference IS NOT NULL;
CREATE UNIQUE INDEX merchant_onboarding_one_confirmed_order
 ON merchant_onboarding_orders (draft_id) WHERE confirmed_reference IS NOT NULL;

ALTER TABLE merchant_onboarding_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_onboarding_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY merchant_onboarding_draft_read ON merchant_onboarding_drafts FOR SELECT
 USING (owner_id = app_user() OR is_platform_admin());
CREATE POLICY merchant_onboarding_order_read ON merchant_onboarding_orders FOR SELECT
 USING (is_platform_admin() OR EXISTS (
   SELECT 1 FROM merchant_onboarding_drafts d
   WHERE d.id = draft_id AND d.owner_id = app_user()
 ));
GRANT SELECT ON merchant_onboarding_drafts, merchant_onboarding_orders TO nuqta_runtime;
CREATE POLICY merchant_onboarding_draft_insert ON merchant_onboarding_drafts FOR INSERT
 WITH CHECK (owner_id = app_user() AND merchant_id IS NULL);
CREATE POLICY merchant_onboarding_draft_update ON merchant_onboarding_drafts FOR UPDATE
 USING (owner_id = app_user() AND merchant_id IS NULL)
 WITH CHECK (owner_id = app_user() AND merchant_id IS NULL);
GRANT INSERT (owner_id), UPDATE (details, revision, updated_at)
 ON merchant_onboarding_drafts TO nuqta_runtime;

CREATE POLICY merchant_onboarding_order_insert ON merchant_onboarding_orders FOR INSERT
 WITH CHECK (EXISTS (
   SELECT 1 FROM merchant_onboarding_drafts d
   WHERE d.id = draft_id AND d.owner_id = app_user() AND d.merchant_id IS NULL
 ));
GRANT INSERT (draft_id, plan_id, amount_minor, currency, duration_days, recipient_account)
 ON merchant_onboarding_orders TO nuqta_runtime;
CREATE POLICY merchant_onboarding_order_submit ON merchant_onboarding_orders FOR UPDATE
 USING (confirmed_at IS NULL AND EXISTS (
   SELECT 1 FROM merchant_onboarding_drafts d
   WHERE d.id = draft_id AND d.owner_id = app_user() AND d.merchant_id IS NULL
 ))
 WITH CHECK (confirmed_at IS NULL AND EXISTS (
   SELECT 1 FROM merchant_onboarding_drafts d
   WHERE d.id = draft_id AND d.owner_id = app_user() AND d.merchant_id IS NULL
 ));
GRANT UPDATE (submitted_reference, receipt_key, receipt_image)
 ON merchant_onboarding_orders TO nuqta_runtime;
CREATE POLICY merchant_onboarding_order_confirm ON merchant_onboarding_orders FOR UPDATE
 USING (is_platform_admin())
 WITH CHECK (is_platform_admin() AND (confirmed_by = app_user() OR rejected_by = app_user()));
GRANT UPDATE (confirmed_reference, confirmed_by, confirmed_at, rejected_at, rejected_by, rejection_reason)
 ON merchant_onboarding_orders TO nuqta_runtime;

CREATE FUNCTION merchant_onboarding_monthly_plans()
RETURNS TABLE (plan_id uuid, plan_key text, name_ar text, name_en text, amount_minor integer)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT p.id,p.key,p.name_ar,p.name_en,pr.amount_minor + pr.setup_fee_per_branch_minor
 FROM plans p JOIN plan_prices pr ON pr.plan_id=p.id
 WHERE p.is_public AND p.is_active AND NOT p.is_custom
   AND pr.is_active AND pr.currency='EGP' AND pr.billing_period='monthly'
   AND pr.amount_minor + pr.setup_fee_per_branch_minor > 0
 ORDER BY p.sort_order,p.key
$$;
REVOKE ALL ON FUNCTION merchant_onboarding_monthly_plans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION merchant_onboarding_monthly_plans() TO nuqta_runtime;
