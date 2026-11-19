-- A 6-digit code the customer can read out when the camera cannot scan the QR.
-- Only its keyed hash is stored, scoped to the shop, and it lives as long as the QR (90 seconds).
ALTER TABLE presentation_tokens ADD COLUMN short_code_hash text;
CREATE INDEX presentation_short_code ON presentation_tokens(merchant_id,short_code_hash)
 WHERE short_code_hash IS NOT NULL;
