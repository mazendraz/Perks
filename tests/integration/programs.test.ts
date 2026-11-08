import { enrollmentTerms } from '../helpers.js';
import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed } from '../../db/seed.js';
import { login, key, adminLogin } from '../helpers.js';
import { businessDate } from '../../packages/domain/src/loyalty.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let owner: Awaited<ReturnType<typeof login>>,
  customer: typeof owner,
  foreign: typeof owner,
  mid: string,
  branch: string;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  const ownerEmail = 'program-owner-' + randomUUID() + '@nuqta.test';
  owner = await login(app, ownerEmail);
  customer = await login(app, 'program-customer-' + randomUUID() + '@nuqta.test');
  foreign = await login(app, 'owner@lamsa.test');
  // Isolated tenant fixture; all program creation, quotas and loyalty changes below use the API.
  mid = (
    await db.query("INSERT INTO merchants(slug,name) VALUES($1,'Program fixture') RETURNING id", [
      'program-' + randomUUID(),
    ])
  ).rows[0].id;
  branch = (
    await db.query(
      "INSERT INTO branches(merchant_id,name) VALUES($1,'Program branch') RETURNING id",
      [mid],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO feature_entitlements(merchant_id,plan,max_branches,max_staff,max_programs,max_customers) VALUES($1,'growth',3,10,3,3000)",
    [mid],
  );
  const uid = (await db.query('SELECT id FROM users WHERE email=$1', [ownerEmail])).rows[0].id;
  const staff = (
    await db.query(
      "INSERT INTO staff_memberships(merchant_id,user_id,email,name,role,max_qty) VALUES($1,$2,$3,'Program owner','owner',3) RETURNING id",
      [mid, uid, ownerEmail],
    )
  ).rows[0].id;
  await db.query(
    'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
    [mid, staff, branch],
  );
});
after(async () => {
  await app.close();
  await db.end();
});
test('enrollment rejects stale merchant terms and records only the exact newly accepted text', async () => {
  const base = '/api/v1/merchants/' + mid;
  const program = (await app.inject({ url: base + '/programs', headers: owner })).json()
    .programs[0];
  // This test runs before program creation below: create its own active program through the API.
  const active =
    program ||
    (
      await app.inject({
        method: 'POST',
        url: base + '/programs',
        headers: { ...owner, ...key() },
        payload: {
          name: 'Consent terms program',
          threshold: 5,
          maxPerTx: 3,
          rewardTitle: 'Consent fixture item',
          rewardTerms: 'Reward terms for consent fixture',
          validityDays: 30,
          endsAt: null,
          branchIds: [branch],
        },
      })
    ).json().program;
  const details = (
      await app.inject({ url: '/api/v1/public/programs/' + active.id + '/terms' })
    ).json(),
    email = 'terms-customer-' + randomUUID() + '@nuqta.test',
    cu = await login(app, email),
    before = details.termsHash;
  const merchant = (await app.inject({ url: base, headers: owner })).json().merchant;
  const changed = await app.inject({
    method: 'PATCH',
    url: base + '/branding',
    headers: { ...owner, 'if-match': String(merchant.revision) },
    payload: {
      name: merchant.name,
      primaryColor: merchant.primary_color,
      accentColor: merchant.accent_color,
      surfaceColor: merchant.surface_color,
      template: merchant.template,
      terms: 'New enrollment conditions must be reviewed.',
    },
  });
  assert.equal(changed.statusCode, 200);
  const attempt = key(),
    payload = {
      merchantId: mid,
      programId: active.id,
      programVersionId: details.programVersionId,
      alias: 'Consent fixture',
      acceptedTerms: true,
      acceptedTermsHash: before,
      branchId: branch,
    };
  const stale = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...cu, ...attempt },
    payload,
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, 'TERMS_CHANGED');
  const uid = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
  assert.equal(
    Number(
      (await db.query('SELECT count(*) FROM memberships WHERE user_id=$1', [uid])).rows[0].count,
    ),
    0,
  );
  const fresh = await enrollmentTerms(app, active.id);
  assert.notEqual(fresh, before);
  const enrolled = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...cu, ...attempt },
    payload: { ...payload, acceptedTermsHash: fresh },
  });
  assert.equal(enrolled.statusCode, 200);
  const acceptance = (
    await db.query('SELECT terms_hash,terms_text FROM terms_acceptances WHERE membership_id=$1', [
      enrolled.json().membershipId,
    ])
  ).rows[0];
  assert.equal(acceptance.terms_hash, fresh);
  assert.ok(acceptance.terms_text.startsWith('New enrollment conditions'));
  const runtime = new pg.Client({ connectionString: c.DATABASE_URL });
  await runtime.connect();
  try {
    await assert.rejects(
      () =>
        runtime.query(
          'SELECT enroll_customer(NULL::uuid,NULL::uuid,NULL::uuid,NULL::text,NULL::text,NULL::uuid,NULL::jsonb)',
        ),
      /permission denied/,
    );
  } finally {
    await runtime.end();
  }
  await app.inject({
    method: 'POST',
    url: base + '/programs/' + active.id + '/earning-status',
    headers: { ...owner, ...key() },
    payload: { enabled: false, reason: 'Finish independent consent test fixture' },
  });
});
test('multiple programs keep independent cards and one merchant-wide purchase allocation; quota and explicit resume are atomic', async () => {
  const base = '/api/v1/merchants/' + mid,
    payload = (name: string, threshold = 5) => ({
      name,
      threshold,
      maxPerTx: 3,
      rewardTitle: 'One eligible item',
      rewardTerms: 'Terms for this program only',
      validityDays: 30,
      endsAt: null,
      branchIds: [branch],
    });
  const create = (name: string, threshold = 5, headers = owner, k = key()) =>
    app.inject({
      method: 'POST',
      url: base + '/programs',
      headers: { ...headers, ...k },
      payload: payload(name, threshold),
    });
  assert.equal((await create('Foreign program', 5, foreign)).statusCode, 404);
  const originalKey = key(),
    first = await create('Coffee visits', 5, owner, originalKey);
  assert.equal(first.statusCode, 200);
  const a = first.json();
  assert.equal(
    (await create('Coffee visits', 5, owner, originalKey)).json().program.id,
    a.program.id,
  );
  const second = await create('Bakery visits', 4);
  assert.equal(second.statusCode, 200);
  const b = second.json();
  async function join(program: typeof a) {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/me/memberships',
      headers: { ...customer, ...key() },
      payload: {
        merchantId: mid,
        programId: program.program.id,
        programVersionId: program.version.id,
        alias: 'Multi-program customer',
        acceptedTerms: true,
        acceptedTermsHash: await enrollmentTerms(app, program.program.id),
        branchId: branch,
      },
    });
    assert.equal(r.statusCode, 200);
    const membershipId = r.json().membershipId;
    const qr = await app.inject({
      method: 'POST',
      url: '/api/v1/me/memberships/' + membershipId + '/presentation-tokens',
      headers: { ...customer, ...key() },
      payload: {},
    });
    return { membershipId, token: qr.json().token };
  }
  const ca = await join(a),
    cb = await join(b);
  const admin = await adminLogin(app, db);
  const workspace = await app.inject({
    url: '/api/v1/platform/merchants/' + mid + '/workspace',
    headers: admin,
  });
  assert.equal(workspace.statusCode, 200);
  assert.equal(
    workspace.json().summary.customers,
    2,
    'A customer with two program cards is counted once, alongside the earlier consent-test customer',
  );
  const award = (card: typeof ca, reference: string) =>
    app.inject({
      method: 'POST',
      url: base + '/stamp-awards',
      headers: { ...owner, ...key() },
      payload: {
        branchId: branch,
        membershipId: card.membershipId,
        quantity: 1,
        presentationContext: card.token,
        purchaseReference: {
          namespace: 'manual',
          reference,
          businessDate: businessDate('Africa/Cairo'),
        },
      },
    });
  assert.equal((await award(ca, 'PROGRAM-CROSS-1')).statusCode, 200);
  const duplicate = await award(cb, 'program-cross-١');
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().error.code, 'PURCHASE_ALREADY_USED');
  const quotas = await Promise.all(
    Array.from({ length: 8 }, (_, i) => create('Capacity program ' + i)),
  );
  assert.equal(quotas.filter((r) => r.statusCode === 200).length, 1);
  assert.ok(quotas.every((r) => [200, 409].includes(r.statusCode)));
  const earning = (id: string, enabled: boolean, k = key()) =>
    app.inject({
      method: 'POST',
      url: base + '/programs/' + id + '/earning-status',
      headers: { ...owner, ...k },
      payload: { enabled, reason: 'Explicit test lifecycle decision' },
    });
  assert.equal((await earning(a.program.id, false)).statusCode, 200);
  assert.equal((await award(ca, 'ENDED-PROGRAM')).statusCode, 409);
  const fourth = await create('Replacement active program');
  assert.equal(fourth.statusCode, 200);
  const published = await app.inject({
    method: 'POST',
    url: base + '/programs/' + a.program.id + '/versions',
    headers: { ...owner, ...key() },
    payload: payload('Coffee future version', 7),
  });
  assert.equal(published.statusCode, 200);
  assert.equal(
    (await db.query('SELECT status FROM programs WHERE id=$1', [a.program.id])).rows[0].status,
    'ended',
  );
  const resumeKey = key();
  assert.equal((await earning(a.program.id, true, resumeKey)).statusCode, 409);
  assert.equal((await earning(fourth.json().program.id, false)).statusCode, 200);
  assert.equal((await earning(a.program.id, true, resumeKey)).statusCode, 200);
  assert.equal((await earning(a.program.id, true, resumeKey)).statusCode, 200);
  const cards = (await app.inject({ url: '/api/v1/me/memberships', headers: customer })).json()
    .cards;
  assert.equal(cards.length, 2);
  assert.equal(cards.find((r: { id: string }) => r.id === ca.membershipId).threshold, 5);
  assert.equal(cards.find((r: { id: string }) => r.id === ca.membershipId).balance, 1);
  assert.equal(cards.find((r: { id: string }) => r.id === cb.membershipId).balance, 0);
  assert.equal(
    Number(
      (
        await db.query("SELECT count(*) FROM programs WHERE merchant_id=$1 AND status='active'", [
          mid,
        ])
      ).rows[0].count,
    ),
    3,
  );
  const lookup = () =>
    app.inject({
      url:
        '/api/v1/operations/by-key?scope=' +
        encodeURIComponent('program.create:' + mid) +
        '&key=' +
        originalKey['idempotency-key'],
      headers: owner,
    });
  assert.equal((await lookup()).statusCode, 200);
  await db.query("UPDATE staff_memberships SET role='cashier' WHERE merchant_id=$1", [mid]);
  try {
    assert.equal((await lookup()).statusCode, 403);
    assert.equal((await create('Coffee visits', 5, owner, originalKey)).statusCode, 403);
  } finally {
    await db.query("UPDATE staff_memberships SET role='owner' WHERE merchant_id=$1", [mid]);
  }
});

test('joining another program does not append a contradictory consent; explicit revocation changes history and current together', async () => {
  const email = 'consent-' + randomUUID() + '@nuqta.test',
    cu = await login(app, email);
  const programs = (
    await db.query(
      'SELECT p.id,p.current_version_id FROM programs p WHERE p.merchant_id=$1 AND p.current_version_id IS NOT NULL ORDER BY p.created_at LIMIT 2',
      [mid],
    )
  ).rows;
  assert.equal(programs.length, 2);
  for (const [index, program] of programs.entries()) {
    await db.query("UPDATE programs SET status='active' WHERE id=$1", [program.id]);
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/me/memberships',
      headers: { ...cu, ...key() },
      payload: {
        merchantId: mid,
        programId: program.id,
        programVersionId: program.current_version_id,
        alias: 'Consent member',
        acceptedTerms: true,
        acceptedTermsHash: await enrollmentTerms(app, program.id),
        branchId: branch,
        ...(index === 0 ? { consents: { email: true, sms: false, whatsapp: false } } : {}),
      },
    });
    assert.equal(response.statusCode, 200, response.body);
  }
  const user = (await db.query('SELECT id FROM users WHERE email=$1', [email])).rows[0].id;
  assert.deepEqual(
    (
      await db.query(
        "SELECT granted FROM consent_events WHERE merchant_id=$1 AND user_id=$2 AND channel='email' ORDER BY created_at",
        [mid, user],
      )
    ).rows.map((r) => r.granted),
    [true],
  );
  assert.equal(
    (
      await db.query(
        "SELECT granted FROM consent_current WHERE merchant_id=$1 AND user_id=$2 AND channel='email'",
        [mid, user],
      )
    ).rows[0].granted,
    true,
  );
  const revoke = await app.inject({
    method: 'PATCH',
    url: '/api/v1/me/merchants/' + mid + '/preferences',
    headers: cu,
    payload: { channel: 'email', granted: false },
  });
  assert.equal(revoke.statusCode, 200);
  assert.equal(revoke.json().preference.granted, false);
  assert.deepEqual(
    (
      await db.query(
        "SELECT granted FROM consent_events WHERE merchant_id=$1 AND user_id=$2 AND channel='email' ORDER BY created_at",
        [mid, user],
      )
    ).rows.map((r) => r.granted),
    [true, false],
  );
});
