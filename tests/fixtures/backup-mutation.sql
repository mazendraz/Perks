-- Synthetic, cloned database only. Never run this against the development or production cluster.
DO $$
DECLARE src record; op uuid=gen_random_uuid(); tx uuid=gen_random_uuid(); purchase uuid=gen_random_uuid();
BEGIN
 IF current_database()<>'nuqta' OR current_setting('data_directory') !~ '^/tmp/nuqta-backup-test[.][A-Za-z0-9]+/source$' THEN
  RAISE EXCEPTION 'This mutation is limited to the owned Linux backup fixture.';
 END IF;
 SELECT m.id,m.merchant_id,m.program_version_id,s.id AS staff_id,s.user_id,b.branch_id
 INTO STRICT src FROM memberships m JOIN loyalty_accounts a ON a.membership_id=m.id
 JOIN program_versions v ON v.id=m.program_version_id
 JOIN staff_memberships s ON s.merchant_id=m.merchant_id
 JOIN staff_branch_grants b ON b.staff_id=s.id AND b.merchant_id=m.merchant_id
 JOIN program_branches pb ON pb.program_version_id=v.id AND pb.branch_id=b.branch_id
 WHERE a.balance+1<v.threshold LIMIT 1;
 INSERT INTO operations(id,actor_id,merchant_id,scope,idempotency_key,request_hash,status,result,committed_at)
 VALUES(op,src.user_id,src.merchant_id,'backup.synthetic',op::text,repeat('a',64),'committed','{}',clock_timestamp());
 INSERT INTO purchase_references(id,merchant_id,branch_id,namespace,business_date,reference,normalized_reference)
 VALUES(purchase,src.merchant_id,src.branch_id,'manual',current_date,'BACKUP-'||op,'BACKUP-'||op);
 INSERT INTO loyalty_transactions(id,public_reference,merchant_id,membership_id,program_version_id,branch_id,staff_id,operation_id,purchase_id,type,quantity,source)
 VALUES(tx,'BACKUP-'||tx,src.merchant_id,src.id,src.program_version_id,src.branch_id,src.staff_id,op,purchase,'award',1,'scan');
 INSERT INTO purchase_allocations(merchant_id,purchase_id,membership_id,transaction_id) VALUES(src.merchant_id,purchase,src.id,tx);
 INSERT INTO ledger_entries(merchant_id,membership_id,transaction_id,program_version_id,type,amount)
 VALUES(src.merchant_id,src.id,tx,src.program_version_id,'earn',1);
 UPDATE loyalty_accounts SET balance=balance+1,revision=revision+1,last_purchase_at=clock_timestamp() WHERE membership_id=src.id;
END $$;
