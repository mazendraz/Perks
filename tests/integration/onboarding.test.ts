import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import { decodeQr } from '../../tools/qr-codec.js';
import { buildApp } from '../../apps/api/src/server.js';
import { readConfig } from '../../apps/api/src/config.js';
import { adminLogin, key, login } from '../helpers.js';
import { seed } from '../../db/seed.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
const { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let pa: Awaited<ReturnType<typeof adminLogin>>;
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
function data() {
  const slug = 'onboard-' + randomUUID().slice(0, 8);
  return {
    name: 'Onboarding Cafe',
    slug,
    contactEmail: slug + '@example.test',
    timezone: 'Africa/Cairo',
    primaryColor: '#204C41',
    accentColor: '#D4AD68',
    surfaceColor: '#F9F5EA',
    template: 'espresso',
    logoStyle: 'plain',
    logoSize: 60,
    stampShape: 'seal',
    stampIcon: 'coffee',
    stampStyle: 'outline',
    terms: 'Enrollment and loyalty terms.',
    program: {
      name: 'Visits',
      threshold: 5,
      maxPerTx: 3,
      rewardTitle: 'Free coffee',
      rewardTerms: 'One coffee within thirty days.',
      validityDays: 30,
      endsAt: null,
    },
    branches: [
      { name: 'Downtown', address: 'Test' },
      { name: 'Second', address: 'Test' },
    ],
    staff: [
      {
        email: 'owner-' + slug + '@example.test',
        role: 'owner',
        branchIndexes: [0, 1],
        maxQty: 3,
        accessMode: 'password',
      },
      {
        email: 'cash-' + slug + '@example.test',
        role: 'cashier',
        branchIndexes: [0],
        maxQty: 2,
        accessMode: 'password',
      },
    ],
    plan: 'growth',
  };
}
const password = 'Onboard-' + randomUUID();
async function passwordLogin(email: string, pass = password) {
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    headers: { origin: c.PUBLIC_APP_ORIGIN },
    payload: { email, password: pass },
  });
  assert.equal(result.statusCode, 200, result.body);
  return {
    cookie: result.cookies.map((x) => x.name + '=' + x.value).join('; '),
    origin: c.PUBLIC_APP_ORIGIN,
    'x-csrf-token': result.json().csrfToken as string,
  };
}
test('onboarding stages private sanitized logos and hashed credentials, activates direct accounts and one decodable QR per branch, and replays without duplication', async () => {
  const d = data(),
    created = await app.inject({
      method: 'POST',
      url: '/api/v1/platform/provisioning-drafts',
      headers: { ...pa, ...key() },
      payload: { data: d },
    });
  assert.equal(created.statusCode, 200, created.body);
  let draft = created.json().draft;
  const base = '/api/v1/platform/provisioning-drafts/' + draft.id;
  const otherAdmin = await adminLogin(app, db);
  const raw = await sharp({ create: { width: 80, height: 80, channels: 3, background: '#20a070' } })
    .jpeg()
    .toBuffer();
  const invalid = await app.inject({
    method: 'POST',
    url: base + '/logo',
    headers: pa,
    payload: { base64: Buffer.from('<svg/>').toString('base64') },
  });
  assert.equal(invalid.statusCode, 422);
  const uploaded = await app.inject({
    method: 'POST',
    url: base + '/logo',
    headers: pa,
    payload: { base64: raw.toString('base64') },
  });
  assert.equal(uploaded.statusCode, 200, uploaded.body);
  const assetId = uploaded.json().asset.id;
  const logo = await app.inject({ url: base + '/logo/' + assetId, headers: pa });
  assert.equal(logo.statusCode, 200);
  assert.equal((await sharp(logo.rawPayload).metadata()).format, 'png');
  assert.equal(
    (await app.inject({ url: base + '/logo/' + assetId, headers: otherAdmin })).statusCode,
    404,
  );
  assert.equal((await app.inject({ url: base + '/logo/' + assetId })).statusCode, 401);
  const bad = await app.inject({
    method: 'PATCH',
    url: base,
    headers: { ...pa, 'if-match': String(draft.revision) },
    payload: { data: { ...d, password } },
  });
  assert.equal(bad.statusCode, 422);
  const saved = await app.inject({
    method: 'PATCH',
    url: base,
    headers: { ...pa, 'if-match': String(draft.revision) },
    payload: { data: { ...d, logoAssetId: assetId } },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  draft = saved.json().draft;
  const staged = await app.inject({
    method: 'POST',
    url: base + '/credentials',
    headers: pa,
    payload: {
      revision: draft.revision,
      accounts: d.staff.map((s) => ({ email: s.email, password })),
    },
  });
  assert.equal(staged.statusCode, 200, staged.body);
  assert.ok(!staged.body.includes(password));
  const status = await app.inject({ url: base + '/credentials', headers: pa });
  assert.equal(status.json().emails.length, 2);
  assert.ok(!status.body.includes('scrypt'));
  assert.equal(
    (await app.inject({ url: base + '/credentials', headers: otherAdmin })).statusCode,
    404,
  );
  const rawCredentials = (
    await db.query('SELECT password_hash FROM provisioning_credentials WHERE draft_id=$1', [
      draft.id,
    ])
  ).rows;
  assert.equal(rawCredentials.length, 2);
  assert.ok(
    rawCredentials.every(
      (r) => r.password_hash.startsWith('scrypt$') && !r.password_hash.includes(password),
    ),
  );
  const activationHeaders = { ...pa, ...key() },
    activationBody = { draftRevision: draft.revision };
  const active = await app.inject({
    method: 'POST',
    url: base + '/activate',
    headers: activationHeaders,
    payload: activationBody,
  });
  assert.equal(active.statusCode, 200, active.body);
  const result = active.json(),
    mid = result.merchant.id;
  assert.equal(result.accounts.length, 2);
  assert.equal(result.merchant.stamp_shape, 'seal');
  assert.equal(result.merchant.stamp_icon, 'coffee');
  assert.equal(result.merchant.stamp_style, 'outline');
  assert.equal(result.invitations.length, 0);
  assert.equal(result.merchant.logo_asset_id, assetId);
  assert.equal(result.merchant.logo_style, 'plain');
  assert.equal(result.merchant.logo_size, 60);
  assert.ok(!active.body.includes(password));
  const replay = await app.inject({
    method: 'POST',
    url: base + '/activate',
    headers: { ...pa, ...key() },
    payload: activationBody,
  });
  assert.deepEqual(replay.json(), result);
  const owner = await passwordLogin(d.staff[0]!.email),
    cashier = await passwordLogin(d.staff[1]!.email);
  assert.equal(
    (await app.inject({ url: '/api/v1/session', headers: owner })).json().grants[0].role,
    'owner',
  );
  const cashGrants = (await app.inject({ url: '/api/v1/session', headers: cashier })).json().grants;
  assert.equal(cashGrants[0].role, 'cashier');
  assert.equal(cashGrants[0].branches.length, 1);
  const published = await app.inject({
    url: '/api/v1/public/merchants/' + mid + '/logos/' + assetId,
  });
  assert.equal(published.statusCode, 200);
  const placements = (
    await app.inject({ url: '/api/v1/merchants/' + mid + '/placements', headers: owner })
  ).json().placements;
  assert.equal(placements.length, 2);
  for (const p of placements) {
    const qr = await app.inject({
      url: '/api/v1/merchants/' + mid + '/placements/' + p.id + '/qr?preview=1',
      headers: owner,
    });
    assert.equal(qr.statusCode, 200);
    assert.match(qr.headers['content-disposition'] as string, /inline/);
    const decoded = await decodeQr(qr.rawPayload);
    assert.equal(decoded, p.qrUrl);
    const resolved = await app.inject({ url: '/api/v1/public/placements/' + p.public_code });
    assert.equal(resolved.json().branchId, p.branch_id);
    const svg = await app.inject({
      url: '/api/v1/merchants/' + mid + '/placements/' + p.id + '/qr?format=svg',
      headers: owner,
    });
    assert.match(svg.body, /<svg/);
  }
  assert.equal(
    (
      await app.inject({
        url:
          '/api/v1/merchants/' +
          mid +
          '/placements/' +
          placements.find(
            (p: { branch_id: string }) => p.branch_id !== cashGrants[0].branches[0].id,
          ).id +
          '/qr',
        headers: cashier,
      })
    ).statusCode,
    404,
  );
  const workspace = await app.inject({
    url: '/api/v1/platform/merchants/' + mid + '/workspace',
    headers: pa,
  });
  assert.equal(workspace.statusCode, 200, workspace.body);
  assert.equal(workspace.json().summary.customers, 0);
  assert.equal(workspace.json().summary.balance_drift, 0);
  assert.ok(!workspace.body.includes('password_hash'));
  assert.equal(
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/platform/merchants/' + mid + '/accounts',
        headers: { ...owner, ...key() },
        payload: {
          email: 'denied@example.test',
          password,
          role: 'owner',
          branchIds: [result.branches[0].id],
          maxQty: 3,
        },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/platform/merchants/' + mid + '/workspace', headers: owner }))
      .statusCode,
    403,
  );
  const ticket = await app.inject({
    method: 'POST',
    url: '/api/v1/support/tickets',
    headers: { ...pa, ...key() },
    payload: {
      merchantId: mid,
      subject: 'Check new branch',
      category: 'materials',
      message: 'Confirm enrollment QR at the counter.',
    },
  });
  assert.equal(ticket.statusCode, 200, ticket.body);
  const ownerTickets = await app.inject({
    url: '/api/v1/support/tickets?merchantId=' + mid,
    headers: owner,
  });
  assert.equal(ownerTickets.json().tickets.length, 1);
  const adminTickets = await app.inject({
    url: '/api/v1/support/tickets?merchantId=' + mid,
    headers: pa,
  });
  assert.equal(adminTickets.statusCode, 200);
  assert.ok(
    adminTickets.json().tickets.every((t: { merchant_id: string }) => t.merchant_id === mid),
  );
  const newEmail = 'team-' + randomUUID() + '@example.test';
  const account = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + mid + '/invitations',
    headers: { ...owner, ...key() },
    payload: {
      email: newEmail,
      password,
      role: 'cashier',
      maxQty: 2,
      branchIds: [result.branches[0].id],
    },
  });
  assert.equal(account.statusCode, 200, account.body);
  assert.equal(account.json().account.status, 'active');
  await passwordLogin(newEmail);
  // An already-activated shop may have an unaccepted invitation from the old flow.
  const pendingEmail = 'pending-' + randomUUID() + '@example.test';
  const pending = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + mid + '/invitations',
    headers: { ...owner, ...key() },
    payload: { email: pendingEmail, role: 'owner', branchIds: [result.branches[0].id], maxQty: 3 },
  });
  assert.equal(pending.statusCode, 200, pending.body);
  const directKey = key(),
    directBody = {
      email: pendingEmail,
      password,
      role: 'owner',
      branchIds: [result.branches[0].id],
      maxQty: 3,
    };
  const direct = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/merchants/' + mid + '/accounts',
    headers: { ...pa, ...directKey },
    payload: directBody,
  });
  assert.equal(direct.statusCode, 200, direct.body);
  const replayAccount = await app.inject({
    method: 'POST',
    url: '/api/v1/platform/merchants/' + mid + '/accounts',
    headers: { ...pa, ...directKey },
    payload: directBody,
  });
  assert.deepEqual(replayAccount.json(), direct.json());
  assert.equal(
    (await db.query('SELECT status FROM invitations WHERE id=$1', [pending.json().invitation.id]))
      .rows[0].status,
    'revoked',
  );
  await passwordLogin(pendingEmail);
  assert.equal(
    (
      await db.query('SELECT count(*)::int AS n FROM provisioning_credentials WHERE draft_id=$1', [
        draft.id,
      ])
    ).rows[0].n,
    0,
  );
  assert.ok(
    !(
      await db.query('SELECT data::text FROM provisioning_drafts WHERE id=$1', [draft.id])
    ).rows[0].data.includes(password),
  );
  const takeover = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + mid + '/invitations',
    headers: { ...owner, ...key() },
    payload: {
      email: newEmail,
      password: 'Replacement-' + randomUUID(),
      role: 'cashier',
      maxQty: 2,
      branchIds: [result.branches[0].id],
    },
  });
  assert.equal(takeover.statusCode, 409);
  assert.equal(takeover.json().error.code, 'ACCOUNT_EXISTS_USE_INVITATION');
  await passwordLogin(newEmail);
  const unrelated = await login(app, 'owner@bunn.test');
  assert.equal(
    (await app.inject({ url: '/api/v1/support/tickets?merchantId=' + mid, headers: unrelated }))
      .statusCode,
    404,
  );
});
