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

The pass certificate expires on 2027-12-10. Renew it from the same Pass Type ID before that date.
