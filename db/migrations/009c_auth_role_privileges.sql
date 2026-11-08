REVOKE SELECT ON users FROM nuqta_runtime;
GRANT SELECT(id,email,display_name,global_role,status,created_at) ON users TO nuqta_runtime;
REVOKE INSERT,UPDATE ON users FROM nuqta_auth;
GRANT INSERT(email,display_name,auth_subject),UPDATE(email,auth_subject,last_totp_counter) ON users TO nuqta_auth;
