# Apple Wallet (L10, Apple part)

Perks can add a customer's card to Apple Wallet. The pass shows the stamps (`3/8`), the reward and how
many stamps are left, and updates itself after every stamp with a lock-screen notification.

## Security decision (v1)

- The pass carries **no barcode**. Stamping still uses the short-lived, device-bound QR on the web card
  (D12). The back of the pass links to the web card.
- iOS gives every pass the same tall shape, so the card face is the top part (logo, stamp strip,
  reward) and the area where a barcode would sit stays in the card colour.
- The stamp strip draws the same ink stamps, dashed empty slots and edition artwork as the web card
  (`apps/api/src/wallet/pass-artwork.ts`, colours from `packages/domain/src/wallet-theme.ts`).
- The pass carries no customer name or phone, only the business, stamps and reward.
- `sharingProhibited` is set. A closed or deleted card is pushed one last time as `voided` and its
  device registrations are deleted.
- Each pass has its own token (`HMAC(AUTH_PEPPER, serial)`). The database stores only its SHA-256,
  and the runtime role reaches the wallet tables only through `SECURITY DEFINER` functions.

## Pieces

| Piece | Where |
| --- | --- |
| Tables + functions | `db/migrations/013_apple_wallet.sql` |
| Pass builder (strip art, strings ar/en, manifest, PKCS#7 signature, zip) | `apps/api/src/wallet/apple-pass.ts` |
| Customer download `GET /api/v1/me/memberships/:id/wallet/apple` and Apple web service `/api/v1/wallet/apple/v1/...` | `apps/api/src/modules/wallet.ts` |
| APNs push (HTTP/2, pass certificate, empty payload) | `apps/worker/src/apple-wallet-push.ts` |
| iPhone button | `apps/web/src/features/WalletPanel.tsx` |
| Tests | `tests/integration/apple-wallet.test.ts` |

## Turning it on

1. `.local/wallet/` holds `pass.key` (never leaves the machine), `pass.cer` and `AppleWWDRCAG4.cer`
   (both DER as Apple ships them; PEM also works).
2. Set the `APPLE_*` values from `.env.example` and `APPLE_WALLET_ENABLED=true`.
3. `PUBLIC_APP_ORIGIN` must be HTTPS. Apple only talks to HTTPS web services.
4. The worker must be running; it checks for changed cards every 2 seconds and pushes.
5. `npm run wallet:check` confirms the certificates and the APNs settings, and reports delivery health:
   passes with no registered device, passes waiting for a push retry, and shop messages accepted by
   APNs against messages actually downloaded by the phone.

The pass certificate expires on 2027-12-10. Renew it from the same Pass Type ID before that date.

## Notifications: how a message reaches the lock screen

1. The worker puts the message in the pass (`reminder` back field), bumps the pass and sends APNs an
   empty push. APNs answering 200 only means Apple took the request.
2. The phone asks `/devices/.../registrations/...` what changed, then downloads the pass. That
   download is recorded (`wallet_message_deliveries.fetched_at`), and it is what the owner sees as
   "reached". Accepted but not downloaded shows as "not on their phone yet".
3. Wallet shows a banner only when a field with `changeMessage` **changes value** and the field
   **already existed** on the phone's copy of the pass. Consequences:
   - Both layouts carry the back fields. iOS 27 shows `posterGeneric`, and before 054 that layout had
     no message field, so iOS 27 phones never showed shop messages or reminders.
   - The message value is a hash of the words. Repeated words (a later reminder of a series, or a shop
     message the card already got) carry a marker so the value still changes.
   - A field that first appears is silent. A deploy that changes the pass layout re-sends every saved
     pass once (design signature), which adds the empty field before the next message.
   - The customer can turn notifications off per pass (pass details → Allow Notifications).

## When notifications do not arrive

- **Worker logs:** `wallet.apns_rejected` carries the status and Apple's reason (`BadDeviceToken`,
  `TopicDisallowed`, `BadPriority`...). `wallet.apns_unreachable` means no answer within 10 seconds.
  A refused or unanswered stamp update is pushed again with backoff (15s doubling, up to 30 min, 8
  times). Only 410 removes a device registration.
- **API logs:** `wallet.apple_log` holds the phone's own error lines (identifiers blanked), e.g. a pass
  that failed to download or validate.
- **Push type and priority:** `APPLE_APNS_PUSH_TYPE` / `APPLE_APNS_PRIORITY`, `background`/`5` by
  default; `alert`/`10` is the other allowed pair. Priority 5 lets iOS delay a push to save power. To
  compare, send the same message to one test iPhone with each setting (restart the worker after
  changing them) and note the delay before the banner.
- **Quick tunnels:** each pass keeps the web service address it was added with. A `trycloudflare.com`
  address changes on every tunnel restart, so passes added before the restart get the push but can
  never fetch the update. Re-add the pass, or test on a fixed domain.
- **A stuck worker** exits on its own after 15 minutes without progress, so Docker restarts it.
