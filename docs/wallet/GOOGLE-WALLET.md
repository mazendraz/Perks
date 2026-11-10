# Google Wallet (L10, Google part)

Same card as the Apple pass: stamps (`3/8`), reward, how many stamps are left, a link back to the web
card. No barcode and no customer name (see APPLE-WALLET.md for why).

## How it works

- **Add:** `GET /api/v1/me/memberships/:id/wallet/google` (card owner only) redirects to
  `https://pay.google.com/gp/v/save/<JWT>`. The JWT is signed with the service-account key and carries
  the merchant's loyalty class and the card's loyalty object, so Google creates both on save.
- **IDs:** class `ISSUER.perks-merchant-<merchantId>`, object `ISSUER.perks-card-<random key>`.
- **Stamp strip:** Google downloads it from
  `/api/v1/public/wallet/google/strips/<key>/<version>.png`. The version changes whenever the stamps
  change, so Google fetches the new picture.
- **Updates:** the worker checks every 2 seconds for cards whose content changed and `PATCH`es the
  object with `notifyPreference: notifyOnUpdate`, so the phone gets a notification when the stamp
  count changes. Google allows at most 3 notifications per pass per day; past that the update is
  sent silently. A 404 means the customer never saved the card. A network error or 5xx is retried.
- **Images and links need a public HTTPS origin:** Google fetches the logo and the strip itself.

## Turning it on

1. Google Pay & Wallet Console: business "Perks", Google Wallet API enabled. Copy the **Issuer ID**.
2. Google Cloud: enable "Google Wallet API", create a service account and a JSON key, and save it as
   `.local/wallet/google-service-account.json`. Never commit it.
3. Wallet Console → Users: invite the service account's email with Developer access.
4. Set `GOOGLE_WALLET_ENABLED=true`, `GOOGLE_WALLET_ISSUER_ID` and
   `GOOGLE_WALLET_SERVICE_ACCOUNT_FILE`.
5. Until Google approves publishing access, only the test accounts added in the console can save the
   card ("demo mode").
