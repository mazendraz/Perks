-- Visits, take two (fixes 040).
-- 1. One visit is one CUSTOMER on one business day. 040 grouped by card, so a customer stamped on
--    two programmes the same day was two visits in Today/overview but one on the analytics page.
-- 2. Every staff member who stamped during the visit is kept (staff_ids), so "my visits" credits
--    each cashier who served the customer, not only the first one.
-- 3. The "taken back in full" check is inlined: a function with SET search_path cannot be
--    inlined by the planner and was called once per award row.
-- 4. visits_since(shop, from_date) reads only the transactions of the window, through the
--    (merchant_id, at) index. The view groups first and filters after, so a filter on first_at
--    made every report read the shop's whole history.

DROP VIEW visits_v;

-- security_invoker: the caller's row-level security on loyalty_transactions and memberships applies.
CREATE VIEW visits_v WITH (security_invoker=true) AS
SELECT t.merchant_id,
       ms.profile_id,
       (t.at AT TIME ZONE m.timezone)::date AS business_date,
       min(t.at) AS first_at,
       max(t.at) AS last_at,
       (array_agg(t.branch_id ORDER BY t.at))[1] AS branch_id,
       (array_agg(t.staff_id ORDER BY t.at))[1] AS staff_id,
       array_remove(array_agg(DISTINCT t.staff_id),NULL) AS staff_ids,
       sum(t.quantity)::int AS stamps,
       array_remove(array_agg(DISTINCT t.receipt_note),NULL) AS receipts
FROM loyalty_transactions t
JOIN memberships ms ON ms.id=t.membership_id
JOIN merchants m ON m.id=t.merchant_id
WHERE t.type='award' AND t.source<>'welcome'
  AND coalesce((SELECT -sum(c.quantity) FROM loyalty_transactions c
                 WHERE c.original_transaction_id=t.id AND c.type='correction'),0) < t.quantity
GROUP BY t.merchant_id,ms.profile_id,(t.at AT TIME ZONE m.timezone)::date;
REVOKE ALL ON visits_v FROM PUBLIC;
GRANT SELECT ON visits_v TO nuqta_runtime;

-- The same rows for one shop, business days from `since` on. Plain SQL, invoker rights and no SET
-- clause, so the planner can inline it and the caller's row-level security still applies.
-- The lower bound on t.at keeps a day of slack for any timezone; the exact day is checked after.
CREATE FUNCTION visits_since(mid uuid,since date)
RETURNS TABLE(merchant_id uuid,profile_id uuid,business_date date,first_at timestamptz,last_at timestamptz,
              branch_id uuid,staff_id uuid,staff_ids uuid[],stamps integer,receipts text[])
LANGUAGE sql STABLE AS $$
 SELECT t.merchant_id,
        ms.profile_id,
        (t.at AT TIME ZONE m.timezone)::date,
        min(t.at),
        max(t.at),
        (array_agg(t.branch_id ORDER BY t.at))[1],
        (array_agg(t.staff_id ORDER BY t.at))[1],
        array_remove(array_agg(DISTINCT t.staff_id),NULL),
        sum(t.quantity)::int,
        array_remove(array_agg(DISTINCT t.receipt_note),NULL)
 FROM loyalty_transactions t
 JOIN memberships ms ON ms.id=t.membership_id
 JOIN merchants m ON m.id=t.merchant_id
 WHERE t.merchant_id=mid
   AND t.at>=(since::timestamp AT TIME ZONE 'UTC')-interval '1 day'
   AND (t.at AT TIME ZONE m.timezone)::date>=since
   AND t.type='award' AND t.source<>'welcome'
   AND coalesce((SELECT -sum(c.quantity) FROM loyalty_transactions c
                  WHERE c.original_transaction_id=t.id AND c.type='correction'),0) < t.quantity
 GROUP BY t.merchant_id,ms.profile_id,(t.at AT TIME ZONE m.timezone)::date
$$;
REVOKE ALL ON FUNCTION visits_since(uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION visits_since(uuid,date) TO nuqta_runtime;
