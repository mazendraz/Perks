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
  const mail = (
    await db.query(
      `SELECT o.payload FROM auth_mail_outbox o JOIN users u ON u.id=o.user_id
     WHERE u.email=$1 AND o.kind='password_reset'`,
      [email],
    )
  ).rows[0];
  assert.ok(mail);
  const reset = {
    method: 'POST' as const,
    url: '/api/v1/auth/password/reset',
    headers: { origin },
    payload: { token: unseal(mail.payload.encryptedToken, c.AUTH_PEPPER), password },
  };
  const confirmed = await app.inject(reset);
  assert.equal(confirmed.statusCode, 200, confirmed.body);
  assert.equal(confirmed.json().onboarding, true);
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
  const plan = catalog.json().plans[0];
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
  const reviewPath = '/api/v1/platform/onboarding-payments';
  assert.equal((await app.inject({ url: reviewPath, headers })).statusCode, 403);
  const queue = await app.inject({ url: reviewPath, headers: pa });
  assert.equal(queue.statusCode, 200, queue.body);
  const queued = queue.json().orders.find((row: { id: string }) => row.id === id);
  assert.ok(queued);
  const receipt = await app.inject({
    url: reviewPath + '/' + id + '/receipt?version=' + queued.receipt_key,
    headers: pa,
  });
  assert.equal(receipt.statusCode, 200, receipt.body);
  assert.equal(receipt.headers['content-type'], 'image/png');
  const draftUrl = '/api/v1/merchant-onboarding/draft';
  const draft = (await app.inject({ url: draftUrl, headers })).json().draft;
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
  const ledger = await db.query('SELECT amount_minor,payment_reference FROM subscription_payments WHERE merchant_id=$1', [
    publication.merchantId,
  ]);
  assert.deepEqual(ledger.rows, [{ amount_minor: plan.amount_minor, payment_reference: 'ORDER-123' }]);

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
    payload: { reference: 'ORDER-456', image: image.toString('base64') },
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
  const stopped = await db.query('SELECT resolve_placement($1) AS value', [
    secondPublished.json().publication.code,
  ]);
  assert.equal(stopped.rows[0].value.status, 'unavailable');
  const suspendedDraft = (await app.inject({ url: draftUrl, headers })).json().draft;
  assert.equal(suspendedDraft.rejection_reason, 'Transfer not received');
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
    payload: { reference: 'ORDER-789', image: image.toString('base64') },
  });
  assert.equal(corrected.statusCode, 200, corrected.body);
  const corrections = (await app.inject({ url: reviewPath, headers: pa })).json().orders;
  const correctionReview = corrections.find((row: { id: string }) => row.id === correctedOrder.id);
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
  const restored = (await app.inject({ url: draftUrl, headers })).json().draft;
  assert.deepEqual(restored.publication, secondPublished.json().publication);
  assert.equal(restored.rejection_reason, null);
  const reopened = await db.query('SELECT resolve_placement($1) AS value', [
    restored.publication.code,
  ]);
  assert.equal(reopened.rows[0].value.status, 'active');
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
