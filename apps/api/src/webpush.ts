// Web Push: RFC 8291 (aes128gcm message encryption) + RFC 8292 (VAPID), on node:crypto only.
// Ported from the Rehla Python reference (integrations/webpush); no new dependency.
//
// Only real browser push services are ever contacted. A subscription is a URL this server will POST
// to and the browser decides its content, so an endpoint outside the push services' hosts is refused
// before it is stored or used (`isPushEndpoint`), never fetched, and redirects are never followed.
import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  hkdfSync,
  randomBytes,
  sign,
  type ECDH,
} from 'node:crypto';

// One record is all a notification ever needs (push services cap payloads near 4 KB).
export const RECORD_SIZE = 4096;
// Larger payloads are refused outright by some push services.
export const MAX_PAYLOAD = 3800;
// Suffix-matched, so regional hosts such as wns2-par02p.notify.windows.com pass.
export const PUSH_HOSTS = [
  'fcm.googleapis.com', // Chrome, Edge and Samsung Internet on Android
  'android.googleapis.com', // older Chrome subscriptions
  'push.services.mozilla.com', // Firefox
  'push.apple.com', // Safari on iPhone, iPad and Mac
  'notify.windows.com', // Edge on Windows
];

export const b64url = (data: Uint8Array) => Buffer.from(data).toString('base64url');
export const b64urlDecode = (text: string) => Buffer.from((text || '').trim(), 'base64url');

export function isPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint || '');
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || !host || url.username || url.password) return false;
  if (url.port && url.port !== '443') return false;
  return PUSH_HOSTS.some((allowed) => host === allowed || host.endsWith('.' + allowed));
}

export interface VapidKeys {
  // Uncompressed P-256 point, base64url: exactly the browser's `applicationServerKey`.
  publicKey: string;
  // Raw 32-byte private scalar, base64url.
  privateKey: string;
}

function ecdhFrom(privateKey: string): ECDH {
  const ecdh = createECDH('prime256v1');
  ecdh.setPrivateKey(b64urlDecode(privateKey));
  return ecdh;
}

export function generateVapidKeys(): VapidKeys {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    publicKey: b64url(ecdh.getPublicKey()),
    privateKey: b64url(ecdh.getPrivateKey()),
  };
}

// The private half really is the public half's. Checked at boot so a mismatched pair fails loudly
// instead of as every push silently refused.
export function keysMatch(keys: VapidKeys): boolean {
  try {
    const raw = b64urlDecode(keys.privateKey);
    if (raw.length !== 32) return false;
    return b64url(ecdhFrom(keys.privateKey).getPublicKey()) === keys.publicKey;
  } catch {
    return false;
  }
}

// RFC 8292: `vapid t=<jwt>, k=<public key>` for one request to `endpoint`'s push service.
export function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  subject: string,
  now = Date.now() / 1000,
): string {
  const aud = new URL(endpoint).origin;
  const signingInput =
    b64url(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))) +
    '.' +
    // Twelve hours: a common ceiling, well inside the 24 the RFC allows.
    b64url(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now) + 12 * 3600, sub: subject })));
  const point = b64urlDecode(keys.publicKey);
  const key = createPrivateKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      d: keys.privateKey,
      x: b64url(point.subarray(1, 33)),
      y: b64url(point.subarray(33, 65)),
    },
    format: 'jwk',
  });
  // ieee-p1363 gives the raw r||s signature a JWT wants (not DER).
  const signature = sign('sha256', Buffer.from(signingInput), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${signingInput}.${b64url(signature)}, k=${keys.publicKey}`;
}

const hkdf = (salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number) =>
  Buffer.from(hkdfSync('sha256', ikm, salt, info, length));

// The aes128gcm body for one message. `senderPrivateKey` and `salt` are fresh per message; they are
// parameters only so the test can replay the RFC 8291 section 5 worked example byte for byte.
export function encrypt(
  plaintext: Uint8Array,
  p256dh: string,
  auth: string,
  options: { senderPrivateKey?: string; salt?: Uint8Array } = {},
): Buffer {
  const uaPublic = b64urlDecode(p256dh),
    authSecret = b64urlDecode(auth),
    sender = createECDH('prime256v1');
  if (options.senderPrivateKey) sender.setPrivateKey(b64urlDecode(options.senderPrivateKey));
  else sender.generateKeys();
  const asPublic = sender.getPublicKey(),
    salt = Buffer.from(options.salt ?? randomBytes(16)),
    shared = sender.computeSecret(uaPublic);
  const ikm = hkdf(
    authSecret,
    shared,
    Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]),
    32,
  );
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
    nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = createCipheriv('aes-128-gcm', cek, nonce);
  // One record, so it is also the last: a single 0x02 delimiter and no padding.
  const body = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
    cipher.final(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, body, cipher.getAuthTag()]);
}

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string;
  auth: string;
}
export interface PushResult {
  // The push service's HTTP status, or 0 when it could not be reached.
  status: number;
  detail: string;
}
export const delivered = (r: PushResult) => r.status >= 200 && r.status < 300;
// 404/410: the browser unsubscribed, the app was removed or permission revoked. Forget the device.
export const gone = (r: PushResult) => r.status === 404 || r.status === 410;

export interface WebPushConfig extends VapidKeys {
  subject: string;
}
export type Transport = typeof fetch;

// Deliver one notification. Never throws: a failure is a result.
export async function sendPush(
  subscription: PushSubscriptionKeys,
  payload: Record<string, unknown>,
  config: WebPushConfig,
  options: { ttl?: number; urgency?: string; topic?: string; transport?: Transport } = {},
): Promise<PushResult> {
  if (!isPushEndpoint(subscription.endpoint))
    return { status: 0, detail: 'NOT_A_PUSH_SERVICE_ENDPOINT' };
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  if (body.length > MAX_PAYLOAD) return { status: 0, detail: 'PAYLOAD_TOO_LARGE' };
  try {
    const headers: Record<string, string> = {
      Authorization: vapidAuthorization(subscription.endpoint, config, config.subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      // How long the push service may hold it for a phone that is off.
      TTL: String(options.ttl ?? 600),
      Urgency: options.urgency ?? 'high',
    };
    // A newer message with the same topic replaces one still waiting for an offline phone.
    // At most 32 base64url characters, anything else is a 400, so it is cleaned rather than trusted.
    const topic = (options.topic ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    if (topic) headers.Topic = topic;
    const response = await (options.transport ?? fetch)(subscription.endpoint, {
      method: 'POST',
      headers,
      body: new Uint8Array(encrypt(body, subscription.p256dh, subscription.auth)),
      redirect: 'manual',
      signal: AbortSignal.timeout(10000),
    });
    return { status: response.status, detail: '' };
  } catch (error) {
    return { status: 0, detail: error instanceof Error ? error.name : 'UNKNOWN' };
  }
}

// The Web Push configuration, or null when it is switched off (no VAPID pair configured).
export function webPushConfig(c: {
  WEB_PUSH_VAPID_PUBLIC_KEY?: string;
  WEB_PUSH_VAPID_PRIVATE_KEY?: string;
  WEB_PUSH_SUBJECT?: string;
  PUBLIC_APP_ORIGIN: string;
}): WebPushConfig | null {
  const publicKey = c.WEB_PUSH_VAPID_PUBLIC_KEY?.trim(),
    privateKey = c.WEB_PUSH_VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: c.WEB_PUSH_SUBJECT || c.PUBLIC_APP_ORIGIN };
}
