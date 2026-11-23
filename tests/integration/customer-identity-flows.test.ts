// How a customer gets back to their cards: sign-out on a shared phone, the Wallet door, any shop's
// cashier, number release, and WhatsApp proof. See docs/CUSTOMER-IDENTITY-SCENARIOS.md.
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomBytes, randomInt } from 'node:crypto';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { enrollmentTerms, login } from '../helpers.js';
import type { LegalNotice } from '../../packages/contracts/src/legal.js';

const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
const origin = 'https://identity-flows.nuqta.test';
const whatsappSecret = randomBytes(16).toString('hex'),
  whatsappVerify = randomBytes(16).toString('hex'),
  whatsappNumberId = '1234567890';
const whatsappPath = '/api/v1/customer/whatsapp',
  webhookPath = '/api/v1/webhooks/whatsapp-recovery';
const { app } = await buildApp({
  APP_ENV: 'test',
  COOKIE_SECURE: 'true',
  PUBLIC_APP_ORIGIN: origin,
  LOG_LEVEL: 'silent',
  WHATSAPP_RECOVERY_ENABLED: 'true',
  WHATSAPP_RECOVERY_NUMBER: '201001234567',
  WHATSAPP_RECOVERY_NUMBER_ID: whatsappNumberId,
  WHATSAPP_RECOVERY_APP_SECRET: whatsappSecret,
  WHATSAPP_RECOVERY_VERIFY_TOKEN: whatsappVerify,
});
export type Shop = { m: string; p: string; v: string; b: string; terms: string; code: string };
const A: Shop = {
  m: ids.merchantA,
  p: '40000000-0000-4000-8000-000000000001',
  v: '50000000-0000-4000-8000-000000000001',
  b: ids.branchA,
  terms: '',
  code: '',
};
const B: Shop = {
  m: ids.merchantB,
  p: '40000000-0000-4000-8000-000000000002',
  v: '50000000-0000-4000-8000-000000000002',
  b: ids.branchB,
  terms: '',
  code: '',
};
type R = Awaited<ReturnType<typeof app.inject>>;
type H = Record<string, string>;
const jar = (r: R) => r.cookies.map((x) => x.name + '=' + x.value).join('; ');
// Like a browser: a cookie set again replaces the old one with the same name.
const merge = (current: string | undefined, r: R) => {
  const all = new Map(
    (current ?? '')
      .split('; ')
      .filter(Boolean)
      .map((x) => [x.slice(0, x.indexOf('=')), x] as const),
  );
  for (const x of r.cookies) all.set(x.name, x.name + '=' + x.value);
  return [...all.values()].join('; ');
};
let notice: LegalNotice,
  ip = 1;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  for (const s of [A, B]) {
    s.terms = await enrollmentTerms(app, s.p);
    s.code = randomBytes(24).toString('base64url');
    await db.query(
      "INSERT INTO placements(merchant_id,branch_id,label,kind,public_code,created_by) VALUES($1,$2,'Flows','stand',$3,$4)",
      [s.m, s.b, s.code, s === A ? ids.ownerA : ids.ownerB],
    );
  }
  notice = (await app.inject('/api/v1/public/legal?lang=en')).json();
});
after(async () => {
  await app.close();
  await db.end();
});

const phone = () => '0155' + String(randomInt(0, 10_000_000)).padStart(7, '0');
async function device(): Promise<H> {
  const r = await app.inject({
    url: '/api/v1/customer/bootstrap',
    headers: { 'x-nuqta-workspace': 'customer' },
  });
  return {
    origin,
    cookie: jar(r),
    'x-csrf-token': r.json().csrfToken,
    'x-nuqta-workspace': 'customer',
  };
}
async function register(d: H, number: string, s: Shop, name = 'Holder') {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/customer/register',
    headers: d,
    remoteAddress: '198.51.100.' + (ip++ % 250),
    payload: {
      displayName: name,
      phone: number,
      merchantId: s.m,
      programId: s.p,
      programVersionId: s.v,
      branchId: s.b,
      placementCode: s.code,
      acceptedTerms: true,
      acceptedTermsHash: s.terms,
      acceptedPrivacyVersion: notice.acceptance.version,
      acceptedPrivacyHash: notice.acceptance.hash,
      acceptedPrivacyLocale: notice.locale,
      source: 'qr',
    },
  });
  if (r.statusCode === 200) {
    d.cookie = merge(d.cookie, r);
    d['x-csrf-token'] = r.json().csrfToken;
  }
  return r;
}

async function whatsappStart(d: H, number: string, purpose: 'update' | 'restore') {
  const response = await app.inject({
    method: 'POST',
    url: whatsappPath + '/start',
    headers: d,
    remoteAddress: '203.0.113.' + (ip++ % 250),
    payload: { phone: number, purpose },
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json() as { code: string; url: string; expiresAt: string };
}

async function whatsappFinish(d: H, number: string, code: string) {
  const response = await app.inject({
    method: 'POST',
    url: whatsappPath + '/finish',
    headers: d,
    remoteAddress: '203.0.113.' + (ip++ % 250),
    payload: { phone: number, code },
  });
  if (response.statusCode === 200 && response.json().csrfToken) {
    d.cookie = merge(d.cookie, response);
    d['x-csrf-token'] = response.json().csrfToken;
  }
  return response;
}

function deliverWhatsApp(
  message: string,
  from: string,
  numberId = whatsappNumberId,
  authentic = true,
) {
  // JSON formatting is part of Meta's signature. Verifying reserialized JSON would fail here.
  const payload = JSON.stringify(
    {
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: numberId },
                messages: [{ type: 'text', from: '2' + from, text: { body: message } }],
              },
            },
          ],
        },
      ],
    },
    null,
    2,
  );
  const signature = createHmac('sha256', authentic ? whatsappSecret : 'incorrect')
    .update(payload)
    .digest('hex');
  return app.inject({
    method: 'POST',
    url: webhookPath,
    payload,
    headers: {
      'content-type': 'application/json',
      'x-hub-signature-256': 'sha256=' + signature,
    },
  });
}

const messageFrom = (proof: { url: string }) => new URL(proof.url).searchParams.get('text')!;

test('WhatsApp recovery is opt-in and Meta must prove access to the configured webhook', async () => {
  const disabled = await buildApp({
    APP_ENV: 'test',
    LOG_LEVEL: 'silent',
    WHATSAPP_RECOVERY_ENABLED: 'false',
  });
  try {
    assert.deepEqual((await disabled.app.inject(whatsappPath)).json(), {
      enabled: false,
      account: null,
    });
    assert.equal((await disabled.app.inject(webhookPath)).statusCode, 404);
  } finally {
    await disabled.app.close();
  }
  const check = (token: string) =>
    app.inject({
      url: webhookPath,
      query: {
        'hub.mode': 'subscribe',
        'hub.verify_token': token,
        'hub.challenge': 'meta-challenge',
      },
    });
  assert.equal((await check('incorrect')).statusCode, 404);
  assert.equal((await check(whatsappVerify)).body, 'meta-challenge');
});

test('only the requesting browser and a signed message from a previously verified number restore cards', async () => {
  const number = phone(),
    original = await device(),
    fresh = await device();
  assert.equal((await register(original, number, A)).statusCode, 200);
  assert.equal((await register(original, number, B)).statusCode, 200);
  const availability = () => app.inject({ url: whatsappPath, headers: original });
  assert.equal((await availability()).json().account.verified, false);

  const prior = await whatsappStart(fresh, number, 'restore');
  assert.equal((await deliverWhatsApp(messageFrom(prior), number)).statusCode, 200);
  assert.equal(
    (await whatsappFinish(fresh, number, prior.code)).json().error.code,
    'WHATSAPP_RECOVERY_UNAVAILABLE',
  );

  const verification = await whatsappStart(original, number, 'update');
  assert.equal((await deliverWhatsApp(messageFrom(verification), number)).statusCode, 200);
  assert.deepEqual((await whatsappFinish(original, number, verification.code)).json(), {
    status: 'updated',
  });
  assert.equal((await availability()).json().account.verified, true);
  assert.equal(
    (await whatsappFinish(fresh, number, prior.code)).json().error.code,
    'WHATSAPP_RECOVERY_UNAVAILABLE',
  );

  const proof = await whatsappStart(fresh, number, 'restore');
  const message = messageFrom(proof);
  assert.equal((await deliverWhatsApp(message, number, whatsappNumberId, false)).statusCode, 403);
  assert.equal((await deliverWhatsApp(message, phone())).statusCode, 200);
  assert.equal((await deliverWhatsApp(message, number, '1234567891')).statusCode, 200);
  assert.equal((await deliverWhatsApp(message.replace('RESTORE', 'PHONE'), number)).statusCode, 200);
  assert.deepEqual((await whatsappFinish(fresh, number, proof.code)).json(), { status: 'waiting' });
  assert.equal((await deliverWhatsApp(message, number)).statusCode, 200);
  assert.equal((await deliverWhatsApp(message, number)).statusCode, 200, 'Meta can retry delivery');
  assert.equal((await whatsappFinish(await device(), number, proof.code)).statusCode, 410);
  assert.equal((await whatsappFinish(fresh, number, proof.code)).json().status, 'restored');
  assert.equal(
    (await whatsappFinish(fresh, number, proof.code)).json().status,
    'restored',
    'a lost response can be retried',
  );

  const cards = (await app.inject({ url: '/api/v1/me/memberships', headers: fresh })).json().cards;
  assert.deepEqual(
    cards.map((card: { merchant_id: string }) => card.merchant_id).sort(),
    [A.m, B.m].sort(),
  );
  const notices = (await app.inject({ url: '/api/v1/me/device-notices', headers: original })).json()
    .notices;
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, 'phone_verified');
  assert.equal(notices[0].canRemove, true);
  const remove = await app.inject({
    method: 'POST',
    url: '/api/v1/me/device-notices/' + notices[0].id,
    headers: original,
    payload: { removeDevice: true },
  });
  assert.equal(remove.statusCode, 200, remove.body);
  const retry = await whatsappFinish(fresh, number, proof.code);
  assert.ok([403, 410].includes(retry.statusCode), retry.body);
  assert.equal((await app.inject({ url: '/api/v1/session', headers: fresh })).statusCode, 401);
});

test('changing a number keeps the same cards and retires proof for the old number', async () => {
  const previous = phone(),
    next = phone(),
    original = await device(),
    fresh = await device();
  const registration = await register(original, previous, A);
  assert.equal(registration.statusCode, 200, registration.body);
  const membership = registration.json().membershipId;
  const confirm = async (number: string) => {
    const proof = await whatsappStart(original, number, 'update');
    assert.equal((await deliverWhatsApp(messageFrom(proof), number)).statusCode, 200);
    return whatsappFinish(original, number, proof.code);
  };
  assert.equal((await confirm(previous)).json().status, 'updated');
  const oldProof = await whatsappStart(fresh, previous, 'restore');
  assert.equal((await deliverWhatsApp(messageFrom(oldProof), previous)).statusCode, 200);
  assert.equal((await confirm(next)).json().status, 'updated');
  assert.equal(
    (await whatsappFinish(fresh, previous, oldProof.code)).json().error.code,
    'WHATSAPP_RECOVERY_UNAVAILABLE',
  );
  const nextProof = await whatsappStart(fresh, next, 'restore');
  assert.equal((await deliverWhatsApp(messageFrom(nextProof), next)).statusCode, 200);
  assert.equal((await whatsappFinish(fresh, next, nextProof.code)).json().status, 'restored');
  const cards = (await app.inject({ url: '/api/v1/me/memberships', headers: fresh })).json().cards;
  assert.deepEqual(
    cards.map((card: { id: string }) => card.id),
    [membership],
  );
  assert.equal(
    (
      await db.query(
        'SELECT contact_phone FROM tenant_customer_profiles cp JOIN memberships m ON m.profile_id=cp.id WHERE m.id=$1',
        [membership],
      )
    ).rows[0].contact_phone,
    '+2' + next,
  );
});
const deviceActive = async (number: string) =>
  (
    await db.query(
      'SELECT count(*)::int AS n FROM customer_devices d JOIN customer_identities ci ON ci.customer_id=d.customer_id WHERE ci.phone_e164=$1 AND d.revoked_at IS NULL',
      ['+2' + number],
    )
  ).rows[0].n as number;

test('staff signing out on their own phone keep the customer card it holds; a shared phone clears it', async () => {
  for (const keep of [true, false]) {
    const number = phone(),
      d = await device();
    assert.equal((await register(d, number, A)).statusCode, 200);
    const staff = await login(app, 'cashier@bunn.test', origin);
    // The device cookie is on the same browser as the staff session.
    const deviceCookie = (d.cookie ?? '')
      .split('; ')
      .filter((x) => x.startsWith('__Host-nq_device='))
      .join('; ');
    const both = { ...staff, cookie: staff.cookie + '; ' + deviceCookie };
    const session = (await app.inject({ url: '/api/v1/session', headers: both })).json();
    assert.equal(session.user.customerCardHere, true);
    const out = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: both,
      ...(keep ? { payload: { keepCustomerCard: true } } : {}),
    });
    assert.equal(out.statusCode, 204, out.body);
    assert.equal(await deviceActive(number), keep ? 1 : 0, keep ? 'kept' : 'cleared');
  }
});

async function walletRestore(d: H, token: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/customer/wallet-restore',
    headers: d,
    remoteAddress: '203.0.113.' + (ip++ % 250),
    payload: { token },
  });
  if (r.statusCode === 200) {
    d.cookie = merge(d.cookie, r);
    d['x-csrf-token'] = r.json().csrfToken;
  }
  return r;
}
const membershipOf = async (number: string, shop: Shop) =>
  (
    await db.query(
      'SELECT ms.id FROM memberships ms JOIN customer_identities ci ON ci.customer_id=ms.user_id WHERE ci.phone_e164=$1 AND ms.merchant_id=$2',
      ['+2' + number, shop.m],
    )
  ).rows[0].id as string;
const generation = async (membershipId: string) =>
  ((
    await db.query('SELECT generation FROM wallet_restore_keys WHERE membership_id=$1', [
      membershipId,
    ])
  ).rows[0]?.generation ?? 1) as number;

test('the Wallet link brings every card back on a new phone, once, and tells the old phone', async () => {
  const { walletRestoreToken } = await import('../../apps/api/src/wallet/restore.js');
  const number = phone(),
    old = await device();
  assert.equal((await register(old, number, A)).statusCode, 200);
  assert.equal((await register(old, number, B)).statusCode, 200);
  const cardA = await membershipOf(number, A);
  const token = walletRestoreToken(cardA, 1, c.AUTH_PEPPER);

  // A forged key is refused.
  const forged = await walletRestore(
    await device(),
    token.slice(0, -1) + (token.endsWith('0') ? '1' : '0'),
  );
  assert.equal(forged.statusCode, 410);

  // The new phone: one tap, both shops' cards.
  const fresh = await device();
  const restored = await walletRestore(fresh, token);
  assert.equal(restored.statusCode, 200, restored.body);
  const cards = (await app.inject({ url: '/api/v1/me/memberships', headers: fresh })).json();
  assert.deepEqual(
    cards.cards.map((x: { merchant_id: string }) => x.merchant_id).sort(),
    [A.m, B.m].sort(),
  );
  // It can join a third shop like the customer's own phone (not limited to one shop).
  const joinedAgain = await register(fresh, number, B);
  assert.equal(joinedAgain.statusCode, 200, joinedAgain.body);

  // The used link is retired: the pass moves to the next generation.
  assert.equal(await generation(cardA), 2);
  assert.equal((await walletRestore(await device(), token)).statusCode, 410);

  // The old phone is told and may remove the new one.
  const notices = (await app.inject({ url: '/api/v1/me/device-notices', headers: old })).json()
    .notices;
  assert.equal(notices[0].kind, 'wallet_restored');
  assert.equal(notices[0].canRemove, true);

  // Everyday use: opening the card from Wallet on a phone that already holds it changes nothing,
  // even with the older link the pass still shows until it updates.
  const again = await walletRestore(old, token);
  assert.equal(again.statusCode, 200, again.body);
  assert.equal(await generation(cardA), 2);
});

test('signup issues distinct six-digit card numbers and a new device opens only the issuing shop', async () => {
  const customerPhone = phone();
  const original = await device();
  const first = await register(original, customerPhone, A);
  const second = await register(original, customerPhone, B);
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);
  const memberA = first.json().membershipId as string;
  const memberB = second.json().membershipId as string;

  const cardUrl = (id: string) => '/api/v1/me/memberships/' + id;
  const readCard = async (id: string, headers: H) =>
    (await app.inject({ url: cardUrl(id), headers })).json().card;
  // Exercise leading-zero input and output without relying on the random allocator to hit one.
  const numberA = (await readCard(memberA, original)).card_number as string;
  const numberB = (await readCard(memberB, original)).card_number as string;
  assert.match(numberA, /^[0-9]{6}$/);
  assert.match(numberB, /^[0-9]{6}$/);
  assert.notEqual(numberA, numberB);
  const zeroNumber = (
    await db.query(
      `SELECT lpad(n::text,6,'0') AS number FROM generate_series(0,99999) n
       WHERE NOT EXISTS(SELECT 1 FROM membership_card_numbers WHERE card_number=lpad(n::text,6,'0'))
       LIMIT 1`,
    )
  ).rows[0].number as string;
  await db.query('UPDATE membership_card_numbers SET card_number=$1 WHERE membership_id=$2', [
    zeroNumber,
    memberA,
  ]);

  const staff = await login(app, 'cashier@bunn.test', origin);
  await db.query('UPDATE merchants SET cashier_recovery_enabled=true WHERE id=$1', [A.m]);
  const base = '/api/v1/merchants/' + A.m + '/customer-recovery/';
  const lookup = await app.inject({
    method: 'POST',
    url: base + 'search',
    headers: staff,
    payload: { branchId: A.b, phone: customerPhone },
  });
  assert.equal(lookup.statusCode, 200, lookup.body);
  assert.equal(lookup.json().customer.cards[0].membershipId, memberA);
  assert.equal(lookup.json().customer.cards[0].cardNumber, undefined);
  const reveal = (membershipId: string, phone = customerPhone, branchId = A.b) =>
    app.inject({
      method: 'POST',
      url: base + 'card-number',
      headers: staff,
      payload: { branchId, phone, membershipId },
    });
  const revealed = await reveal(memberA);
  assert.equal(revealed.statusCode, 200, revealed.body);
  assert.equal(revealed.json().cardNumber, zeroNumber);
  assert.equal(revealed.headers['cache-control'], 'no-store');
  assert.equal((await reveal(memberB)).statusCode, 404);
  assert.equal((await reveal(memberA, phone())).statusCode, 404);
  assert.equal((await reveal(memberA, customerPhone, B.b)).statusCode, 403);
  const audit = await db.query(
    "SELECT target_id,detail FROM audit_events WHERE action='customer.card_number.revealed' AND target_id=$1",
    [memberA],
  );
  assert.deepEqual(audit.rows, [{ target_id: memberA, detail: { branchId: A.b } }]);

  const fresh = await device();
  const signedIn = await cardNumberLogin(fresh, zeroNumber);
  assert.equal(signedIn.statusCode, 200, signedIn.body);
  assert.equal(signedIn.json().membershipId, memberA);
  fresh.cookie = merge(fresh.cookie, signedIn);
  fresh['x-csrf-token'] = signedIn.json().csrfToken;
  const cards = (await app.inject({ url: '/api/v1/me/memberships', headers: fresh })).json().cards;
  assert.deepEqual(
    cards.map((card: { id: string }) => card.id),
    [memberA],
  );
  assert.equal(cards[0].card_number, zeroNumber);
  assert.equal((await app.inject({ url: cardUrl(memberB), headers: fresh })).statusCode, 404);
  assert.equal((await register(fresh, customerPhone, B)).statusCode, 409);
  assert.equal((await cardNumberLogin(fresh, numberB)).json().error.code, 'CARD_NUMBER_INVALID');
  assert.equal(
    (await app.inject({ url: cardUrl(memberA) + '/wallet/google', headers: fresh })).json().error
      .code,
    'DEVICE_SCOPE_RECOVERY_REQUIRED',
  );

  // The existing device cookie can restore the same scoped session.
  fresh.cookie = fresh.cookie.split('; ').find((value) => value.startsWith('__Host-nq_device='))!;
  const resumed = await app.inject({ url: '/api/v1/me/memberships', headers: fresh });
  assert.equal(resumed.statusCode, 200, resumed.body);
  assert.deepEqual(
    resumed.json().cards.map((card: { id: string }) => card.id),
    [memberA],
  );
  const notices = (await app.inject({ url: '/api/v1/me/device-notices', headers: original })).json()
    .notices;
  assert.equal(notices[0].kind, 'card_number_login');
  assert.equal(notices[0].canRemove, true);
});

const cardNumberLogin = (
  headers: H,
  cardNumber: string,
  remoteAddress = '192.0.2.' + (ip++ % 250),
) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/customer/card-number-login',
    headers,
    remoteAddress,
    payload: { cardNumber },
  });

test('card number failures are generic and attempts are limited per device, IP, and across IPs', async () => {
  const fresh = await device();
  const missing = (
    await db.query(
      `SELECT lpad(n::text,6,'0') AS number FROM generate_series(0,99999) n
       WHERE NOT EXISTS(SELECT 1 FROM membership_card_numbers WHERE card_number=lpad(n::text,6,'0'))
       LIMIT 1`,
    )
  ).rows[0].number as string;
  for (const number of ['bad', missing, missing]) {
    const failure = await cardNumberLogin(fresh, number);
    assert.equal(failure.statusCode, 401);
    assert.equal(failure.json().error.code, 'CARD_NUMBER_INVALID');
  }
  assert.equal((await cardNumberLogin(fresh, missing)).statusCode, 429);
  const fixedIp = '192.0.2.254';
  for (let i = 0; i < 3; i++)
    assert.equal((await cardNumberLogin(await device(), missing, fixedIp)).statusCode, 401);
  assert.equal((await cardNumberLogin(await device(), missing, fixedIp)).statusCode, 429);
  const budget = createHmac('sha256', c.AUTH_PEPPER)
    .update('card-number-global-failures')
    .digest('hex');
  await db.query(
    'UPDATE customer_auth_limits SET attempts=29, window_started_at=clock_timestamp() WHERE key_hash=$1',
    [budget],
  );
  try {
    assert.equal((await cardNumberLogin(await device(), missing)).statusCode, 401);
    assert.equal((await cardNumberLogin(await device(), missing)).statusCode, 429);
  } finally {
    await db.query('DELETE FROM customer_auth_limits WHERE key_hash=$1', [budget]);
  }
});

test('a pass never shows its restore key as text', async () => {
  const { passJson, texts } = await import('../../apps/api/src/wallet/apple-pass.js');
  const { withOpenUrl } = await import('../../apps/api/src/wallet/restore.js');
  const card = withOpenUrl(
    {
      id: '6f3a1c55-0000-4000-8000-000000000001',
      merchant_id: A.m,
      merchant_name: 'Bunn',
      program_name: 'Coffee',
      threshold: 6,
      display_balance: 2,
      pending_rewards: 0,
      primary_color: '#6F3F22',
      accent_color: '#E2A85B',
      stamp_shape: 'circle',
      stamp_icon: 'coffee',
      stamp_style: 'solid',
      reward_title: 'Coffee',
      reward_terms: 'One drink',
      active: true,
      earning_active: true,
      restore_generation: 3,
    } as Parameters<typeof passJson>[0],
    origin,
    c.AUTH_PEPPER,
  );
  const key = card.open_url.split('?w=')[1]!;
  const json = JSON.stringify(
    passJson(card, {
      serial: 's',
      authToken: 't',
      origin,
      signer: { passTypeIdentifier: 'p', teamIdentifier: 't' } as never,
    }),
  );
  assert.ok(!json.includes(key), 'the key is not in pass.json');
  const ar = texts(card).ar as Record<string, string>;
  assert.ok(ar.open_link!.includes(key.replaceAll('.', '.')), 'the link lives in the strings file');
  assert.ok(!/>[^<]*\?w=/.test(ar.open_link!), 'the visible text is not the URL');
  assert.ok(ar.security_3, 'a used key shows the new-phone line');
});

const staffAt = async (s: Shop) =>
  login(app, s === A ? 'owner@bunn.test' : 'owner@lamsa.test', origin);
async function startPairing(d: H, s: Shop, number?: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/customer/pairings',
    headers: d,
    remoteAddress: '192.0.2.' + (ip++ % 250),
    payload: { merchantId: s.m, ...(number ? { phone: number } : {}) },
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json() as { id: string; code: string; status: string };
}
async function consume(d: H, id: string) {
  const r = await app.inject({
    method: 'POST',
    url: '/api/v1/customer/pairings/' + id + '/consume',
    headers: d,
    payload: {},
  });
  if (r.statusCode === 200) {
    d.cookie = merge(d.cookie, r);
    d['x-csrf-token'] = r.json().csrfToken;
  }
  return r;
}
const joinClaim = (staff: H, s: Shop, number: string, code: string) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + s.m + '/customer-pairings/join',
    headers: staff,
    payload: { branchId: s.b, phone: number, code },
  });
async function enroll(d: H, s: Shop) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...d, 'idempotency-key': crypto.randomUUID() },
    payload: {
      merchantId: s.m,
      programId: s.p,
      programVersionId: s.v,
      branchId: s.b,
      acceptedTerms: true,
      acceptedTermsHash: s.terms,
      acceptedPrivacyVersion: notice.acceptance.version,
      acceptedPrivacyHash: notice.acceptance.hash,
      acceptedPrivacyLocale: notice.locale,
      source: 'qr',
      alias: 'Holder',
    },
  });
}
const shopsOn = async (d: H) =>
  (
    (await app.inject({ url: '/api/v1/me/memberships', headers: d })).json().cards as {
      merchant_id: string;
    }[]
  )
    .map((x) => x.merchant_id)
    .sort();

test('a number already on Perks joins a new shop from a new phone with the code the cashier enters', async () => {
  const number = phone(),
    old = await device();
  assert.equal((await register(old, number, A)).statusCode, 200);
  const fresh = await device();
  assert.equal((await register(fresh, number, B)).json().error.code, 'CUSTOMER_PHONE_EXISTS');
  const pairing = await startPairing(fresh, B, number);
  const staff = await staffAt(B);
  // The new shop learns nothing from the number alone.
  const search = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + B.m + '/customer-recovery/search',
    headers: staff,
    payload: { phone: number, branchId: B.b },
  });
  assert.equal(search.json().customer, null);
  // Wrong number or wrong code: the same answer.
  const other = phone();
  assert.equal(
    (await joinClaim(staff, B, other, pairing.code)).json().error.code,
    'PAIRING_CODE_INVALID',
  );
  const wrongCode = pairing.code === '000000' ? '000001' : '000000';
  assert.equal(
    (await joinClaim(staff, B, number, wrongCode)).json().error.code,
    'PAIRING_CODE_INVALID',
  );
  const claimed = await joinClaim(staff, B, number, pairing.code);
  assert.equal(claimed.statusCode, 200, claimed.body);
  assert.equal(claimed.json().status, 'approved');
  assert.equal((await consume(fresh, pairing.id)).statusCode, 200);
  const joined = await enroll(fresh, B);
  assert.equal(joined.statusCode, 200, joined.body);
  // This phone sees the new shop's card, not the cards of other shops.
  assert.deepEqual(await shopsOn(fresh), [B.m]);
  // The customer's own phone sees both, and is told about the new phone.
  assert.deepEqual(await shopsOn(old), [A.m, B.m].sort());
  const notices = (await app.inject({ url: '/api/v1/me/device-notices', headers: old })).json()
    .notices;
  assert.equal(notices[0].kind, 'device_paired');
});

test('a join is refused where the customer already has a card: that card needs a recovery', async () => {
  const number = phone(),
    old = await device();
  assert.equal((await register(old, number, A)).statusCode, 200);
  const fresh = await device();
  const pairing = await startPairing(fresh, A, number);
  const claimed = await joinClaim(await staffAt(A), A, number, pairing.code);
  assert.equal(claimed.json().error.code, 'CUSTOMER_HAS_CARD_HERE');
});

test('a phone restored by one shop adds shops where the customer has no card, never one where they do', async () => {
  const owner = await staffAt(A);
  async function pairedAtA(number: string) {
    const d = await device();
    const pairing = await startPairing(d, A);
    const uid = (
      await db.query('SELECT customer_id FROM customer_identities WHERE phone_e164=$1', [
        '+2' + number,
      ])
    ).rows[0].customer_id;
    const claim = await app.inject({
      method: 'POST',
      url: '/api/v1/merchants/' + A.m + '/customer-pairings',
      headers: owner,
      payload: { customerId: uid, branchId: A.b, code: pairing.code, requestedByCustomer: true },
    });
    assert.equal(claim.statusCode, 200, claim.body);
    assert.equal((await consume(d, pairing.id)).statusCode, 200);
    return d;
  }
  // Only a card at A: the restored phone may start a card at B.
  const onlyA = phone();
  assert.equal((await register(await device(), onlyA, A)).statusCode, 200);
  const restored = await pairedAtA(onlyA);
  const added = await enroll(restored, B);
  assert.equal(added.statusCode, 200, added.body);
  assert.deepEqual(await shopsOn(restored), [A.m, B.m].sort());
  // Cards at A and B: the phone restored at A cannot open the card at B.
  const both = phone(),
    own = await device();
  assert.equal((await register(own, both, A)).statusCode, 200);
  assert.equal((await register(own, both, B)).statusCode, 200);
  const limited = await pairedAtA(both);
  assert.equal(
    (await register(limited, both, B)).json().error.code,
    'DEVICE_SCOPE_RECOVERY_REQUIRED',
  );
  assert.equal((await enroll(limited, B)).json().error.code, 'DEVICE_SCOPE_RECOVERY_REQUIRED');
  assert.deepEqual(await shopsOn(limited), [A.m]);
});

test('an admin frees a number someone else registered; its owner can then register', async () => {
  const { adminLogin } = await import('../helpers.js');
  const number = phone();
  assert.equal((await register(await device(), number, A, 'Not the owner')).statusCode, 200);
  const owner = await device();
  assert.equal(
    (await register(owner, number, B, 'Owner')).json().error.code,
    'CUSTOMER_PHONE_EXISTS',
  );
  const admin = await adminLogin(app, db, origin);
  const release = (reason: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/platform/customer-phones/release',
      headers: admin,
      payload: { phone: number, reason },
    });
  assert.equal((await release('short')).statusCode, 422, 'a reason is required');
  const released = await release('Owner messaged support on WhatsApp from this number');
  assert.equal(released.statusCode, 200, released.body);
  assert.deepEqual(released.json(), { released: true, shops: 1 });
  assert.equal((await register(owner, number, B, 'Owner')).statusCode, 200);
  // Shops no longer see the number on the other person's card.
  const contacts = (
    await db.query(
      "SELECT count(*)::int AS n FROM tenant_customer_profiles WHERE contact_phone=$1 AND alias='Not the owner'",
      ['+2' + number],
    )
  ).rows[0].n;
  assert.equal(contacts, 0);
  // Staff cannot do this.
  const staff = await login(app, 'owner@bunn.test', origin);
  const refused = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/customer-phones/release',
    headers: staff,
    payload: { phone: number, reason: 'Trying to take a number' },
  });
  assert.equal(refused.statusCode, 403);
});
