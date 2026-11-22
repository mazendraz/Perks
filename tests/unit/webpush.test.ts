import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createDecipheriv, createECDH, createPublicKey, ECDH, hkdfSync, verify } from 'node:crypto';
import {
  b64url,
  b64urlDecode,
  delivered,
  encrypt,
  generateVapidKeys,
  gone,
  isPushEndpoint,
  keysMatch,
  sendPush,
  vapidAuthorization,
  webPushConfig,
} from '../../apps/api/src/webpush.js';
import { readConfig } from '../../apps/api/src/config.js';
import {
  autoStampNotice,
  firstName,
  stampRequestNotice,
  testNotice,
} from '../../apps/api/src/push-notices.js';

// RFC 8291 section 5, "Push Message Encryption Example".
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  senderPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  senderPublic:
    'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  receiverPublic:
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  body:
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS' +
    '6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};
const FCM = 'https://fcm.googleapis.com/fcm/send/abc:def';

test('the encrypted payload matches the RFC 8291 worked example byte for byte', () => {
  const sender = createECDH('prime256v1');
  sender.setPrivateKey(b64urlDecode(RFC.senderPrivate));
  assert.equal(b64url(sender.getPublicKey()), RFC.senderPublic);
  const body = encrypt(Buffer.from(RFC.plaintext), RFC.receiverPublic, RFC.auth, {
    senderPrivateKey: RFC.senderPrivate,
    salt: b64urlDecode(RFC.salt),
  });
  assert.equal(b64url(body), RFC.body);
});

// What a browser does with the body, written from the RFC independently of `encrypt`.
function decrypt(body: Buffer, receiver: ReturnType<typeof createECDH>, auth: Buffer) {
  const salt = body.subarray(0, 16),
    idLength = body[20]!,
    senderPublic = body.subarray(21, 21 + idLength),
    ciphertext = body.subarray(21 + idLength);
  assert.equal(body.readUInt32BE(16), 4096);
  const shared = receiver.computeSecret(senderPublic);
  const derive = (s: Buffer, ikm: Buffer, info: Buffer, n: number) =>
    Buffer.from(hkdfSync('sha256', ikm, s, info, n));
  const ikm = derive(
    auth,
    shared,
    Buffer.concat([Buffer.from('WebPush: info\0'), receiver.getPublicKey(), senderPublic]),
    32,
  );
  const key = derive(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16),
    nonce = derive(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const decipher = createDecipheriv('aes-128-gcm', key, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const padded = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  assert.equal(padded.at(-1), 2);
  return padded.subarray(0, -1);
}

test('a browser key pair decrypts what was sent to it, and every message is freshly keyed', () => {
  const receiver = createECDH('prime256v1');
  receiver.generateKeys();
  const auth = Buffer.from('0123456789abcdef'),
    p256dh = b64url(receiver.getPublicKey());
  const message = Buffer.from(JSON.stringify({ title: 'طلب ختم جديد', body: 'فرع المعادي' }));
  const one = encrypt(message, p256dh, b64url(auth)),
    two = encrypt(message, p256dh, b64url(auth));
  assert.deepEqual(decrypt(one, receiver, auth), message);
  assert.deepEqual(decrypt(two, receiver, auth), message);
  assert.notDeepEqual(one.subarray(0, 16), two.subarray(0, 16));
  assert.notDeepEqual(one.subarray(21, 86), two.subarray(21, 86));
});

test('the VAPID token is signed by the key the browser was given', () => {
  const keys = generateVapidKeys();
  const header = vapidAuthorization(FCM, keys, 'mailto:owner@example.com', 1_000_000);
  assert.ok(header.startsWith('vapid t='));
  const [token, k] = header.slice('vapid t='.length).split(', k=') as [string, string];
  assert.equal(k, keys.publicKey);
  const [head, claimsPart, signature] = token.split('.') as [string, string, string];
  assert.deepEqual(JSON.parse(b64urlDecode(head).toString()), { typ: 'JWT', alg: 'ES256' });
  const claims = JSON.parse(b64urlDecode(claimsPart).toString());
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'mailto:owner@example.com');
  assert.ok(claims.exp - 1_000_000 > 0 && claims.exp - 1_000_000 <= 24 * 3600);
  const point = b64urlDecode(keys.publicKey);
  const publicKey = createPublicKey({
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: b64url(point.subarray(1, 33)),
      y: b64url(point.subarray(33)),
    },
    format: 'jwk',
  });
  assert.equal(b64urlDecode(signature).length, 64);
  assert.ok(
    verify(
      'sha256',
      Buffer.from(head + '.' + claimsPart),
      { key: publicKey, dsaEncoding: 'ieee-p1363' },
      b64urlDecode(signature),
    ),
  );
});

test('a pasted key pair that does not belong together is caught', () => {
  const one = generateVapidKeys(),
    two = generateVapidKeys();
  assert.ok(keysMatch(one));
  assert.ok(!keysMatch({ publicKey: one.publicKey, privateKey: two.privateKey }));
  assert.ok(!keysMatch({ publicKey: 'nonsense', privateKey: 'nonsense' }));
});

test('generated VAPID private keys retain leading zero bytes', (t) => {
  t.mock.method(ECDH.prototype, 'generateKeys', function (this: ECDH) {
    this.setPrivateKey(Buffer.from([1]));
    return this.getPublicKey();
  });
  const keys = generateVapidKeys();
  const scalar = Buffer.alloc(32);
  scalar[31] = 1;
  assert.deepEqual(b64urlDecode(keys.privateKey), scalar);
  assert.ok(keysMatch(keys));
});

test('only the browsers’ push services are endpoints', () => {
  for (const good of [
    FCM,
    'https://web.push.apple.com/QHk7gF0cXbF',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAA',
  ])
    assert.ok(isPushEndpoint(good), good);
  for (const bad of [
    'http://fcm.googleapis.com/fcm/send/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://evilfcm.googleapis.com/x',
    'https://user:pass@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'https://127.0.0.1/x',
    'https://169.254.169.254/latest/meta-data',
    'https://localhost/x',
    'file:///etc/passwd',
    '',
    'not a url',
  ])
    assert.ok(!isPushEndpoint(bad), bad);
});

test('Web Push is off unless both halves of a matching VAPID pair are configured', () => {
  const env = {
    DATABASE_URL: 'postgres://u:p@127.0.0.1:5432/x',
    AUTH_DATABASE_URL: 'postgres://a:p@127.0.0.1:5432/x',
    AUTH_PEPPER: 'p'.repeat(40),
    NODE_ENV: 'test',
  } as NodeJS.ProcessEnv;
  const keys = generateVapidKeys(),
    other = generateVapidKeys();
  assert.equal(webPushConfig(readConfig({}, env)), null);
  assert.equal(
    webPushConfig(
      readConfig({}, { ...env, WEB_PUSH_VAPID_PUBLIC_KEY: '', WEB_PUSH_VAPID_PRIVATE_KEY: '' }),
    ),
    null,
  );
  assert.throws(
    () => readConfig({}, { ...env, WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey }),
    /both/,
  );
  assert.throws(
    () =>
      readConfig(
        {},
        {
          ...env,
          WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
          WEB_PUSH_VAPID_PRIVATE_KEY: other.privateKey,
        },
      ),
    /not one pair/,
  );
  assert.throws(
    () =>
      readConfig(
        {},
        {
          ...env,
          WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
          WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
          WEB_PUSH_SUBJECT: 'ftp://nope',
        },
      ),
    /WEB_PUSH_SUBJECT/,
  );
  const pair = {
    WEB_PUSH_VAPID_PUBLIC_KEY: keys.publicKey,
    WEB_PUSH_VAPID_PRIVATE_KEY: keys.privateKey,
  };
  // The default origin is plain http, which push services refuse as a VAPID subject: fail at boot.
  assert.throws(() => readConfig({}, { ...env, ...pair }), /WEB_PUSH_SUBJECT/);
  assert.deepEqual(
    webPushConfig(
      readConfig({}, { ...env, ...pair, WEB_PUSH_SUBJECT: 'mailto:ops@perks.example' }),
    ),
    { ...keys, subject: 'mailto:ops@perks.example' },
  );
  assert.deepEqual(
    webPushConfig(readConfig({}, { ...env, ...pair, PUBLIC_APP_ORIGIN: 'https://perks.example' })),
    { ...keys, subject: 'https://perks.example' },
  );
});

test('delivery posts an encrypted body with VAPID headers, refuses other hosts and classifies the answer', async () => {
  const keys = generateVapidKeys(),
    receiver = createECDH('prime256v1');
  receiver.generateKeys();
  const subscription = {
    endpoint: FCM,
    p256dh: b64url(receiver.getPublicKey()),
    auth: b64url(Buffer.from('0123456789abcdef')),
  };
  const config = { ...keys, subject: 'https://perks.example' };
  const calls: { url: string; init: RequestInit }[] = [];
  const answer = (status: number) =>
    (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      return new Response('', { status });
    }) as typeof fetch;
  const payload = { title: 't', body: 'b' };
  const ok = await sendPush(subscription, payload, config, {
    topic: 'branch/1 two',
    transport: answer(201),
  });
  assert.ok(delivered(ok));
  const headers = calls[0]!.init.headers as Record<string, string>;
  assert.equal(calls[0]!.url, FCM);
  assert.equal(calls[0]!.init.redirect, 'manual');
  assert.equal(headers['Content-Encoding'], 'aes128gcm');
  assert.equal(headers.Topic, 'branch1two');
  assert.match(headers.Authorization!, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
  assert.deepEqual(
    JSON.parse(
      decrypt(
        Buffer.from(calls[0]!.init.body as Uint8Array),
        receiver,
        Buffer.from('0123456789abcdef'),
      ).toString(),
    ),
    payload,
  );
  assert.ok(gone(await sendPush(subscription, payload, config, { transport: answer(410) })));
  assert.ok(gone(await sendPush(subscription, payload, config, { transport: answer(404) })));
  const throttled = await sendPush(subscription, payload, config, { transport: answer(429) });
  assert.ok(!delivered(throttled) && !gone(throttled));
  const before = calls.length;
  const refused = await sendPush(
    { ...subscription, endpoint: 'https://169.254.169.254/x' },
    payload,
    config,
    {
      transport: answer(201),
    },
  );
  assert.equal(refused.status, 0);
  const huge = await sendPush(subscription, { text: 'x'.repeat(4000) }, config, {
    transport: answer(201),
  });
  assert.equal(huge.detail, 'PAYLOAD_TOO_LARGE');
  assert.equal(calls.length, before, 'neither refused request reached the network');
  const offline = await sendPush(subscription, payload, config, {
    transport: (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch,
  });
  assert.deepEqual(offline, { status: 0, detail: 'TypeError' });
});

test('a notification carries the first name and the branch, and opens the scan’s own screen', () => {
  const id = '8f14e45f-ceea-4c67-9f6b-1a2b3c4d5e6f';
  const en = stampRequestNotice('en', id, 'Maadi branch', 'Mona Ahmed Ali'),
    ar = stampRequestNotice('ar', id, '  فرع المعادي ', 'منى أحمد');
  assert.deepEqual(Object.keys(en).sort(), [
    'actions',
    'body',
    'dir',
    'lang',
    'tag',
    'title',
    'url',
  ]);
  assert.equal(en.title, 'Stamp to approve · Mona');
  assert.equal(ar.title, 'ختم محتاج موافقتك · منى');
  assert.ok(en.body.startsWith('Maadi branch'));
  assert.ok(ar.body.startsWith('فرع المعادي'));
  assert.equal(ar.dir, 'rtl');
  assert.equal(en.url, '/cashier/requests/' + id);
  assert.equal(en.tag, 'stamp-request:' + id);
  assert.deepEqual(en.actions, [{ action: 'reject-block', title: 'Reject & Block' }]);
  assert.ok(stampRequestNotice('en', id, 'x'.repeat(500)).body.startsWith('x'.repeat(80) + ' '));
  // A phone number typed as a name never reaches the lock screen.
  assert.equal(stampRequestNotice('en', id, 'Maadi', '01001234567').title, 'Stamp to approve');
  const auto = autoStampNotice('en', id, 'Maadi', 'Omar', 2);
  assert.equal(auto.title, 'Stamp added +2 · Omar');
  assert.equal(auto.url, '/cashier/stamps/' + id);
  assert.deepEqual(
    auto.actions!.map((a) => a.action),
    ['revoke', 'block'],
  );
  assert.equal(firstName('  Sara  Mohamed '), 'Sara');
  assert.ok(!JSON.stringify(testNotice('en')).match(/\d{4}/));
});

// The worker file is a template for the build, but its push handlers are plain JavaScript.
function loadWorker() {
  const listeners: Record<string, (event: unknown) => void> = {},
    shown: { title: string; options: Record<string, unknown> }[] = [],
    opened: string[] = [],
    focused: string[] = [];
  const clients: { url: string; focus(): Promise<void>; navigate(url: string): Promise<void> }[] =
    [];
  const self = {
    location: { origin: 'https://perks.example' },
    addEventListener: (name: string, fn: (event: unknown) => void) => (listeners[name] = fn),
    registration: {
      showNotification: async (title: string, options: Record<string, unknown>) =>
        void shown.push({ title, options }),
      pushManager: { subscribe: async () => ({}) },
    },
    clients: {
      matchAll: async () => clients,
      openWindow: async (url: string) => void opened.push(url),
      claim: async () => {},
    },
    skipWaiting: async () => {},
    navigator: { onLine: true },
  };
  vm.runInNewContext(readFileSync('apps/web/service-worker.template.js', 'utf8'), {
    self,
    URL,
    caches: {},
    fetch: async () => new Response(''),
    Response,
  });
  const waited: Promise<unknown>[] = [];
  const dispatch = (name: string, event: Record<string, unknown>) => {
    listeners[name]!({ ...event, waitUntil: (p: Promise<unknown>) => waited.push(p) });
    return Promise.all(waited.splice(0));
  };
  return { dispatch, shown, opened, focused, clients };
}

test('the service worker shows every push, replaces by tag, and tolerates a broken payload', async () => {
  const { dispatch, shown } = loadWorker();
  await dispatch('push', {
    data: {
      json: () => ({
        title: 'New stamp request',
        body: 'Maadi',
        url: '/cashier',
        tag: 'stamp-request:b1',
        lang: 'en',
        dir: 'ltr',
      }),
    },
  });
  assert.equal(shown[0]!.title, 'New stamp request');
  assert.equal(shown[0]!.options.body, 'Maadi');
  assert.equal(shown[0]!.options.tag, 'stamp-request:b1');
  assert.equal(shown[0]!.options.renotify, true);
  assert.equal(shown[0]!.options.dir, 'ltr');
  await dispatch('push', {
    data: {
      json: () => {
        throw new Error('not json');
      },
    },
  });
  assert.equal(shown[1]!.title, 'Perks', 'still shows something: browsers punish a silent push');
  await dispatch('push', {
    data: {
      json: () => ({
        title: 'Stamp added',
        url: '/cashier/stamps/t1',
        actions: [
          { action: 'revoke', title: 'Revoke this stamp' },
          { action: 'delete-everything', title: 'x' },
          { action: 'block', title: 'Block customer' },
        ],
      }),
    },
  });
  // Built inside the worker's own realm, so compared by value.
  assert.deepEqual(JSON.parse(JSON.stringify(shown[2]!.options.actions)), [
    { action: 'revoke', title: 'Revoke this stamp' },
    { action: 'block', title: 'Block customer' },
  ]);
});

test('a notification button opens the screen with ?do=<action>, never acting on its own', async () => {
  const { dispatch, opened } = loadWorker();
  const tap = (action: string) => ({
    action,
    notification: { close() {}, data: { url: '/cashier/stamps/t1' } },
  });
  await dispatch('notificationclick', tap('revoke'));
  await dispatch('notificationclick', tap('reject-block'));
  await dispatch('notificationclick', tap('something-else'));
  assert.deepEqual(opened, [
    'https://perks.example/cashier/stamps/t1?do=revoke',
    'https://perks.example/cashier/stamps/t1?do=reject-block',
    'https://perks.example/cashier/stamps/t1',
  ]);
});

test('a tap opens only a cashier page of this origin, reusing an open cashier window', async () => {
  const { dispatch, opened, clients } = loadWorker();
  const note = (url: string) => ({ notification: { close() {}, data: { url } } });
  await dispatch('notificationclick', note('https://evil.example/cashier'));
  await dispatch('notificationclick', note('/merchant/secret'));
  assert.deepEqual(opened, ['https://perks.example/cashier', 'https://perks.example/cashier']);
  let focused = 0;
  clients.push({
    url: 'https://perks.example/cashier',
    focus: async () => void focused++,
    navigate: async () => {},
  });
  await dispatch('notificationclick', note('/cashier'));
  assert.equal(focused, 1);
  assert.equal(opened.length, 2, 'no second window while one is open');
});
