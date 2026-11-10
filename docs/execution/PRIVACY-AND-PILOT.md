# L09 — privacy and manual subscriptions

Local implementation passed all 15 verification steps on 2026-11-10, with an unchanged source fingerprint. Commercial acceptance remains owner-gated; this document is not legal approval.

## Consent and deletion

Public `/privacy` and `/terms` render Arabic/English drafts with a legal-review notice. Responsible entity, official contact, complaints process, final retention and legal copy remain **BLOCKED_OWNER**. Egyptian Law 151/2020 identifies the review required by the plan, not a compliance opinion.

Registration sends explicit locale-specific version/hash acceptance. Missing, modified or stale acceptance cannot create an identity. Exact accepted text, hash, version and locale are retained; retries do not overwrite receipts. Language changes reset the checkbox. A stale notice is refreshed and requires a new check while preserving the customer's input.

Customer deletion requires an authenticated device, Origin/CSRF, idempotency and explicit confirmation. It removes name/contact/auth data; suspends memberships; revokes devices, sessions, recovery and QR; disables marketing; cancels pending requests and revokes affected shop exports. Ledger, transaction amounts, balances, rewards and program/terms snapshots remain for reconciliation. Re-registering the same phone creates a fresh identity/card. Any staff membership protects the work identity and requires reviewed separation.

Device mutations take a customer lifecycle lock and recheck access after waiting. Request/account lock ordering avoids deletion races. If the response is lost, the UI verifies server proof for that revoked device before reporting success; visiting a URL alone proves nothing.

## Subscription behavior

Platform administrators record received payments, inclusive periods in the shop timezone, method/reference and reason. Money uses integer piastres. Corrections append a void and a replacement payment; originals are immutable. Active duplicate references for the same method are rejected. Owner history is read-only and tenant-scoped.

Commercially provisioned shops require paid coverage. Expiry or manual pause stops new stamps/requests, including a purchase waiting on an account lock until after expiry. Card viewing and valid earned-reward redemption continue; completed redemption starts the next cycle. Future paid periods do not fill unpaid gaps. Unmanaged local test mode is not commercial readiness.

Uncertain payment responses retain the original payload/revision/operation key through reload, scoped to administrator and merchant. Retry resolves that operation. No charge, gateway or tax invoice is created. Prices 450/950/1900 remain unapproved demo values.

## Verification and remaining gates

Integration coverage includes exact consent, roles/tenant isolation, deletion races with unchanged financial snapshots, revoked access/physical CSV cleanup, bounded session retention, export defaults, immutable payments and expiry/redemption races. Browser tests exercise legal pages, stale consent, deletion and a lost payment response across reload, including Arabic mobile date fields.

The first full L09 run failed the production-built mobile CSP check. Added sanitized diagnostics identified an `eval` feature probe from Zod in the owner page. The web entry now configures Zod `jitless` before shared-schema modules initialize. CSP remains unchanged, and the mobile test still requires zero violations/page errors and separately proves an unapproved inline script is blocked. The fresh complete verification passed after this fix; no CSP violations or page errors were ignored.

Manifest tests cover tampering, wrong keys/deployment, offline attestation and idempotent reapplication after simulated resurrected credentials. See [RETENTION](../../deploy/RETENTION.md) for the actual offline restore procedure and the independent-copy gap. This simulation is not a new physical backup restore drill.

Final generated evidence is [checks.json](evidence/implementation/checks.json). Host log retention is configuration-tested only. Physical devices/NFC, staging/TLS, real support/notification channels, approved legal text/prices and the named `needs_review` reviewer remain outstanding. [PILOT-RUNBOOK](PILOT-RUNBOOK.md) is ready for owner review. L10 waits for a real Pilot or explicit owner override.
