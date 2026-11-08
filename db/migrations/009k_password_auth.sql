ALTER TABLE users ADD COLUMN password_hash text, ADD COLUMN password_version integer NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN auth_method text NOT NULL DEFAULT 'otp' CHECK(auth_method IN ('otp','password','managed')),
 ADD COLUMN credential_version integer NOT NULL DEFAULT 0;
CREATE TABLE password_login_guards (
 email text PRIMARY KEY,failures integer NOT NULL DEFAULT 0,locked_until timestamptz,last_attempt_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE password_reset_tokens (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),user_id uuid NOT NULL REFERENCES users(id),token_hash text NOT NULL UNIQUE,
 credential_version integer NOT NULL,expires_at timestamptz NOT NULL,used_at timestamptz,created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_user ON password_reset_tokens(user_id,created_at DESC);
REVOKE ALL ON password_login_guards,password_reset_tokens FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON password_login_guards,password_reset_tokens TO nuqta_auth;
-- Existing non-password sessions cannot be used in the simplified login flow.
UPDATE sessions SET revoked_at=clock_timestamp() WHERE revoked_at IS NULL;
