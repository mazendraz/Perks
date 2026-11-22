import http2 from 'node:http2';
import forge from 'node-forge';
import type pg from 'pg';
import type { ServiceConfig } from '../../api/src/config.js';
import { loadAppleSigner, type AppleWalletSigner } from '../../api/src/wallet/apple-pass.js';
import { operationalLog } from '../../../packages/domain/src/operational-log.js';

/** The APNs HTTP status, or 0 when APNs could not be reached in time. Never throws. */
type Push = (token: string) => Promise<number>;
let cached: { signer: AppleWalletSigner; push: Push } | null | undefined;
let lastRun = 0;

// One request never holds the worker longer than this, whatever the connection does.
let deadlineMs = 10000;

/**
 * Worth trying again later: everything but success and 410 (the pass is gone from that phone).
 * Unreachable, 429 and 5xx pass with time; a 400 or 403 is usually our configuration (priority,
 * topic, certificate), which a fix and a restart cure. Retries are bounded by their callers.
 */
export const apnsRetryable = (status: number) => status !== 200 && status !== 410;

function apnsClient(c: ServiceConfig, signer: AppleWalletSigner): Push {
  const cert = forge.pki.certificateToPem(signer.certificate),
    key = forge.pki.privateKeyToPem(signer.key as forge.pki.rsa.PrivateKey);
  let session: http2.ClientHttp2Session | null = null;
  const connect = () => {
    if (session && !session.closed && !session.destroyed) return session;
    const next = http2.connect(c.APPLE_APNS_ORIGIN, { cert, key });
    next.on('error', () => next.destroy());
    next.setTimeout(60000, () => next.close());
    session = next;
    return next;
  };
  // Wallet pushes carry an empty payload; the device then asks the web service what changed.
  return (token) =>
    new Promise<number>((resolve) => {
      let status = 0,
        body = '',
        done = false,
        req: http2.ClientHttp2Stream | null = null;
      const finish = (value: number) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        if (req && !req.destroyed) req.destroy();
        if (value !== 200) {
          // APNs explains every refusal in a small JSON body ({"reason":"BadDeviceToken"}).
          let reason: string | undefined;
          try {
            reason = (JSON.parse(body) as { reason?: string }).reason;
          } catch {
            reason = undefined;
          }
          if (value === 0) operationalLog('worker', 'error', 'wallet.apns_unreachable');
          else
            operationalLog('worker', 'error', 'wallet.apns_rejected', {
              status: value,
              ...(reason ? { reason } : {}),
            });
        }
        resolve(value);
      };
      // A hard deadline that does not depend on stream events: an unanswered or half-closed
      // stream must not hang the worker loop.
      const timer = setTimeout(() => finish(0), deadlineMs);
      try {
        req = connect().request({
          ':method': 'POST',
          ':path': '/3/device/' + token,
          'apns-topic': signer.passTypeIdentifier,
          'apns-push-type': c.APPLE_APNS_PUSH_TYPE,
          'apns-priority': c.APPLE_APNS_PRIORITY,
          'content-type': 'application/json',
        });
      } catch {
        finish(0);
        return;
      }
      req.on('response', (headers) => {
        status = Number(headers[':status']) || 0;
      });
      // The body must be read: an HTTP/2 client stream with unread data never ends or closes.
      req.setEncoding('utf8');
      req.on('data', (chunk: string) => {
        if (body.length < 2048) body += chunk;
      });
      req.on('end', () => finish(status));
      req.on('close', () => finish(status));
      req.on('error', () => finish(0));
      req.end('{}');
    });
}

export function appleWalletPush(c: ServiceConfig): Push | null {
  if (c.APPLE_WALLET_ENABLED !== 'true') return null;
  if (cached === undefined) {
    const signer = loadAppleSigner(c);
    cached = signer ? { signer, push: apnsClient(c, signer) } : null;
  }
  return cached?.push ?? null;
}

/** For tests that point the client at a local server: forget the cached connection. */
export function resetAppleWalletPush(deadline = 10000) {
  cached = undefined;
  deadlineMs = deadline;
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
    const configured = appleWalletPush(c);
    if (!configured) return 0;
    push = configured;
  }
  const changes = (
    await pool.query<{ serial: string; push_tokens: string[]; active: boolean }>(
      'SELECT serial,push_tokens,active FROM wallet_claim_changes()',
    )
  ).rows;
  let sent = 0;
  for (const change of changes) {
    let retry = false;
    for (const token of change.push_tokens) {
      const status = await push(token).catch(() => 0);
      if (status === 200) sent++;
      // Only 410 establishes that the token is inactive. A 400 can reject the request itself.
      else if (status === 410) await pool.query('SELECT wallet_forget_push_token($1)', [token]);
      else if (apnsRetryable(status)) retry = true;
    }
    // A closed card is released only once its final (voided) update went out.
    if (!change.active && !retry)
      await pool.query('SELECT wallet_release_inactive($1)', [change.serial]);
    const attempt = (
      await pool.query<{ n: number }>('SELECT wallet_push_result($1,$2) AS n', [
        change.serial,
        retry,
      ])
    ).rows[0]!.n;
    if (attempt)
      operationalLog('worker', 'info', 'wallet.push_retry_scheduled', { count: attempt });
  }
  return sent;
}
