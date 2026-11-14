-- Security M4: a password chosen by someone else (platform admin, owner) is known to that
-- person. The account holder must replace it before using anything except the auth routes.
-- Self-chosen passwords (change, reset link) clear the flag in the API.
ALTER TABLE users ADD COLUMN password_must_change boolean NOT NULL DEFAULT false;
-- The auth role reads it on every session lookup and clears it on a self-chosen password.
GRANT SELECT(password_must_change),UPDATE(password_must_change) ON users TO nuqta_auth;

CREATE OR REPLACE FUNCTION pg_temp.patch_function(sig regprocedure,old_text text,new_text text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE def text;n integer;
BEGIN
 def:=pg_get_functiondef(sig);
 n:=(length(def)-length(replace(def,old_text,'')))/length(old_text);
 IF n<>1 THEN RAISE EXCEPTION 'patch_function %: expected exactly one match, found %',sig,n;END IF;
 EXECUTE replace(def,old_text,new_text);
END $$;
SELECT pg_temp.patch_function('create_staff_password_account(uuid,text,text,text,integer,uuid[])',
 'INSERT INTO users(email,display_name,password_hash,password_version) VALUES(lower(email_arg),split_part(email_arg,''@'',1),hash_arg,1)',
 'INSERT INTO users(email,display_name,password_hash,password_version,password_must_change) VALUES(lower(email_arg),split_part(email_arg,''@'',1),hash_arg,1,true)');
SELECT pg_temp.patch_function('create_platform_admin(text,text,text,text)',
 'INSERT INTO users(email,display_name,global_role,password_hash,password_version) VALUES(email_arg,trim(name_arg),''platform_admin'',hash_arg,1)',
 'INSERT INTO users(email,display_name,global_role,password_hash,password_version,password_must_change) VALUES(email_arg,trim(name_arg),''platform_admin'',hash_arg,1,true)');
SELECT pg_temp.patch_function('manage_staff_security(uuid,uuid,text,text,integer,text)',
 'UPDATE users SET password_hash=hash_arg,password_version=password_version+1 WHERE id=uid;',
 'UPDATE users SET password_hash=hash_arg,password_version=password_version+1,password_must_change=true WHERE id=uid;');
SELECT pg_temp.patch_function('manage_platform_admin(uuid,text,text,integer,text)',
 'UPDATE users SET password_hash=hash_arg,password_version=password_version+1 WHERE id=uid;',
 'UPDATE users SET password_hash=hash_arg,password_version=password_version+1,password_must_change=true WHERE id=uid;');
DROP FUNCTION pg_temp.patch_function(regprocedure,text,text);
