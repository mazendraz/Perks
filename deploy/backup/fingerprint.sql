-- One statement/snapshot. No names, contact details, credentials or rows leave the database.
SELECT jsonb_build_object(
 'migrations',(SELECT jsonb_object_agg(name,sha256) FROM schema_migrations),
 'counts',jsonb_build_object(
  'users',(SELECT count(*) FROM users),
  'merchants',(SELECT count(*) FROM merchants),
  'branches',(SELECT count(*) FROM branches),
  'memberships',(SELECT count(*) FROM memberships),
  'operations',(SELECT count(*) FROM operations),
  'loyalty_transactions',(SELECT count(*) FROM loyalty_transactions),
  'ledger_entries',(SELECT count(*) FROM ledger_entries),
  'reward_grants',(SELECT count(*) FROM reward_grants),
  'reward_redemptions',(SELECT count(*) FROM reward_redemptions),
  'outbox_events',(SELECT count(*) FROM outbox_events),
  'background_jobs',(SELECT count(*) FROM background_jobs)
 ),
 'transactions',(SELECT encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' ORDER BY id),''),'UTF8')),'hex') FROM loyalty_transactions t),
 'ledger',(SELECT encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' ORDER BY sequence),''),'UTF8')),'hex') FROM ledger_entries t),
 'accounts',(SELECT encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex'),'' ORDER BY membership_id),''),'UTF8')),'hex') FROM loyalty_accounts t),
 'balanceDrift',(SELECT count(*) FROM loyalty_accounts a WHERE balance<>(SELECT coalesce(sum(amount),0) FROM ledger_entries e WHERE e.membership_id=a.membership_id))
);
