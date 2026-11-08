import { readFile, writeFile } from 'node:fs/promises';
import QRCode from 'qrcode';
import { readConfig } from '../apps/api/src/config.js';
const c = readConfig();
if (c.APP_ENV !== 'development' || c.AUTH_PROVIDER !== 'local')
  throw new Error('Local authenticator setup is development-only.');
const bootstrap = JSON.parse(await readFile('.local/admin-mfa.json', 'utf8')) as {
  adminEmail: string;
  totpSecretHex: string;
};
const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
let bits = 0,
  value = 0,
  secret = '';
for (const byte of Buffer.from(bootstrap.totpSecretHex, 'hex')) {
  value = (value << 8) | byte;
  bits += 8;
  while (bits >= 5) {
    secret += alphabet[(value >>> (bits - 5)) & 31];
    bits -= 5;
  }
}
if (bits) secret += alphabet[(value << (5 - bits)) & 31];
const uri =
  'otpauth://totp/' +
  encodeURIComponent('Nuqta Local:' + bootstrap.adminEmail) +
  '?secret=' +
  secret +
  '&issuer=Nuqta%20Local&algorithm=SHA1&digits=6&period=30';
await writeFile(
  '.local/admin-mfa-setup.png',
  await QRCode.toBuffer(uri, { margin: 4, width: 420 }),
  { mode: 0o600 },
);
console.log(
  'Private authenticator setup image created in .local/admin-mfa-setup.png. Open it locally and scan with your authenticator. Never publish this file.',
);
