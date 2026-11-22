-- One definition of a "visit", used by every report.
-- A visit is one customer on one business day (the shop's own calendar day) with at least one
-- stamp that counts: an award that is not the welcome stamp and was not taken back in full.
-- Before this, only stamps with a scanned purchase or a receipt number were counted, so automatic
-- (location) stamps never appeared as visits at all.
-- Additive: one view, one helper and one index. No table or existing row changes; the running release ignores it.

-- Corrections are looked up by the award they point at.
CREATE INDEX tx_original ON loyalty_transactions(original_transaction_id) WHERE original_transaction_id IS NOT NULL;

-- An award stops counting once corrections pointing at it have taken back all of its stamps.
CREATE FUNCTION award_still_counts(tx_id uuid,quantity integer) RETURNS boolean LANGUAGE sql STABLE
SET search_path=public,pg_temp AS $$
 SELECT coalesce((SELECT -sum(c.quantity) FROM loyalty_transactions c
                  WHERE c.original_transaction_id=tx_id AND c.type='correction'),0) < quantity
$$;
REVOKE ALL ON FUNCTION award_still_counts(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION award_still_counts(uuid,integer) TO nuqta_runtime;

-- security_invoker: the caller's row-level security on loyalty_transactions and memberships applies.
CREATE VIEW visits_v WITH (security_invoker=true) AS
SELECT t.merchant_id,
       t.membership_id,
       ms.profile_id,
       (t.at AT TIME ZONE m.timezone)::date AS business_date,
       min(t.at) AS first_at,
       max(t.at) AS last_at,
       (array_agg(t.branch_id ORDER BY t.at))[1] AS branch_id,
       (array_agg(t.staff_id ORDER BY t.at))[1] AS staff_id,
       sum(t.quantity)::int AS stamps,
       array_remove(array_agg(DISTINCT t.receipt_note),NULL) AS receipts
FROM loyalty_transactions t
JOIN memberships ms ON ms.id=t.membership_id
JOIN merchants m ON m.id=t.merchant_id
WHERE t.type='award' AND t.source<>'welcome' AND award_still_counts(t.id,t.quantity)
GROUP BY t.merchant_id,t.membership_id,ms.profile_id,(t.at AT TIME ZONE m.timezone)::date;
REVOKE ALL ON visits_v FROM PUBLIC;
GRANT SELECT ON visits_v TO nuqta_runtime;
