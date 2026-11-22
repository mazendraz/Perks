// npm run wallet:check — confirms the Apple and Google Wallet setup without printing secrets,
// then reports delivery health from the database (counts only, read-only).
import pg from 'pg';
import { readConfig } from '../apps/api/src/config.js';
import { loadAppleSigner } from '../apps/api/src/wallet/apple-pass.js';
import { accessToken, loadGoogleWallet } from '../apps/api/src/wallet/google-wallet.js';

const c = readConfig();
let failed = false;
const report = (ok: boolean, line: string) => {
  if (!ok) failed = true;
  console.log((ok ? 'OK   ' : 'FAIL ') + line);
};
try {
  const apple = loadAppleSigner(c);
  if (!apple) console.log('--   Apple Wallet is off (APPLE_WALLET_ENABLED=false)');
  else {
    const expires = apple.certificate.validity.notAfter;
    report(true, 'Apple pass certificate matches the key: ' + apple.passTypeIdentifier);
    console.log(
      '--   APNs: ' +
        c.APPLE_APNS_ORIGIN +
        ', push type ' +
        c.APPLE_APNS_PUSH_TYPE +
        ', priority ' +
        c.APPLE_APNS_PRIORITY,
    );
    report(
      expires > new Date(),
      'Apple certificate valid until ' + expires.toISOString().slice(0, 10),
    );
  }
} catch (e) {
  report(false, 'Apple Wallet: ' + (e instanceof Error ? e.message : 'could not load'));
}
try {
  const google = loadGoogleWallet(c);
  if (!google) console.log('--   Google Wallet is off (GOOGLE_WALLET_ENABLED=false)');
  else {
    await accessToken(google);
    report(true, 'Google service account signs in: ' + google.clientEmail);
    const r = await fetch(
      'https://walletobjects.googleapis.com/walletobjects/v1/loyaltyClass?issuerId=' +
        google.issuerId,
      { headers: { authorization: 'Bearer ' + (await accessToken(google)) } },
    );
    report(
      r.ok,
      r.ok
        ? 'Google Wallet issuer ' + google.issuerId + ' is reachable'
        : 'Google Wallet issuer ' +
            google.issuerId +
            ' answered ' +
            r.status +
            ' (is the service account invited as Developer in the Wallet Console?)',
    );
  }
} catch (e) {
  report(false, 'Google Wallet: ' + (e instanceof Error ? e.message : 'could not sign in'));
}
if (!c.PUBLIC_APP_ORIGIN.startsWith('https://'))
  console.log(
    'Note: PUBLIC_APP_ORIGIN is not HTTPS, so wallet cards will not update here. Use npm run dev:tunnel.',
  );
// A quick tunnel gets a new address every time it starts. Each pass keeps the address it was added
// with, so after a restart the phone still gets the push but cannot fetch the update.
if (/\.trycloudflare\.com$/i.test(new URL(c.PUBLIC_APP_ORIGIN).hostname))
  console.log(
    'Warning: PUBLIC_APP_ORIGIN is a quick tunnel. Passes added before the tunnel last restarted ' +
      'no longer update: remove and re-add them, or test on a fixed domain.',
  );

const n = (value: unknown) => Number(value ?? 0);
if (c.DATABASE_MIGRATOR_URL) {
  const db = new pg.Client({
    connectionString: c.DATABASE_MIGRATOR_URL,
    connectionTimeoutMillis: 5000,
  });
  try {
    await db.connect();
    await db.query('BEGIN READ ONLY');
    const apple = (
      await db.query(`SELECT count(*) AS passes,
        count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM wallet_registrations r WHERE r.serial=w.serial)) AS unregistered,
        count(*) FILTER(WHERE w.push_retry_at>now()) AS retrying
        FROM wallet_passes w`)
    ).rows[0];
    console.log(
      '--   Apple passes: ' +
        n(apple.passes) +
        ', with no device registered: ' +
        n(apple.unregistered) +
        ', waiting for a push retry: ' +
        n(apple.retrying),
    );
    if (n(apple.unregistered))
      console.log(
        '     A pass with no registration gets no updates until the customer removes and re-adds it.',
      );
    const sent = (
      await db.query(`SELECT channel,count(*) FILTER(WHERE status='accepted') AS accepted,
        count(*) FILTER(WHERE status='accepted' AND fetched_at IS NOT NULL) AS on_phone,
        count(*) FILTER(WHERE status IN ('failed','skipped')) AS missed,
        count(*) FILTER(WHERE status IN ('queued','processing','uncertain')) AS waiting
        FROM wallet_message_deliveries WHERE created_at>now()-interval '7 days' GROUP BY channel ORDER BY channel`)
    ).rows;
    for (const r of sent)
      console.log(
        '--   Shop messages, last 7 days, ' +
          r.channel +
          ': accepted ' +
          n(r.accepted) +
          (r.channel === 'apple' ? ', downloaded by the phone ' + n(r.on_phone) : '') +
          ', waiting ' +
          n(r.waiting) +
          ', missed ' +
          n(r.missed),
      );
    if (!sent.length) console.log('--   No shop messages in the last 7 days.');
    await db.query('ROLLBACK');
  } catch (e) {
    report(false, 'Delivery health: ' + (e instanceof Error ? e.message : 'database unavailable'));
  } finally {
    await db.end().catch(() => undefined);
  }
}
process.exitCode = failed ? 1 : 0;
