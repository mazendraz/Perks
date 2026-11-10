import http2 from 'node:http2';
import forge from 'node-forge';
import type pg from 'pg';
import type { ServiceConfig } from '../../api/src/config.js';
import { loadAppleSigner, type AppleWalletSigner } from '../../api/src/wallet/apple-pass.js';

type Push = (token: string) => Promise<number>;
let cached: { signer: AppleWalletSigner; push: Push } | null | undefined;
let lastRun = 0;

function apnsClient(c: ServiceConfig, signer: AppleWalletSigner): Push {
  const cert = forge.pki.certificateToPem(signer.certificate),
    key = forge.pki.privateKeyToPem(signer.key as forge.pki.rsa.PrivateKey);
  let session: http2.ClientHttp2Session | null = null;
  const connect = () => {
    if (session && !session.closed && !session.destroyed) return session;
    session = http2.connect(c.APPLE_APNS_ORIGIN, { cert, key });
    session.on('error', () => session?.destroy());
    session.setTimeout(60000, () => session?.close());
    return session;
  };
  // Wallet pushes carry an empty payload; the device then asks the web service what changed.
  return (token) =>
    new Promise((resolve) => {
      const req = connect().request({
        ':method': 'POST',
        ':path': '/3/device/' + token,
        'apns-topic': signer.passTypeIdentifier,
        'apns-push-type': 'background',
        'content-type': 'application/json',
      });
      let status = 0;
      req.setTimeout(10000, () => req.close(http2.constants.NGHTTP2_CANCEL));
      req.on('response', (headers) => {
        status = Number(headers[':status']) || 0;
      });
      req.on('error', () => resolve(0));
      req.on('close', () => resolve(status));
      req.end('{}');
    });
}

// Runs inside the worker loop. Disabled unless Apple Wallet is configured.
export async function runAppleWalletPushes(
  pool: pg.Pool,
  c: ServiceConfig,
  push?: Push,
): Promise<number> {
  if (c.APPLE_WALLET_ENABLED !== 'true') return 0;
  if (!push && Date.now() - lastRun < 2000) return 0;
  lastRun = Date.now();
  if (!push) {
    if (cached === undefined) {
      const signer = loadAppleSigner(c);
      cached = signer ? { signer, push: apnsClient(c, signer) } : null;
    }
    if (!cached) return 0;
    push = cached.push;
  }
  const changes = (
    await pool.query<{ serial: string; push_tokens: string[]; active: boolean }>(
      'SELECT serial,push_tokens,active FROM wallet_claim_changes()',
    )
  ).rows;
  let sent = 0;
  for (const change of changes) {
    for (const token of change.push_tokens) {
      const status = await push(token);
      if (status === 200) sent++;
      // 410: the device removed the pass; 400 BadDeviceToken: never valid for this topic.
      else if (status === 410 || status === 400)
        await pool.query('SELECT wallet_forget_push_token($1)', [token]);
    }
    if (!change.active) await pool.query('SELECT wallet_release_inactive($1)', [change.serial]);
  }
  return sent;
}
