CREATE FUNCTION customer_merchant_guard(mid uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE merchant merchants;
BEGIN
 IF NOT customer_access(mid) THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 SELECT * INTO merchant FROM merchants WHERE id=mid FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 IF merchant.status NOT IN ('active','trial') THEN RAISE EXCEPTION 'NQ:MERCHANT_PAUSED';END IF;
END $$;
GRANT EXECUTE ON FUNCTION customer_merchant_guard(uuid) TO nuqta_runtime;
ALTER TABLE memberships ADD CONSTRAINT membership_holder_key UNIQUE(merchant_id,id,user_id);
ALTER TABLE stamp_requests ADD CONSTRAINT request_holder_fk FOREIGN KEY(merchant_id,membership_id,user_id) REFERENCES memberships(merchant_id,id,user_id);
