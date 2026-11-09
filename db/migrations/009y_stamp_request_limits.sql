ALTER TABLE stamp_requests ALTER COLUMN expires_at SET DEFAULT clock_timestamp()+interval '10 minutes';
ALTER TABLE merchants ADD COLUMN stamp_request_daily_limit integer NOT NULL DEFAULT 10
 CHECK(stamp_request_daily_limit BETWEEN 1 AND 100);
CREATE INDEX request_holder_day ON stamp_requests(merchant_id,user_id,created_at);
CREATE FUNCTION customer_request_policy(member_arg uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 SELECT jsonb_build_object('limit',m.stamp_request_daily_limit,
 'dayStart',date_trunc('day',clock_timestamp() AT TIME ZONE m.timezone) AT TIME ZONE m.timezone,
 'dayEnd',(date_trunc('day',clock_timestamp() AT TIME ZONE m.timezone)+interval '1 day') AT TIME ZONE m.timezone)
 INTO result FROM memberships ms JOIN merchants m ON m.id=ms.merchant_id
 WHERE ms.id=member_arg AND ms.user_id=app_user() AND ms.status='active';
 IF result IS NULL THEN RAISE EXCEPTION 'NQ:NOT_FOUND';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION customer_request_policy(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION customer_request_policy(uuid) TO nuqta_runtime;
