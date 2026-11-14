-- Security M3: the account-wide lock (20 failures / 15 min across all addresses) let anyone
-- who knows a staff email lock the real owner out on demand. The aggregate lock stays to
-- stop distributed guessing, but an address that recently signed in successfully to the
-- same account is exempt from it (its own per-address lock still applies).
CREATE TABLE password_login_known_addresses (
 email text NOT NULL,
 ip_hash text NOT NULL CHECK(ip_hash ~ '^[a-f0-9]{64}$'),
 last_success_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(email,ip_hash)
);
CREATE INDEX password_login_known_recent ON password_login_known_addresses(last_success_at);
REVOKE ALL ON password_login_known_addresses FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE,DELETE ON password_login_known_addresses TO nuqta_auth;
