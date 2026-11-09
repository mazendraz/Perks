# Nuqta deployment — L04

ملفات تجهيز محلية فقط. السيرفر والدومين وSMTP لسه غير مختارين؛ الإطلاق محتاج قبول L05–L09 كمان. الشرح التالي للمشغّل التقني، ولا يشغّل إعدادات السيرفر على جهاز التطوير.

Target: a dedicated Ubuntu 24.04 LTS host, at least 2 vCPU, 4 GB RAM and 80 GB SSD. Install Docker Engine and Compose using the [official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).

## First installation

1. Create an operator account with SSH key access. Test a second key-only SSH session before changing SSH configuration.
2. On the dedicated host only, run `sudo env NUQTA_HARDEN_CONFIRMED=key-login-tested sh deploy/harden-host.sh`. Review `sshd -T`, `sudo ufw status verbose` and fail2ban. The script installs security updates and restricts ingress to SSH 22, HTTP 80 and HTTPS 443. Docker published ports bypass ufw: publish only Caddy. Never publish PostgreSQL or the API.
3. Copy an approved checkout without `.env` or `.local`. Run `sh deploy/init-secrets.sh` once. It creates private `deploy/.env.production` (0600), excluded from Git. It refuses to overwrite an existing file. This is not a password rotation tool for an existing volume.
4. Edit that file privately: choose DOMAIN, its matching HTTPS PUBLIC_APP_ORIGIN and approved SMTP settings. Set A/AAAA records to the server. Configure email DNS separately. Do not paste the file into chat, logs or tickets. `docker compose config` prints credentials; use `config --quiet`.
5. On a trusted machine with dependencies installed, run `npm run env:check -- --production deploy/.env.production`. This validates domain/origin, distinct generated secrets and SMTP/TLS without connecting externally or printing values. The `.invalid` placeholder is rejected.
6. Validate: `docker compose --env-file deploy/.env.production -f deploy/compose.yml config --quiet`.
7. Build: `docker compose --env-file deploy/.env.production -f deploy/compose.yml build --pull`.
8. Start: `docker compose --env-file deploy/.env.production -f deploy/compose.yml up -d`.
9. Inspect: `docker compose --env-file deploy/.env.production -f deploy/compose.yml ps --all`. Migrate must exit 0; other services must be healthy. Test `curl --fail https://YOUR_DOMAIN/health/ready`, `curl -I https://YOUR_DOMAIN/login`, and an actual hashed asset URL. Keep certificate verification enabled.

The PostgreSQL bootstrap runs only on a new volume. It creates four restricted roles, with no memberships between them. Migrator owns the schema; runtime/auth/worker are neither owners nor superusers and cannot bypass RLS or create roles/databases. API receives only runtime/auth DB credentials, Worker only worker credentials, and the one-shot migrator only its migration URL. Application containers do not receive the bootstrap PostgreSQL password. The API readiness check verifies both runtime and auth roles and the schema marker.

There is no production seed or automatic demo account. The first platform account needs a separate private operator bootstrap after operational acceptance; do not copy development credentials or AUTH_PEPPER into production.

API and Worker use the same non-root image, UID 1000, a read-only root filesystem, bounded temporary storage and dropped capabilities. Their shared FileStore volume is outside `/app`. Back up the database, files and AUTH_PEPPER according to L05. Losing the pepper prevents password verification and MFA-secret decryption.

Caddy serves static files from an image built from the same checkout. It obtains public HTTPS certificates only after real DNS is configured. Static documents use no-cache; hashed assets are immutable for one year. Caddy replaces forwarded client IPs and streams responses without buffering. Only Caddy's fixed address `172.30.40.2/32` is trusted by Fastify. Check subnet `172.30.40.0/28` for collisions before use; if changed, update both fixed addresses and TRUSTED_PROXIES together. Never set global proxy trust.

## Update and rollback

- Record the current commit and image digests. Take and verify a backup under L05 before migrations.
- Fetch the approved checkout and run CI/verification on that commit. Build app/web images with explicit release tags through NUQTA_IMAGE and NUQTA_WEB_IMAGE in the private environment file. Do not rely on mutable `local` tags for rollback.
- Stop old writers: `docker compose --env-file deploy/.env.production -f deploy/compose.yml stop api worker caddy`.
- Apply migrations: `docker compose --env-file deploy/.env.production -f deploy/compose.yml run --rm migrate`. Do not resume after a failure. Each migration has a hash and transaction, protected by a migration lock. Never rewrite an applied migration or reinitialize a database.
- Start the new release: `docker compose --env-file deploy/.env.production -f deploy/compose.yml up -d --force-recreate`. Check readiness and approved synthetic login/card/stamp/redemption flows.
- For rollback, restore previous app/web image tags only when the new schema is backward compatible, then recreate and verify. An incompatible schema needs an isolated, verified restore and an explicit decision about newer data. No automatic down migration and no `down -v` on a real stack. Never restore a backup over current data without a recovery plan.

## Local acceptance and limits

- `npm run test:integration -- proxy.test.ts`: trusted proxy, spoofed forwarding, IP rate limits, CSRF origin protection, unsafe DB owner and swapped runtime/auth connections.
- `npm run test:deploy-scripts`: POSIX syntax and real secret generation in an owned `/tmp` fixture, 0600 permissions, independent values and overwrite refusal. Uses WSL Ubuntu on Windows; does not execute host hardening.
- `npm run test:deploy`: unique synthetic Compose project, private fixture secrets in `.local`, offline Compose validation, then image build/size/non-root checks and a fresh loopback stack if Docker responds. Tests HTTPS/HSTS/CSP/cache and readiness refusal for deliberately unsafe roles inside that disposable stack. Never uses `.env.production` or Mazen's database. Only this uniquely named test project's volumes may be removed. The loopback test uses Caddy's internal CA; its test-only certificate exception is never used for a public host or SMTP.

Reports are generated in `docs/execution/evidence/implementation/`. A blocked Docker engine is reported as blocked, not passed. On this Windows host the Desktop backend failed at its `dockerInference` socket before Linux engine startup; image/Compose-runtime checks remain unverified. See the related [Docker upstream issue](https://github.com/docker/desktop-feedback/issues/554). Do not factory-reset Docker or unregister WSL to run these tests.

Host hardening, DNS, public certificate, external DB-port isolation and an independent operator walkthrough remain BLOCKED_OWNER until a host is chosen. Local smoke success would not approve launch.

References: [Fastify trustProxy](https://fastify.dev/docs/latest/Reference/Server/#trustproxy), [Caddy reverse_proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy), [PostgreSQL role attributes](https://www.postgresql.org/docs/17/role-attributes.html).
