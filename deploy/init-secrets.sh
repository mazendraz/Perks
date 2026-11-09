#!/bin/sh
set -eu
umask 077
cd "$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)"
if [ -e .env.production ]; then
  echo 'Existing production configuration retained; no passwords rotated.' >&2
  exit 1
fi
command -v openssl >/dev/null
set -C
cat > .env.production <<EOF
APP_ENV=production
DOMAIN=nuqta.invalid
PUBLIC_APP_ORIGIN=https://nuqta.invalid
AUTH_PEPPER=$(openssl rand -hex 32)
NUQTA_POSTGRES_DB_PASSWORD=$(openssl rand -hex 32)
NUQTA_MIGRATOR_DB_PASSWORD=$(openssl rand -hex 32)
NUQTA_RUNTIME_DB_PASSWORD=$(openssl rand -hex 32)
NUQTA_AUTH_DB_PASSWORD=$(openssl rand -hex 32)
NUQTA_WORKER_DB_PASSWORD=$(openssl rand -hex 32)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=
SMTP_SECURE=false
EOF
chmod 600 .env.production
echo 'Private configuration created. Set domain and SMTP before starting; values were not printed.'
