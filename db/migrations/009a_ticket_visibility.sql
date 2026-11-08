-- Visibility must not look up the just-inserted ticket from a STABLE helper:
-- INSERT ... RETURNING checks the row before that helper can see it.
ALTER POLICY ticket_scope ON support_tickets USING(is_platform_staff() OR EXISTS(SELECT 1 FROM staff_memberships s WHERE s.merchant_id=support_tickets.merchant_id AND s.user_id=app_user() AND s.status='active' AND s.role='owner'));
