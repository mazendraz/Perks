# Backup and recovery — L05

**L09 addition:** Before reopening an older restored backup, reapply current customer deletions and purge revoked exports using [RETENTION](RETENTION.md). Keep the restore offline. The signed deletion manifest needs an independent encrypted copy; delivery/scheduling of that copy is not yet configured. Earlier PITR evidence does not certify this additional host procedure.

الاختبارات المحلية نجحت على Linux:full وdiff وPITR،ورجوع اللوجو بنفس البايتات منrestic مشفر. ده مش اعتماد لسيرفر إنتاجي أو نسخة برّه الجهاز. السيرفر ومكان النسخة الخارجية لسه BLOCKED_OWNER،وDocker Desktop المحلي متعطل.

## Components

- PostgreSQL 17 loads `postgres/postgresql.conf`: replica WAL, archive mode, a 300-second archive timeout, synchronous commits/fsync/full-page writes, a 4 GB host starting memory budget, and slow statements above 500 ms. Bound parameters and error details are suppressed; the role bootstrap also disables statement logging in its own session so password literals cannot reach slow-query logs.
- The custom `postgres:17-trixie` image adds pgBackRest, restic and Python. Its Docker runtime has not been exercised on this machine. Native Linux testing used PostgreSQL 17.11, pgBackRest 2.60.0 and restic 0.18.1; exact versions are recorded in `backup-native.json`.
- `database_backup` shares the PostgreSQL Unix socket and a read-only view of PGDATA. It uses the privileged backup identity, not runtime/auth credentials. It creates the stanza, takes an initial full, then a full at least every seven days and a differential at least daily. It verifies WAL archiving every five minutes, including quiet periods. Repository errors fail health checks; an empty, valid stanza is the only special first-backup state.
- The repository uses AES-256-CBC through `PGBACKREST_REPO1_CIPHER_PASS`. Retention is two full backups and seven differentials, with dependent WAL retained by pgBackRest. Do not delete archive files by hand.
- `files_backup` uses UID 1000 to read the FileStore volume and restic to create a daily encrypted snapshot. It retries failures after 15 minutes. Existing repositories are never reinitialized with another key. No automatic restic pruning is enabled pending an approved backup-retention policy.
- Status files contain timestamps and health only. They expose no rows or credentials. Missing/stale evidence, database backups older than 26 hours, or WAL older than 30 minutes are unhealthy. Alert delivery is part of L07 and still requires a real channel.

The database/file repositories currently use **local named volumes on the same host**. This protects against some logical failures, not loss of that host. An independently encrypted off-host repository and a restore from it are mandatory before launch. The owner must choose its location and access method. Do not silently substitute an unmounted local directory for a remote disk.

## Secrets and configuration

`init-secrets.sh` now generates eight independent values, including the pgBackRest and restic keys. `env:check -- --production` validates all eight without printing them. For an existing environment file, add the two new backup keys privately; never rerun the generator over an existing file or rotate a repository key without a migration plan.

Keep AUTH_PEPPER and the matching DB/environment secrets in a separate encrypted operator backup, and retain backup-decryption keys independently (for example, the owner's private password manager/offline recovery copy). A key stored only inside the backup it decrypts cannot recover that backup. No external secrets destination has been configured. Losing AUTH_PEPPER prevents password verification and MFA-secret decryption even if the database restores successfully.

Do not paste `.env.production`, `docker compose config` output, private dumps or backup logs into chat/tickets. Use `config --quiet`. File backups cover STORAGE_ROOT; they do not automatically include the deployment environment file. Database RPO target is at most 15 minutes; the planned file-backup interval is 24 hours. Cross-resource recovery must use a compatible database/files checkpoint, especially after a new logo upload.

## Local reproducible drill

Prerequisites: the dedicated development DB `nuqta_local` on 127.0.0.1:55432 and PostgreSQL 17 client tools. Linux needs PostgreSQL 17 binaries, pgBackRest, restic, Python 3 and OpenSSL; Windows invokes WSL Ubuntu as an unprivileged user. The test refuses other database names/environments. Install packages from [PostgreSQL's signed Ubuntu repository](https://www.postgresql.org/download/linux/ubuntu/); do not create a default cluster/listener for the drill.

Run `npm run test:backup`:

1. A private logical snapshot of synthetic development data goes to ignored `.local/backup-drill-*`. The actual Mazen demo database is excluded.
2. A private `/tmp/nuqta-backup-test.*` cluster listens only on its own Unix socket, loads the production configuration and clones that snapshot. No API, worker or provider delivery runs.
3. Production role SQL is exercised with forced statement logging; all four restricted role attributes and absence of their generated passwords from logs are checked. Every SQL migration is also applied as the restricted schema owner in a second empty database. This checks SQL compatibility; it does not replace the unverified container migration-driver gate.
4. The real scheduler creates the first encrypted full backup. A deliberately guarded, atomic test purchase changes the actual transaction, ledger and account tables in this clone. A differential captures the changed state.
5. Full and differential restores use fresh isolated directories. PITR uses the earlier full and the server timestamp recorded before that test purchase. Migration checksums, core counts, SHA-256 digests of transactions/ledger/accounts and zero projection drift must match the expected checkpoint. Wrong decryption keys must fail an actual restore, rather than relying on `info` exit status alone.
6. A real PNG is backed up with restic, the fixture original is removed, and its restored SHA-256 must match. Wrong keys and attempted reinitialization with a wrong key are rejected.
7. Owned successful fixtures are stopped and removed after checking their exact `/tmp` boundary. Failed fixtures/logs remain private for diagnosis; do not remove an unfamiliar directory. Reports include test limits and source hashes, not credentials or row data.

Generated evidence: `docs/execution/evidence/implementation/backup-native.json`. Restore timings describe this small local fixture, not production RTO. The production-host exercise, off-host repository and real notifications remain unverified.

## Controlled checkpoint and container drill

On the approved host, coordinate with other operators and quiesce application writes for an exact comparison checkpoint. Stop `api`, `worker` and `database_backup` using the same private environment/project configuration. Keep PostgreSQL running. Confirm no other writer/operator is changing application data.

Take a manual full backup:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.yml exec -T -u postgres postgres pgbackrest --stanza=nuqta --type=full backup
docker compose --env-file deploy/.env.production -f deploy/compose.yml exec -T -u postgres postgres pgbackrest --stanza=nuqta info
```

Record the explicit backup label. While writes remain stopped, save the comparison manifest:

```sh
umask 077
mkdir -p .local/checkpoint
docker compose --env-file deploy/.env.production -f deploy/compose.yml exec -T -u postgres -e PGOPTIONS='-c timezone=UTC' postgres psql --no-psqlrc -At -U postgres -d nuqta -v ON_ERROR_STOP=1 -f /opt/nuqta-backup/fingerprint.sql > .local/checkpoint/expected.json
```

The manifest contains counts/hashes only. The restore UID 999 needs read access to that bind mount; use a dedicated readable checkpoint directory and file without putting secrets there. Validate the manifest before restarting writers. A fingerprint taken after writers resume is not an expected snapshot for the earlier backup.

Run the manual `restore_drill` service explicitly, replacing BACKUP_LABEL with the recorded label and using an absolute checkpoint path:

```sh
docker compose --env-file deploy/.env.production -f deploy/compose.yml run --rm --no-deps -e NUQTA_RESTORE_SET=BACKUP_LABEL -v "$PWD/.local/checkpoint:/drill-input:ro" restore_drill
```

That service has `network_mode: none`, a read-only repository, and a fresh anonymous restore volume. It promotes only the isolated clone, compares it with the expected manifest and prints its result. It does not start an application/worker. `--rm` removes the disposable container/anonymous volume; it must never remove the source repository or live PGDATA. This container path is prepared but not runtime-verified here because Docker is unavailable.

For PITR, use an explicit backup that completed **before** the selected server timestamp and add `-e 'NUQTA_RESTORE_TARGET_TIME=YYYY-MM-DD HH:MM:SS.US+00'`. The expected manifest must describe that target. The native fixture automates this using a synthetic purchase; never run its guarded mutation on production. A per-merchant mistake uses the compensating ledger workflow, not whole-database PITR.

Real recovery affects all tenants after the target. Before restarting a recovered application, resolve the incident, restore compatible files/secrets, invalidate recovered sessions/pending recovery material as appropriate, and reconcile mail/delivery receipts from after the target. An older DB can otherwise revive revoked credentials or delivery intents; stable Message-IDs do not guarantee provider deduplication. Keep outbound processing paused during that review. Never automatically replay restored external jobs or overwrite the live source as part of a drill.

After the comparison, restart the original `api`, `worker` and `database_backup` and verify readiness/status. Retain the redacted result and duration. No operator walkthrough or production recovery is accepted until it runs on the chosen host.

References: [pgBackRest guide](https://pgbackrest.org/user-guide.html), [configuration](https://pgbackrest.org/configuration.html), [PostgreSQL WAL](https://www.postgresql.org/docs/17/runtime-config-wal.html), [logging](https://www.postgresql.org/docs/17/runtime-config-logging.html), [restic manual](https://restic.readthedocs.io/en/stable/manual_rest.html).
