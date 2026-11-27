import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { adminLogin, key, login } from '../helpers.js';
import { unseal } from '../../apps/api/src/outbox.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
const { app } = await buildApp({
  APP_ENV: 'test',
  LOG_LEVEL: 'silent',
  ONBOARDING_INSTAPAY_ADDRESS: 'perks-test@instapay',
});
let pa: Awaited<ReturnType<typeof login>>;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  pa = await adminLogin(app, db);
});
after(async () => {
  await app.close();
  await db.end();
});
const signupRequest = (email: string) => ({
  method: 'POST' as const,
  url: '/api/v1/auth/merchant-signup',
  payload: { email, name: 'New merchant', locale: 'en' as const },
});
const codeMails = async (email: string) =>
  (
    await db.query(
      `SELECT o.payload FROM auth_mail_outbox o JOIN users u ON u.id=o.user_id
       WHERE u.email=$1 AND o.kind='email_verification' ORDER BY o.created_at`,
      [email],
    )
  ).rows;
const emailedCode = async (email: string) => {
  const mails = await codeMails(email);
  return unseal(mails.at(-1)!.payload.encryptedCode, c.AUTH_PEPPER);
};
let shade = 0;
/** A receipt image no other order has sent (the same file cannot pay twice). */
const freshImage = async () => {
  const { default: sharp } = await import('sharp');
  shade += 1;
  return (
    await sharp({
      create: {
        width: 12,
        height: 12,
        channels: 3,
        background: { r: shade % 256, g: Math.floor(shade / 256) % 256, b: 200 },
      },
    })
      .png()
      .toBuffer()
  ).toString('base64');
};
test('a new merchant verifies their email, sets a password and signs in to their draft', async () => {
  const origin = c.PUBLIC_APP_ORIGIN;
  const email = 'signup-' + randomUUID() + '@example.test';
  const password = 'Test-merchant-password-12';
  const signup = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/merchant-signup',
    headers: { origin },
    payload: { email, name: 'New merchant', locale: 'en' },
  });
  assert.equal(signup.statusCode, 202, signup.body);
  const code = await emailedCode(email);
  // The code is stored only as a keyed hash, never in the clear.
  const stored = (
    await db.query(
      'SELECT v.code_hash FROM email_verification_codes v JOIN users u ON u.id=v.user_id WHERE u.email=$1',
      [email],
    )
  ).rows;
  assert.equal(stored.length, 1);
  assert.notEqual(stored[0].code_hash, code);
  // A second request inside the minute sends no second code.
  await app.inject({ ...signupRequest(email), headers: { origin } });
  assert.equal((await codeMails(email)).length, 1);
  const verifyUrl = '/api/v1/auth/merchant-signup/verify';
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, '0');
  const bad = await app.inject({
    method: 'POST',
    url: verifyUrl,
    headers: { origin },
    payload: { email, code: wrong },
  });
  assert.equal(bad.statusCode, 400, bad.body);
  assert.equal(bad.json().error.code, 'VERIFICATION_CODE_INVALID');
  // An address with no pending sign-up answers exactly like a wrong code.
  const unknown = await app.inject({
    method: 'POST',
    url: verifyUrl,
    headers: { origin },
    payload: { email: 'nobody-' + randomUUID() + '@example.test', code },
  });
  assert.equal(unknown.statusCode, 400);
  assert.equal(unknown.json().error.code, 'VERIFICATION_CODE_INVALID');
  // No password can be set before the address is verified.
  assert.equal(
    (await db.query('SELECT email_verified_at,password_hash FROM users WHERE email=$1', [email]))
      .rows[0].email_verified_at,
    null,
  );
  const verified = await app.inject({
    method: 'POST',
    url: verifyUrl,
    headers: { origin },
    payload: { email, code },
  });
  assert.equal(verified.statusCode, 200, verified.body);
  assert.ok(
    (await db.query('SELECT email_verified_at FROM users WHERE email=$1', [email])).rows[0]
      .email_verified_at,
  );
  // A code works once.
  const replay = await app.inject({
    method: 'POST',
    url: verifyUrl,
    headers: { origin },
    payload: { email, code },
  });
  assert.equal(replay.statusCode, 400);
  const reset = {
    method: 'POST' as const,
    url: '/api/v1/auth/password/reset',
    headers: { origin },
    payload: { token: verified.json().passwordToken, password },
  };
  const confirmed = await app.inject(reset);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.json().onboarding, true);
  // The emailed link proves the address: the new owner is signed in and lands on their setup.
  assert.ok(confirmed.json().csrfToken);
  const fresh = await app.inject({
    url: '/api/v1/session',
    headers: { cookie: confirmed.cookies.map(({ name, value }) => name + '=' + value).join('; ') },
  });
  assert.equal(fresh.statusCode, 200, fresh.body);
  assert.equal(fresh.json().onboarding, true);
  assert.deepEqual(fresh.json().grants, []);
  // Welcome mail follows the first password, without a password link.
  const welcome = (
    await db.query(
      `SELECT o.payload,o.reset_token_id FROM auth_mail_outbox o JOIN users u ON u.id=o.user_id
       WHERE u.email=$1 AND o.kind='merchant_welcome'`,
      [email],
    )
  ).rows;
  assert.deepEqual(welcome, [{ payload: {}, reset_token_id: null }]);
  assert.equal((await app.inject(reset)).statusCode, 410);
  const signedIn = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin },
    payload: { email, password },
  });
  assert.equal(signedIn.statusCode, 200, signedIn.body);
  assert.equal(signedIn.json().portal, 'merchant');
  const draft = await app.inject({
    url: '/api/v1/merchant-onboarding/draft',
    headers: { cookie: signedIn.cookies.map(({ name, value }) => name + '=' + value).join('; ') },
  });
  assert.equal(draft.statusCode, 200, draft.body);
  assert.ok(draft.json().draft.id);
  // An owner without a shop yet cannot read the plans table: the order still names its plan.
  const owner = {
    cookie: signedIn.cookies.map(({ name, value }) => name + '=' + value).join('; '),
    origin,
    'x-csrf-token': signedIn.json().csrfToken,
  };
  const quoted = await app.inject({
    method: 'POST',
    url: '/api/v1/merchant-onboarding/order',
    headers: owner,
    payload: { planKey: 'growth' },
  });
  assert.equal(quoted.statusCode, 200, quoted.body);
  assert.equal(quoted.json().order.plan_key, 'growth');
  const resumed = await app.inject({ url: '/api/v1/merchant-onboarding/order', headers: owner });
  assert.equal(resumed.json().order?.id, quoted.json().order.id);
  assert.equal(resumed.json().order.plan_key, 'growth');
});
test('a signed-in shop owner can resume and update only their own onboarding draft', async () => {
  const url = '/api/v1/merchant-onboarding/draft';
  const owner = await login(app, 'owner@bunn.test');
  const anonymous = await app.inject({ url });
  assert.equal(anonymous.statusCode, 401);

  const created = await app.inject({ method: 'POST', url, headers: owner });
  assert.equal(created.statusCode, 200, created.body);
  const { draft } = created.json();
  const repeated = await app.inject({ method: 'POST', url, headers: owner });
  assert.equal(repeated.json().draft.id, draft.id);

  const change = {
    method: 'PATCH' as const,
    url,
    headers: owner,
    payload: {
      name: 'Onboarding café',
      revision: draft.revision,
    },
  };
  const saved = await app.inject(change);
  assert.equal(saved.statusCode, 200, saved.body);
  assert.equal(saved.json().draft.details.name, change.payload.name);
  const resumed = await app.inject({ url, headers: owner });
  assert.deepEqual(resumed.json().draft, { ...saved.json().draft, rejection_reason: null });
  const setup = {
    branchName: 'Downtown',
    branchAddress: '12 Main Street',
    rewardTitle: 'Free coffee',
    threshold: 6,
    cardColor: '#173d37',
  };
  const setupChange = {
    ...change,
    payload: { ...change.payload, revision: saved.json().draft.revision, setup },
  };
  const invalidSetup = await app.inject({
    ...setupChange,
    payload: { ...setupChange.payload, setup: { ...setup, threshold: 51 } },
  });
  assert.equal(invalidSetup.statusCode, 422);
  const savedSetup = await app.inject(setupChange);
  assert.equal(savedSetup.statusCode, 200, savedSetup.body);
  assert.deepEqual((await app.inject({ url, headers: owner })).json().draft.details.setup, setup);
  assert.equal((await app.inject(change)).statusCode, 409);
  assert.equal((await app.inject({ url, headers: pa })).json().draft, null);
});
test('onboarding orders quote the server catalog and reuse a quote on retry', async () => {
  const headers = await login(app, 'owner@bunn.test');
  const catalog = await app.inject({ url: '/api/v1/merchant-onboarding/plans', headers });
  assert.equal(catalog.statusCode, 200, catalog.body);
  // Self-service plans are the landing page monthly prices, and only the plans publishing accepts.
  const { publicPlanCatalog } = await import('../../packages/contracts/src/plan-catalog.js');
  const plans = catalog.json().plans as { plan_key: string; amount_minor: number }[];
  assert.deepEqual(
    plans.map((plan) => plan.plan_key),
    ['starter', 'growth', 'pro'],
  );
  for (const plan of plans) {
    const listed = publicPlanCatalog.find((entry) => entry.key === plan.plan_key);
    assert.equal(plan.amount_minor, (listed?.monthlyPrice ?? 0) * 100, plan.plan_key);
  }
  const scale = await app.inject({
    method: 'POST',
    url: '/api/v1/merchant-onboarding/order',
    headers,
    payload: { planKey: 'scale' },
  });
  assert.equal(scale.statusCode, 404, scale.body);
  const plan = plans[0]!;
  assert.ok(plan.amount_minor > 0);
  const request = {
    method: 'POST' as const,
    url: '/api/v1/merchant-onboarding/order',
    headers,
    payload: { planKey: plan.plan_key },
  };
  const results = await Promise.all([app.inject(request), app.inject(request)]);
  for (const result of results) assert.equal(result.statusCode, 200, result.body);
  assert.deepEqual(results[0].json(), results[1].json());
  assert.equal(results[0].json().order.amount_minor, plan.amount_minor);
  assert.equal(results[0].json().order.recipient_account, 'perks-test@instapay');
  const id = results[0].json().order.id;
  const { default: sharp } = await import('sharp');
  const image = await sharp({
    create: { width: 12, height: 12, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer();
  const uploaded = await app.inject({
    method: 'POST',
    url: request.url + '/' + id + '/receipt',
    headers,
    payload: { reference: 'ORDER-123', image: image.toString('base64') },
  });
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  assert.equal(uploaded.json().order.submitted_reference, 'ORDER-123');
  // Sending the receipt again replaces it; admins are not mailed a second time for the order.
  const reuploaded = await app.inject({
    method: 'POST',
    url: request.url + '/' + id + '/receipt',
    headers,
    payload: { reference: 'ORDER-123', image: image.toString('base64') },
  });
  assert.equal(reuploaded.statusCode, 200, reuploaded.body);
  const reviewPath = '/api/v1/platform/onboarding-payments';
  assert.equal((await app.inject({ url: reviewPath, headers })).statusCode, 403);
  const queue = await app.inject({ url: reviewPath, headers: pa });
  assert.equal(queue.statusCode, 200, queue.body);
  const queued = queue.json().orders.find((row: { id: string }) => row.id === id);
  assert.ok(queued);
  // The reviewer sees who is paying for what, when, and whether the shop is live yet.
  assert.equal(queued.plan_key, plan.plan_key);
  assert.equal(queued.owner_email, 'owner@bunn.test');
  assert.equal(queued.live, false);
  assert.equal(queued.correction, false);
  assert.ok(Date.parse(queued.receipt_submitted_at) > 0);
  const receipt = await app.inject({
    url: reviewPath + '/' + id + '/receipt?version=' + queued.receipt_key,
    headers: pa,
  });
  assert.equal(receipt.statusCode, 200, receipt.body);
  assert.equal(receipt.headers['content-type'], 'image/png');
  const draftUrl = '/api/v1/merchant-onboarding/draft';
  const beforeLogo = (await app.inject({ url: draftUrl, headers })).json().draft;
  const logoUrl = draftUrl + '/' + beforeLogo.id + '/logo';
  const uploadedLogo = await app.inject({
    method: 'POST',
    url: logoUrl,
    headers,
    payload: { image: image.toString('base64'), revision: beforeLogo.revision },
  });
  assert.equal(uploadedLogo.statusCode, 200, uploadedLogo.body);
  const draft = uploadedLogo.json().draft;
  assert.ok(draft.logo_id);
  assert.equal((await app.inject({ url: logoUrl, headers })).headers['content-type'], 'image/png');
  assert.equal((await app.inject({ url: logoUrl, headers: pa })).statusCode, 404);
  const publish = {
    method: 'POST' as const,
    url: draftUrl + '/' + draft.id + '/publish',
    headers,
    payload: { revision: draft.revision },
  };
  const published = await app.inject(publish);
  assert.equal(published.statusCode, 200, published.body);
  assert.deepEqual((await app.inject(publish)).json(), published.json());
  const publication = published.json().publication;
  const publicLogo = await app.inject({
    url: '/api/v1/public/merchants/' + publication.merchantId + '/logos/' + draft.logo_id,
  });
  assert.equal(publicLogo.statusCode, 200, publicLogo.body);
  assert.equal(publicLogo.headers['content-type'], 'image/png');
  const refreshedSession = await app.inject({ url: '/api/v1/session', headers });
  assert.equal(
    refreshedSession
      .json()
      .grants.find((grant: { merchant_id: string }) => grant.merchant_id === publication.merchantId)
      ?.logo_asset_id,
    draft.logo_id,
  );
  const placement = await db.query('SELECT resolve_placement($1) AS value', [publication.code]);
  assert.equal(placement.rows[0].value.status, 'active');
  const confirmation = {
    method: 'POST' as const,
    url: reviewPath + '/' + id + '/confirm',
    headers: pa,
    payload: {
      reference: 'ORDER-123',
      receiptKey: queued.receipt_key,
      amountMinor: plan.amount_minor,
      recipientAccountId: queued.recipient_account,
    },
  };
  const confirmed = await app.inject(confirmation);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal((await app.inject(confirmation)).statusCode, 200);
  const ledger = await db.query(
    'SELECT amount_minor,payment_reference FROM subscription_payments WHERE merchant_id=$1',
    [publication.merchantId],
  );
  assert.deepEqual(ledger.rows, [
    { amount_minor: plan.amount_minor, payment_reference: 'ORDER-123' },
  ]);
  // Every platform admin hears about the receipt; the owner hears that it was confirmed, once.
  const mailFor = async (kind: string, key: string) =>
    (
      await db.query(
        `SELECT u.email,o.payload FROM auth_mail_outbox o JOIN users u ON u.id=o.user_id
         WHERE o.kind=$1 AND o.dedupe_key LIKE $2 ORDER BY u.email`,
        [kind, key],
      )
    ).rows;
  const admins = (
    await db.query(
      "SELECT email FROM users WHERE global_role='platform_admin' AND status='active' AND email IS NOT NULL ORDER BY email",
    )
  ).rows.map((row) => row.email);
  assert.ok(admins.length > 0);
  assert.deepEqual(
    (await mailFor('onboarding_receipt_submitted', `onboarding-receipt:${id}:%`)).map(
      (row) => row.email,
    ),
    admins,
  );
  assert.deepEqual(await mailFor('onboarding_payment_confirmed', `onboarding-confirmed:${id}`), [
    {
      email: 'owner@bunn.test',
      payload: { shopName: draft.details.name, live: true, renewal: false },
    },
  ]);

  const newDraft = (await app.inject({ method: 'POST', url: draftUrl, headers })).json().draft;
  const newSetup = await app.inject({
    method: 'PATCH',
    url: draftUrl,
    headers,
    payload: { name: 'Second café', setup: draft.details.setup, revision: newDraft.revision },
  });
  assert.equal(newSetup.statusCode, 200, newSetup.body);
  const secondOrder = (await app.inject(request)).json().order;
  const secondReceipt = await app.inject({
    method: 'POST',
    url: request.url + '/' + secondOrder.id + '/receipt',
    headers,
    payload: { reference: 'ORDER-456', image: await freshImage() },
  });
  assert.equal(secondReceipt.statusCode, 200, secondReceipt.body);
  const secondPublished = await app.inject({
    ...publish,
    url: draftUrl + '/' + newDraft.id + '/publish',
    payload: { revision: newSetup.json().draft.revision },
  });
  assert.equal(secondPublished.statusCode, 200, secondPublished.body);
  const pending = (await app.inject({ url: reviewPath, headers: pa })).json().orders;
  const secondReview = pending.find((row: { id: string }) => row.id === secondOrder.id);
  const rejected = await app.inject({
    method: 'POST',
    url: reviewPath + '/' + secondOrder.id + '/reject',
    headers: pa,
    payload: { receiptKey: secondReview.receipt_key, reason: 'Transfer not received' },
  });
  assert.equal(rejected.statusCode, 200, rejected.body);
  assert.deepEqual(
    await mailFor('onboarding_payment_rejected', `onboarding-rejected:${secondOrder.id}`),
    [
      {
        email: 'owner@bunn.test',
        payload: {
          shopName: 'Second café',
          reason: 'Transfer not received',
          suspended: true,
          renewal: false,
        },
      },
    ],
  );
  const stopped = await db.query('SELECT resolve_placement($1) AS value', [
    secondPublished.json().publication.code,
  ]);
  assert.equal(stopped.rows[0].value.status, 'unavailable');
  const suspendedDraft = (await app.inject({ url: draftUrl, headers })).json().draft;
  assert.equal(suspendedDraft.rejection_reason, 'Transfer not received');
  // An open draft for another shop must not hide the paused one from its own notice.
  const pausedId = secondPublished.json().publication.merchantId;
  await app.inject({ method: 'POST', url: draftUrl, headers });
  assert.equal((await app.inject({ url: draftUrl, headers })).json().draft.publication, null);
  const paused = (await app.inject({ url: draftUrl + '?merchantId=' + pausedId, headers })).json()
    .draft;
  assert.equal(paused.publication.merchantId, pausedId);
  assert.equal(paused.rejection_reason, 'Transfer not received');
  const correction = await app.inject({
    method: 'POST',
    url: draftUrl + '/' + newDraft.id + '/correction',
    headers,
  });
  assert.equal(correction.statusCode, 200, correction.body);
  const correctedOrder = correction.json().order;
  const corrected = await app.inject({
    method: 'POST',
    url: request.url + '/' + correctedOrder.id + '/receipt',
    headers,
    payload: { reference: 'ORDER-789', image: await freshImage() },
  });
  assert.equal(corrected.statusCode, 200, corrected.body);
  const corrections = (await app.inject({ url: reviewPath, headers: pa })).json().orders;
  const correctionReview = corrections.find((row: { id: string }) => row.id === correctedOrder.id);
  // The shop is paused while the correction waits: the reviewer must not see it as live.
  assert.equal(correctionReview.correction, true);
  assert.equal(correctionReview.live, false);
  const approvedCorrection = await app.inject({
    ...confirmation,
    url: reviewPath + '/' + correctedOrder.id + '/confirm',
    payload: {
      ...confirmation.payload,
      receiptKey: correctionReview.receipt_key,
      reference: 'ORDER-789',
    },
  });
  assert.equal(approvedCorrection.statusCode, 200, approvedCorrection.body);
  const restored = (await app.inject({ url: draftUrl + '?merchantId=' + pausedId, headers })).json()
    .draft;
  assert.deepEqual(restored.publication, secondPublished.json().publication);
  assert.equal(restored.rejection_reason, null);
  const reopened = await db.query('SELECT resolve_placement($1) AS value', [
    restored.publication.code,
  ]);
  assert.equal(reopened.rows[0].value.status, 'active');
});
/** Signs up a new shop owner through the emailed code and returns their signed-in headers. */
async function newOwner() {
  const origin = c.PUBLIC_APP_ORIGIN;
  const email = 'owner-' + randomUUID() + '@example.test';
  assert.equal(
    (await app.inject({ ...signupRequest(email), headers: { origin } })).statusCode,
    202,
  );
  const verified = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/merchant-signup/verify',
    headers: { origin },
    payload: { email, code: await emailedCode(email) },
  });
  assert.equal(verified.statusCode, 200, verified.body);
  const signedIn = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/password/reset',
    headers: { origin },
    payload: { token: verified.json().passwordToken, password: 'Test-merchant-password-12' },
  });
  assert.equal(signedIn.statusCode, 200, signedIn.body);
  return {
    email,
    headers: {
      cookie: signedIn.cookies.map(({ name, value }) => name + '=' + value).join('; '),
      origin,
      'x-csrf-token': signedIn.json().csrfToken as string,
    },
  };
}
const draftUrl = '/api/v1/merchant-onboarding/draft';
const orderUrl = '/api/v1/merchant-onboarding/order';
const reviewUrl = '/api/v1/platform/onboarding-payments';
const shopSetup = {
  branchName: 'Downtown',
  branchAddress: '12 Main Street',
  rewardTitle: 'Free coffee',
  threshold: 6,
  cardColor: '#173d37',
};
/** Fills a draft for the owner and quotes the growth plan. */
async function readyDraft(headers: Record<string, string>, name: string) {
  const created = (await app.inject({ method: 'POST', url: draftUrl, headers })).json().draft;
  const saved = await app.inject({
    method: 'PATCH',
    url: draftUrl,
    headers,
    payload: { name, setup: shopSetup, revision: created.revision },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const order = await app.inject({
    method: 'POST',
    url: orderUrl,
    headers,
    payload: { planKey: 'growth' },
  });
  assert.equal(order.statusCode, 200, order.body);
  return { draft: saved.json().draft, order: order.json().order };
}
const sendReceipt = async (
  headers: Record<string, string>,
  orderId: string,
  reference: string,
  image?: string,
) =>
  app.inject({
    method: 'POST',
    url: orderUrl + '/' + orderId + '/receipt',
    headers,
    payload: { reference, image: image ?? (await freshImage()) },
  });
const publishDraft = (headers: Record<string, string>, draft: { id: string; revision: number }) =>
  app.inject({
    method: 'POST',
    url: draftUrl + '/' + draft.id + '/publish',
    headers,
    payload: { revision: draft.revision },
  });
const reviewRow = async (status: string, id: string) => {
  const list = await app.inject({ url: reviewUrl + '?status=' + status, headers: pa });
  assert.equal(list.statusCode, 200, list.body);
  return list.json().orders.find((row: { id: string }) => row.id === id);
};

test('a transfer activates the shop at once; the review verifies or pauses it, and renewals follow the same rules', async () => {
  const a = await newOwner();
  const first = await readyDraft(a.headers, 'Instant café');
  const imageA = await freshImage();
  const reference = 'IPN-' + randomUUID().slice(0, 8);
  assert.equal((await sendReceipt(a.headers, first.order.id, reference, imageA)).statusCode, 200);
  const published = await publishDraft(a.headers, first.draft);
  assert.equal(published.statusCode, 200, published.body);
  const merchantId = published.json().publication.merchantId;
  // Live straight away: the subscription is active and its period started at activation.
  const live = await db.query(
    `SELECT m.status,s.status AS sub,s.current_period_start,s.current_period_end,o.period_start,o.period_end
     FROM merchants m JOIN merchant_subscriptions s ON s.merchant_id=m.id
     JOIN merchant_onboarding_orders o ON o.id=$2 WHERE m.id=$1`,
    [merchantId, first.order.id],
  );
  assert.equal(live.rows[0].status, 'active');
  assert.equal(live.rows[0].sub, 'active');
  assert.equal(live.rows[0].period_start.getTime(), live.rows[0].current_period_start.getTime());
  const billingUrl = '/api/v1/merchant-onboarding/billing?merchantId=' + merchantId;
  const pending = (await app.inject({ url: billingUrl, headers: a.headers })).json().billing;
  assert.equal(pending.paymentStatus, 'pending_review');
  assert.equal(pending.renewal, 'blocked');
  // Another owner cannot read this shop's billing.
  const b = await newOwner();
  assert.equal((await app.inject({ url: billingUrl, headers: b.headers })).json().billing, null);

  // The same transaction number (spelled differently) or the same receipt cannot pay again.
  const second = await readyDraft(b.headers, 'Copycat café');
  const reusedRef = await sendReceipt(b.headers, second.order.id, ' ' + reference.toLowerCase());
  assert.equal(reusedRef.statusCode, 409, reusedRef.body);
  assert.equal(reusedRef.json().error.code, 'ONBOARDING_TRANSFER_REUSED');
  const reusedImage = await sendReceipt(b.headers, second.order.id, 'IPN-other-1', imageA);
  assert.equal(reusedImage.json().error.code, 'ONBOARDING_TRANSFER_REUSED');
  assert.equal((await sendReceipt(b.headers, second.order.id, 'IPN-other-2')).statusCode, 200);

  // Admin filter: live shops whose transfer is still under review.
  const queued = await reviewRow('live', first.order.id);
  assert.ok(queued);
  assert.equal(queued.payment_status, 'pending_review');
  assert.equal(queued.purpose, 'activation');
  assert.equal(await reviewRow('live', second.order.id), undefined);
  assert.ok(await reviewRow('pending', second.order.id));
  const counts = (await app.inject({ url: reviewUrl, headers: pa })).json().counts;
  assert.ok(counts.live >= 1 && counts.pending >= counts.live);

  const confirmed = await app.inject({
    method: 'POST',
    url: reviewUrl + '/' + first.order.id + '/confirm',
    headers: pa,
    payload: {
      reference,
      receiptKey: queued.receipt_key,
      amountMinor: first.order.amount_minor,
      recipientAccountId: queued.recipient_account,
    },
  });
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  // Verifying changes no dates: the payment covers the period that began at activation.
  const after = await db.query(
    `SELECT s.current_period_start,s.current_period_end,p.starts_at,p.ends_at
     FROM merchant_subscriptions s JOIN subscription_payments p ON p.merchant_id=s.merchant_id
     WHERE s.merchant_id=$1`,
    [merchantId],
  );
  assert.equal(after.rows.length, 1);
  assert.equal(
    after.rows[0].current_period_end.getTime(),
    live.rows[0].current_period_end.getTime(),
  );
  assert.equal(after.rows[0].starts_at.getTime(), live.rows[0].period_start.getTime());
  assert.ok(await reviewRow('verified', first.order.id));
  const audit = await db.query(
    "SELECT action FROM audit_events WHERE target_id=$1 AND action LIKE 'merchant.onboarding.transfer_%' ORDER BY at",
    [first.order.id],
  );
  assert.deepEqual(
    audit.rows.map((row) => row.action),
    ['merchant.onboarding.transfer_submitted', 'merchant.onboarding.transfer_verified'],
  );

  // Renewal opens a week before the end, adds the month at once, and is reviewed afterwards.
  const renewalUrl = '/api/v1/merchant-onboarding/billing/renewal';
  const early = await app.inject({
    method: 'POST',
    url: renewalUrl,
    headers: a.headers,
    payload: { merchantId },
  });
  assert.equal(early.statusCode, 409, early.body);
  assert.equal(early.json().error.code, 'ONBOARDING_RENEWAL_TOO_EARLY');
  await db.query(
    "UPDATE merchant_subscriptions SET current_period_end=clock_timestamp()+interval '3 days' WHERE merchant_id=$1",
    [merchantId],
  );
  const opened = await app.inject({
    method: 'POST',
    url: renewalUrl,
    headers: a.headers,
    payload: { merchantId },
  });
  assert.equal(opened.statusCode, 200, opened.body);
  const renewal = opened.json().billing.openRenewal;
  assert.equal(renewal.amount_minor, first.order.amount_minor);
  const again = await app.inject({
    method: 'POST',
    url: renewalUrl,
    headers: a.headers,
    payload: { merchantId },
  });
  assert.equal(again.json().billing.openRenewal.id, renewal.id);
  const periodEnd = (
    await db.query('SELECT current_period_end FROM merchant_subscriptions WHERE merchant_id=$1', [
      merchantId,
    ])
  ).rows[0].current_period_end as Date;
  assert.equal(
    (await sendReceipt(a.headers, renewal.id, 'IPN-renew-' + randomUUID())).statusCode,
    200,
  );
  const extended = (
    await db.query('SELECT current_period_end FROM merchant_subscriptions WHERE merchant_id=$1', [
      merchantId,
    ])
  ).rows[0].current_period_end as Date;
  assert.equal(extended.getTime() - periodEnd.getTime(), 30 * 86_400_000);
  const renewing = (await app.inject({ url: billingUrl, headers: a.headers })).json().billing;
  assert.equal(renewing.paymentStatus, 'pending_review');
  assert.equal(renewing.purpose, 'renewal');
  // No second renewal can be stacked on an unverified one.
  const stacked = await app.inject({
    method: 'POST',
    url: renewalUrl,
    headers: a.headers,
    payload: { merchantId },
  });
  assert.equal(stacked.json().error.code, 'ONBOARDING_RENEWAL_BLOCKED');

  // A rejected renewal pauses the shop (data kept) and tells the owner why.
  const renewalRow = await reviewRow('pending', renewal.id);
  assert.equal(renewalRow.purpose, 'renewal');
  const rejected = await app.inject({
    method: 'POST',
    url: reviewUrl + '/' + renewal.id + '/reject',
    headers: pa,
    payload: { receiptKey: renewalRow.receipt_key, reason: 'No such transfer' },
  });
  assert.equal(rejected.statusCode, 200, rejected.body);
  const paused = await db.query(
    'SELECT m.status,(SELECT count(*)::int FROM programs p WHERE p.merchant_id=m.id) AS programs FROM merchants m WHERE m.id=$1',
    [merchantId],
  );
  assert.deepEqual(paused.rows[0], { status: 'suspended', programs: 1 });
  const rejectedBilling = (await app.inject({ url: billingUrl, headers: a.headers })).json()
    .billing;
  assert.equal(rejectedBilling.paymentStatus, 'rejected');
  assert.equal(rejectedBilling.rejectionReason, 'No such transfer');
  const rejectionMail = await db.query(
    "SELECT payload FROM auth_mail_outbox WHERE dedupe_key='onboarding-rejected:'||$1",
    [renewal.id],
  );
  assert.equal(rejectionMail.rows[0].payload.renewal, true);
  assert.ok(await reviewRow('rejected', renewal.id));

  // While that rejection stands, a new shop from the same owner waits for the admin.
  const third = await readyDraft(a.headers, 'Second try café');
  assert.equal(
    (await sendReceipt(a.headers, third.order.id, 'IPN-' + randomUUID())).statusCode,
    200,
  );
  const gated = await publishDraft(a.headers, third.draft);
  assert.equal(gated.statusCode, 409, gated.body);
  assert.equal(gated.json().error.code, 'ONBOARDING_REVIEW_REQUIRED');
});
test('non-admin cannot provision; admin must prove MFA', async () => {
  const owner = await login(app, 'owner@bunn.test');
  assert.equal(
    (await app.inject({ url: '/api/v1/platform/provisioning-drafts', headers: owner })).statusCode,
    403,
  );
  const adminNoMfa = await login(app, 'admin@nuqta.test');
  assert.equal(
    (await app.inject({ url: '/api/v1/platform/provisioning-drafts', headers: adminNoMfa }))
      .statusCode,
    403,
  );
});
test('draft revision and concurrent activation create one merchant, program, invitation set and outbox', async () => {
  const slug = 'test-' + randomUUID().slice(0, 8),
    ownerEmail = slug + '@example.test',
    cashEmail = 'cash-' + slug + '@example.test';
  const data = {
    name: 'قهوة الاختبار',
    slug,
    contactEmail: ownerEmail,
    timezone: 'Africa/Cairo',
    primaryColor: '#6F3F22',
    accentColor: '#E2A85B',
    surfaceColor: '#FBF5EE',
    template: 'classic',
    terms: 'شروط الاختبار محفوظة للعميل.',
    program: {
      name: 'قهوتك علينا',
      threshold: 5,
      maxPerTx: 3,
      rewardTitle: 'قهوة مجانية',
      rewardTerms: 'صالحة30يوم من الكسب.',
      validityDays: 30,
      endsAt: null,
    },
    branches: [
      { name: 'الفرع الأول', address: '' },
      { name: 'الفرع التاني', address: '' },
    ],
    staff: [
      { email: ownerEmail, role: 'owner', branchIndexes: [0, 1], maxQty: 3 },
      { email: cashEmail, role: 'cashier', branchIndexes: [0], maxQty: 2 },
    ],
    plan: 'growth',
  };
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/provisioning-drafts',
    headers: { ...pa, ...key() },
    payload: { data },
  });
  assert.equal(created.statusCode, 200);
  const draft = created.json().draft;
  const update = await app.inject({
    method: 'PATCH',
    url: '/api/v1/platform/provisioning-drafts/' + draft.id,
    headers: { ...pa, 'if-match': '1' },
    payload: { data },
  });
  assert.equal(update.statusCode, 200);
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: '/api/v1/platform/provisioning-drafts/' + draft.id,
        headers: { ...pa, 'if-match': '1' },
        payload: { data },
      })
    ).statusCode,
    409,
  );
  const results = await Promise.all(
    [1, 2].map(() =>
      app.inject({
        method: 'POST',
        url: '/api/v1/platform/provisioning-drafts/' + draft.id + '/activate',
        headers: { ...pa, ...key() },
        payload: { draftRevision: 2 },
      }),
    ),
  );
  assert.deepEqual(
    results.map((r) => r.statusCode),
    [200, 200],
  );
  const first = results[0]!.json(),
    second = results[1]!.json();
  assert.equal(first.merchant.id, second.merchant.id);
  assert.equal(first.operationId, second.operationId);
  assert.equal(
    Number((await db.query('SELECT count(*) FROM merchants WHERE slug=$1', [slug])).rows[0].count),
    1,
  );
  assert.equal(
    Number(
      (await db.query('SELECT count(*) FROM invitations WHERE merchant_id=$1', [first.merchant.id]))
        .rows[0].count,
    ),
    2,
  );
  assert.equal(
    Number(
      (
        await db.query('SELECT count(*) FROM outbox_events WHERE merchant_id=$1', [
          first.merchant.id,
        ])
      ).rows[0].count,
    ),
    2,
  );
  const invite = (
    await db.query("SELECT * FROM outbox_events WHERE merchant_id=$1 AND payload->>'email'=$2", [
      first.merchant.id,
      cashEmail,
    ])
  ).rows[0];
  const token = unseal(invite.payload.encryptedToken, c.AUTH_PEPPER);
  const cash = await login(app, cashEmail),
    foreign = await login(app, 'owner@lamsa.test');
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/invitations/' + token + '/accept',
        headers: foreign,
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/invitations/' + token + '/accept',
        headers: cash,
      })
    ).statusCode,
    200,
  );
  const session = (await app.inject({ url: '/api/v1/session', headers: cash })).json();
  assert.equal(session.grants[0].branches.length, 1);
  assert.equal(session.grants[0].branches[0].id, first.branches[0].id);
  const again = await app.inject({
    method: 'POST',
    url: '/api/v1/invitations/' + token + '/accept',
    headers: cash,
  });
  assert.equal(again.statusCode, 200);
  assert.equal(again.json().alreadyAccepted, true);
  const publicData = (await app.inject({ url: '/api/v1/public/merchants/' + slug })).json();
  assert.equal(publicData.programs[0].threshold, 5);
  assert.ok(!JSON.stringify(publicData).includes(ownerEmail));
  const ownerEvent = (
    await db.query(
      "SELECT payload FROM outbox_events WHERE merchant_id=$1 AND payload->>'email'=$2",
      [first.merchant.id, ownerEmail],
    )
  ).rows[0];
  const owner = await login(app, ownerEmail);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url:
          '/api/v1/invitations/' +
          unseal(ownerEvent.payload.encryptedToken, c.AUTH_PEPPER) +
          '/accept',
        headers: owner,
      })
    ).statusCode,
    200,
  );
  const inviteEmail = 'rotate-' + randomUUID() + '@nuqta.test',
    base = '/api/v1/merchants/' + first.merchant.id;
  const createdInvitation = await app.inject({
    method: 'POST',
    url: base + '/invitations',
    headers: { ...owner, ...key() },
    payload: { email: inviteEmail, role: 'cashier', branchIds: [first.branches[0].id], maxQty: 2 },
  });
  assert.equal(createdInvitation.statusCode, 200);
  const inviteId = createdInvitation.json().invitation.id;
  const initial = (
    await db.query(
      'SELECT payload FROM outbox_events WHERE aggregate_id=$1 ORDER BY aggregate_revision DESC LIMIT 1',
      [inviteId],
    )
  ).rows[0];
  const initialToken = unseal(initial.payload.encryptedToken, c.AUTH_PEPPER),
    invited = await login(app, inviteEmail);
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: base + '/invitations/' + inviteId + '/resend',
        headers: { ...owner, ...key() },
        payload: {},
      })
    ).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/invitations/' + initialToken + '/accept',
        headers: invited,
      })
    ).statusCode,
    404,
  );
  const rotated = (
    await db.query(
      'SELECT payload FROM outbox_events WHERE aggregate_id=$1 ORDER BY aggregate_revision DESC LIMIT 1',
      [inviteId],
    )
  ).rows[0];
  assert.equal(
    (await app.inject({ method: 'DELETE', url: base + '/invitations/' + inviteId, headers: owner }))
      .statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url:
          '/api/v1/invitations/' +
          unseal(rotated.payload.encryptedToken, c.AUTH_PEPPER) +
          '/accept',
        headers: invited,
      })
    ).statusCode,
    404,
  );
});
test('program version rows and committed operation receipts are immutable', async () => {
  await assert.rejects(
    () =>
      db.query('UPDATE program_versions SET threshold=10 WHERE id=$1', [
        '50000000-0000-4000-8000-000000000001',
      ]),
    /immutable/,
  );
  const op = (await db.query('SELECT id FROM operations LIMIT 1')).rows[0];
  if (op)
    await assert.rejects(
      () => db.query('UPDATE operations SET result=$1 WHERE id=$2', [{}, op.id]),
      /immutable/,
    );
  const owner = await login(app, 'owner@bunn.test');
  const foreignInvite = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantA + '/invitations',
    headers: { ...owner, ...key() },
    payload: {
      email: 'foreignbranch@example.test',
      role: 'cashier',
      branchIds: [ids.branchB],
      maxQty: 1,
    },
  });
  assert.equal(foreignInvite.statusCode, 403);
});

test('an unfinished draft can be deleted by its author; the merchant list shows the live plan and staff without the owner', async () => {
  const created = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/provisioning-drafts',
    headers: { ...pa, ...key() },
    payload: { data: { name: 'مسودة للمسح' } },
  });
  assert.equal(created.statusCode, 200);
  const id = created.json().draft.id;
  const removed = await app.inject({
    method: 'DELETE',
    url: '/api/v1/platform/provisioning-drafts/' + id,
    headers: pa,
  });
  assert.equal(removed.statusCode, 200);
  const again = await app.inject({
    method: 'DELETE',
    url: '/api/v1/platform/provisioning-drafts/' + id,
    headers: pa,
  });
  assert.equal(again.statusCode, 404);
  const list = (
    await app.inject({ url: '/api/v1/platform/provisioning-drafts', headers: pa })
  ).json();
  assert.ok(!list.drafts.some((d: { id: string }) => d.id === id));
  const merchants = (await app.inject({ url: '/api/v1/platform/merchants', headers: pa })).json()
    .merchants as { id: string; plan: string; plan_name_en: string | null; staff_count: number }[];
  assert.ok(merchants.length > 0);
  for (const m of merchants) {
    const sub = (
      await db.query(
        'SELECT p.key,p.name_en FROM merchant_subscriptions s JOIN plans p ON p.id=s.plan_id WHERE s.merchant_id=$1',
        [m.id],
      )
    ).rows[0];
    // The list shows the live subscription plan, not the legacy plan column.
    if (sub) {
      assert.equal(m.plan, sub.key);
      assert.equal(m.plan_name_en, sub.name_en);
    }
    const ownerless = (
      await db.query(
        "SELECT count(*)::int AS n FROM staff_memberships WHERE merchant_id=$1 AND role<>'owner' AND status='active'",
        [m.id],
      )
    ).rows[0].n;
    assert.equal(m.staff_count, ownerless);
  }
});
