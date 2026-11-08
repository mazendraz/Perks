ALTER TABLE ledger_entries ADD CONSTRAINT ledger_account_identity UNIQUE(merchant_id,membership_id,id);
ALTER TABLE ledger_entries DROP CONSTRAINT ledger_entries_compensates_entry_id_fkey;
ALTER TABLE ledger_entries ADD CONSTRAINT compensation_same_account FOREIGN KEY(merchant_id,membership_id,compensates_entry_id) REFERENCES ledger_entries(merchant_id,membership_id,id);
ALTER TABLE reward_grants ADD CONSTRAINT reward_account_identity UNIQUE(merchant_id,membership_id,id);
ALTER TABLE ledger_entries ADD CONSTRAINT ledger_reward_same_account FOREIGN KEY(merchant_id,membership_id,reward_id) REFERENCES reward_grants(merchant_id,membership_id,id);
ALTER TABLE redemption_challenges ADD CONSTRAINT challenge_reward_same_account FOREIGN KEY(merchant_id,membership_id,reward_id) REFERENCES reward_grants(merchant_id,membership_id,id);
