#!/bin/sh
set -eu
# Only PostgreSQL's bootstrap process receives these passwords. Never echo SQL.
psql --no-psqlrc --username "$POSTGRES_USER" --dbname postgres -v ON_ERROR_STOP=1 <<'SQL'
-- Role passwords are SQL literals during bootstrap; suppress slow/error statement text in this session.
SET log_min_duration_statement=-1;
SET log_statement='none';
SET log_min_error_statement='panic';
\getenv migrator_password NUQTA_MIGRATOR_DB_PASSWORD
\getenv runtime_password NUQTA_RUNTIME_DB_PASSWORD
\getenv auth_password NUQTA_AUTH_DB_PASSWORD
\getenv worker_password NUQTA_WORKER_DB_PASSWORD
SELECT format('CREATE ROLE nuqta_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD %L', :'migrator_password') \gexec
SELECT format('CREATE ROLE nuqta_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD %L', :'runtime_password') \gexec
SELECT format('CREATE ROLE nuqta_auth LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD %L', :'auth_password') \gexec
SELECT format('CREATE ROLE nuqta_worker LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOREPLICATION PASSWORD %L', :'worker_password') \gexec
CREATE DATABASE nuqta OWNER nuqta_migrator;
REVOKE ALL ON DATABASE nuqta FROM PUBLIC;
GRANT CONNECT ON DATABASE nuqta TO nuqta_migrator,nuqta_runtime,nuqta_auth,nuqta_worker;
\connect nuqta
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT ALL ON SCHEMA public TO nuqta_migrator;
SQL
