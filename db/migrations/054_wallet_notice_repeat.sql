-- Wallet announces the pass's message field only when its value changes, and the value is derived
-- from the words. A second reminder in the same absence, or a shop message with the same words as
-- one this card already got, was therefore silent. They now carry a marker (the series step, or
-- "repeat") that the pass builder mixes into the value. Cards without a repeat are unchanged, so
-- this migration re-sends no pass that did not need it.
-- Same as 048 otherwise.
CREATE OR REPLACE FUNCTION wallet_card_json(member_arg uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT wallet_card_base_json(member_arg)
  || jsonb_build_object('reminder_templates',CASE WHEN manual.at IS NULL OR reminder.at>manual.at THEN reminder.templates END)
  || CASE WHEN manual.at IS NOT NULL AND (reminder.at IS NULL OR manual.at>=reminder.at)
     THEN jsonb_build_object('manual_message',manual.message) ELSE '{}'::jsonb END
  || jsonb_build_object('restore_generation',coalesce((SELECT k.generation FROM wallet_restore_keys k WHERE k.membership_id=member_arg),1))
 FROM (SELECT 1) singleton LEFT JOIN LATERAL(
  SELECT jsonb_build_object('wallet',s.settings->'wallet','walletReady',s.settings->'walletReady')
   || CASE WHEN r.step>1 THEN jsonb_build_object('step',r.step) ELSE '{}'::jsonb END AS templates,r.created_at AS at
  FROM customer_reminders r JOIN customer_reminder_settings s ON s.merchant_id=r.merchant_id
  WHERE r.membership_id=member_arg AND r.channel='apple' AND r.status IN ('processing','accepted') AND reminder_eligible(r.id)
  ORDER BY r.created_at DESC LIMIT 1
 ) reminder ON true LEFT JOIN LATERAL(
  SELECT jsonb_build_object('id',d.id,'ar',wm.body_ar,'en',coalesce(wm.body_en,wm.body_ar))
   || CASE WHEN EXISTS(
     SELECT 1 FROM wallet_message_deliveries d2 JOIN wallet_messages wm2 ON wm2.id=d2.message_id
     WHERE d2.membership_id=member_arg AND d2.channel='apple' AND d2.created_at<d.created_at
      AND d2.status IN ('processing','accepted')
      AND wm2.body_ar=wm.body_ar AND coalesce(wm2.body_en,wm2.body_ar)=coalesce(wm.body_en,wm.body_ar))
    THEN jsonb_build_object('repeat',true) ELSE '{}'::jsonb END AS message,d.created_at AS at
  FROM wallet_message_deliveries d JOIN wallet_messages wm ON wm.id=d.message_id
  WHERE d.membership_id=member_arg AND d.channel='apple' AND d.status IN ('processing','accepted') AND wallet_message_eligible(d.id)
  ORDER BY d.created_at DESC LIMIT 1
 ) manual ON true
$$;
