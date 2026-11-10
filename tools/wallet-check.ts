// npm run wallet:check — confirms the Apple and Google Wallet setup without printing secrets.
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
process.exitCode = failed ? 1 : 0;
