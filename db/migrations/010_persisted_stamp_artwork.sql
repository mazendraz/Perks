-- The artwork seed is the immutable earned ledger row plus its unit ordinal.
-- No random visual state or balance is stored in the browser.
CREATE FUNCTION customer_stamp_artwork(member_arg uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE start_unit bigint; units integer; result jsonb;
BEGIN
 SELECT (a.cycle_number::bigint-1)*v.threshold,
  CASE WHEN EXISTS(SELECT 1 FROM reward_grants r WHERE r.membership_id=m.id AND r.status='available' AND r.expires_at>now()) THEN v.threshold ELSE least(a.balance,v.threshold) END
 INTO start_unit,units FROM memberships m JOIN loyalty_accounts a ON a.membership_id=m.id
 JOIN program_versions v ON v.id=m.program_version_id WHERE m.id=member_arg AND m.user_id=app_user();
 IF start_unit IS NULL OR units<=0 THEN RETURN '[]'::jsonb;END IF;
 WITH earned AS (
  SELECT e.id,e.amount,e.sequence,
   sum(e.amount) OVER(ORDER BY e.sequence ROWS UNBOUNDED PRECEDING)-e.amount AS first_unit
  FROM ledger_entries e WHERE e.membership_id=member_arg AND e.type='earn'
   AND NOT EXISTS(SELECT 1 FROM ledger_entries correction WHERE correction.compensates_entry_id=e.id)
 ), marks AS (
  SELECT e.id,e.sequence,ordinal FROM earned e CROSS JOIN LATERAL
   generate_series(greatest(1,start_unit-e.first_unit+1)::integer,least(e.amount,start_unit+units-e.first_unit)::integer) ordinal
  WHERE e.first_unit+e.amount>start_unit AND e.first_unit<start_unit+units
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('ledgerId',id,'ordinal',ordinal) ORDER BY sequence,ordinal),'[]'::jsonb) INTO result FROM marks;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION customer_stamp_artwork(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION customer_stamp_artwork(uuid) TO nuqta_runtime;
