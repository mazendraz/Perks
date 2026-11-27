-- When the owner sent the receipt under review, so the review queue can show and sort by it.
ALTER TABLE merchant_onboarding_orders ADD COLUMN receipt_submitted_at timestamptz;
UPDATE merchant_onboarding_orders SET receipt_submitted_at=created_at WHERE receipt_key IS NOT NULL;
-- Written by the owner's receipt upload, next to the receipt columns 061 lets them update.
GRANT UPDATE (receipt_submitted_at) ON merchant_onboarding_orders TO nuqta_runtime;
