# Retention and privacy recovery

Database/file cleanup is implemented locally. Host log retention remains **CONFIG_VERIFIED_RUNTIME_NOT_RUN**: no host policy, logging driver or live timer has been changed.

## Implemented cleanup

| Data | Policy |
|---|---|
| CSV exports | New exports expire after 24 hours; previously shorter expiries are not extended. Downloads still require authorization and a valid expiry. |
| Export files | Bounded worker batches remove expired files under locks, protecting active publication leases. Ordinary unpublished orphans have a two-hour grace. Privacy-revoked files are eligible immediately once safe lease/lock cleanup allows. |
| Sessions | Each minute, worker deletes up to 500 sessions expired over 90 days ago. Live/recent sessions remain. Expired proof references detach; financial records remain unchanged. |
| Customer identity | Deletion removes contact/auth data, revokes access/recovery/QR, cancels pending requests and revokes affected shop CSVs. Ledger and transaction amounts remain. |
| Backups | Existing encrypted backup policy applies. Retention approval, an independent destination and a current deletion manifest are required before Pilot. Deletion does not rewrite historical archives. |

Cleanup is eventual: live leases, backlog or an unavailable worker can delay removal. Monitor worker health and investigate delays.

## Thirty-day logs: dedicated Linux host only

Base Compose retains `json-file` size rotation (20 MB × five files), which does not enforce age. Optional `compose.retention.yml` replaces logging for all nine services with `journald`, retaining safe JSON messages and service/container tags without secrets.

The `log-retention/` host policy uses persistent journals, a 100 MB budget, 20 MB files and five archived files, with a 30-day age policy and daily file rotation. An hourly timer rotates and vacuums journals. Scheduling delay, downtime and active files mean periodic cleanup, not a strict per-record deadline. Size/disk limits may remove records earlier; 30 days is not a minimum history guarantee.

**The policy affects the whole host.** Review it on the approved dedicated Nuqta server; do not blindly apply it on a shared machine. No server has been chosen.

Stage review files without changing the host:

```sh
mkdir -m 700 /tmp/nuqta-retention-review
sh deploy/log-retention/install.sh --stage /tmp/nuqta-retention-review
```

The installer refuses existing targets. Without arguments it only prints guidance. After approval and review of existing host policy, a privileged operator can run:

```sh
sudo sh deploy/log-retention/install.sh --apply-on-server
systemctl status nuqta-log-retention.timer
systemctl list-timers nuqta-log-retention.timer
journalctl --disk-usage
```

Include `-f deploy/compose.retention.yml` after the existing base/staging overlays, preserving the deployment project name and private env file. Verify the merged configuration. Existing containers require planned recreation to change drivers. Confirm every container uses `journald`, inspect JSON logs and observe an actual scheduled cleanup before accepting this host gate. None of these host actions were performed here.

Do not manipulate Docker's private JSON files. Primary references: [json-file driver](https://docs.docker.com/engine/logging/drivers/json-file/), [journald driver](https://docs.docker.com/engine/logging/drivers/journald/).

`npm run test:log-retention` checks merged configuration, staged installer/no-overwrite behavior and real `systemd-analyze` syntax. It does not prove expiry of 30-day-old host logs.

## Reapply deletion after restoring an older backup

`privacy:manifest` exports deleted customer UUIDs/timestamps and deployment identity, signed with a domain-separated HMAC using the deployment's private `AUTH_PEPPER`. No names/phones are included, but it remains sensitive. Keep it private, encrypted and outside Git; retain the signing key through the separate secret recovery plan.

With the correct deployment environment loaded:

```sh
npm run privacy:manifest -- export /private/nuqta/deletions-UNIQUE-TIMESTAMP.json
```

Use a new filename. Keep a recent independent encrypted copy with backups. **Independent delivery/scheduling is not configured.** Before a planned restore capture the latest manifest before discarding the current DB. For disaster recovery assess the newest trusted independent copy's deletion gap: the tool cannot reconstruct requests lost with the server.

1. Keep restored API, worker, gateway and customer traffic offline. Restore DB/files following [BACKUP-README](BACKUP-README.md), retaining deployment identity. Backups predating 012e need separately reviewed reconciliation; do not replace an identity to bypass validation.
2. Load matching migrator credentials and signing key, apply migrations, then run:

   ```sh
   npm run privacy:manifest -- apply /private/nuqta/deletions-LATEST.json --offline-confirmed
   ```

3. Review counts. Wrong key, deployment, invalid clocks or protected staff identities fail the operation. Missing UUID means the customer did not exist in that snapshot. Reapplication is idempotent.
4. Keep traffic blocked while controlled worker cleanup removes privacy-revoked exports. Never expose restored files directly. Verify readiness, revoked-device rejection, balance reconciliation and file/backup health before reopening.
5. Record restore point, manifest timestamp, counts and any deletion gap without public customer identifiers.

`--offline-confirmed` is an operator attestation, not network isolation enforcement. Integration tests simulate resurrected personal/auth fields in an isolated DB and prove reapplication with unchanged Ledger; this is not a new end-to-end `pg_restore` drill. Existing restore/PITR evidence covers its own earlier scope. The full host restore plus current manifest remains an actual deployment acceptance task.
