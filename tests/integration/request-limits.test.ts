import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed } from '../../db/seed.js';
import { login, key, enrollmentTerms } from '../helpers.js';
const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL });
const { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
let owner: Awaited<ReturnType<typeof login>>,
  holder: typeof owner,
  foreign: typeof owner,
  mid: string,
  branch: string;
const members: string[] = [];
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  const email = 'limits-owner-' + randomUUID() + '@nuqta.test';
  owner = await login(app, email);
  holder = await login(app, 'limits-holder-' + randomUUID() + '@nuqta.test');
  foreign = await login(app, 'owner@lamsa.test');
  mid = (
    await db.query(
      "INSERT INTO merchants(slug,name) VALUES($1,'Synthetic request limits') RETURNING id",
      ['limit-' + randomUUID()],
    )
  ).rows[0].id;
  branch = (
    await db.query(
      "INSERT INTO branches(merchant_id,name) VALUES($1,'Synthetic branch') RETURNING id",
      [mid],
    )
  ).rows[0].id;
  await db.query(
    "INSERT INTO feature_entitlements(merchant_id,plan,max_branches,max_staff,max_programs,max_customers) VALUES($1,'growth',3,10,3,3000)",
    [mid],
  );
  const staff = (
    await db.query(
      "INSERT INTO staff_memberships(merchant_id,user_id,email,name,role,max_qty) SELECT $1,id,email,'Synthetic owner','owner',3 FROM users WHERE email=$2 RETURNING id",
      [mid, email],
    )
  ).rows[0].id;
  await db.query(
    'INSERT INTO staff_branch_grants(merchant_id,staff_id,branch_id) VALUES($1,$2,$3)',
    [mid, staff, branch],
  );
  for (const name of ['One', 'Two']) {
    const program = await app.inject({
      method: 'POST',
      url: '/api/v1/merchants/' + mid + '/programs',
      headers: { ...owner, ...key() },
      payload: {
        name: 'Request program ' + name,
        threshold: 5,
        maxPerTx: 3,
        rewardTitle: 'Synthetic item',
        rewardTerms: 'Synthetic request test terms',
        validityDays: 30,
        endsAt: null,
        branchIds: [branch],
      },
    });
    assert.equal(program.statusCode, 200);
    const enrolled = await app.inject({
      method: 'POST',
      url: '/api/v1/me/memberships',
      headers: { ...holder, ...key() },
      payload: {
        merchantId: mid,
        programId: program.json().program.id,
        programVersionId: program.json().version.id,
        alias: 'Synthetic holder',
        acceptedTerms: true,
        acceptedTermsHash: await enrollmentTerms(app, program.json().program.id),
        branchId: branch,
      },
    });
    assert.equal(enrolled.statusCode, 200);
    members.push(enrolled.json().membershipId);
  }
});
after(async () => {
  await app.close();
  await db.end();
});
test('experience samples are idempotent, contain no contact fields and remain inside the holder and authorized merchant scope', async () => {
  const ownerId = (
    await db.query("SELECT user_id FROM staff_memberships WHERE merchant_id=$1 AND role='owner'", [
      mid,
    ])
  ).rows[0].user_id;
  const placement = (
    await db.query(
      "INSERT INTO placements(merchant_id,branch_id,label,kind,status,public_code,created_by) VALUES($1,$2,'Synthetic metrics NFC','nfc','requested',$3,$4) RETURNING public_code",
      [mid, branch, randomUUID().replaceAll('-', ''), ownerId],
    )
  ).rows[0].public_code;
  const body = {
      membershipId: members[0],
      branchId: branch,
      placementCode: placement,
      elapsedMs: 250,
    },
    commandKey = key();
  const sample = (headers = holder, value: Record<string, unknown> = body) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/me/experience',
      headers: { ...headers, ...commandKey },
      payload: value,
    });
  assert.equal((await sample(foreign)).statusCode, 404);
  assert.equal((await sample({ ...holder, 'x-csrf-token': '' })).statusCode, 403);
  assert.equal((await sample({ ...holder, origin: 'https://untrusted.invalid' })).statusCode, 403);
  assert.equal((await sample(holder, { ...body, phone: '01000000000' })).statusCode, 422);
  const first = await sample();
  assert.equal(first.statusCode, 200);
  assert.deepEqual((await sample(holder, { ...body, elapsedMs: 999 })).json(), first.json());
  const response = await app.inject({
    url: '/api/v1/merchants/' + mid + '/experience',
    headers: owner,
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().cardOpen, { samples: 1, p95Ms: 250 });
  assert.equal(
    (await app.inject({ url: '/api/v1/merchants/' + mid + '/experience', headers: foreign }))
      .statusCode,
    404,
  );
  assert.equal(
    (await app.inject({ url: '/api/v1/merchants/' + mid + '/experience', headers: holder }))
      .statusCode,
    404,
  );
  const runtime = new pg.Client({ connectionString: c.DATABASE_URL });
  await runtime.connect();
  try {
    await runtime.query('BEGIN');
    await runtime.query(
      "SELECT set_config('app.user_id',(SELECT id::text FROM users WHERE email='owner@lamsa.test'),true)",
    );
    assert.equal(
      (await runtime.query('SELECT * FROM customer_experience_events WHERE merchant_id=$1', [mid]))
        .rowCount,
      0,
    );
    await runtime.query('ROLLBACK');
  } finally {
    await runtime.end();
  }
});
const path = () => '/api/v1/merchants/' + mid + '/stamp-request-settings';
async function create(member = members[0]!, commandKey = randomUUID()) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/me/stamp-requests',
    headers: { ...holder, 'idempotency-key': commandKey },
    payload: { membershipId: member, branchId: branch },
  });
}
test('only the owner changes a bounded request limit, with CSRF, Origin and revision protection', async () => {
  const current = await app.inject({ url: path(), headers: owner });
  assert.equal(current.statusCode, 200);
  assert.equal(current.json().dailyLimit, 10);
  const patch = (headers: typeof owner, limit = 1, revision = current.json().revision) =>
    app.inject({
      method: 'PATCH',
      url: path(),
      headers: { ...headers, 'if-match': String(revision) },
      payload: { dailyLimit: limit },
    });
  assert.equal((await patch(holder)).statusCode, 404);
  assert.equal((await patch(foreign)).statusCode, 404);
  assert.equal((await patch({ ...owner, 'x-csrf-token': '' })).statusCode, 403);
  assert.equal((await patch({ ...owner, origin: 'https://untrusted.invalid' })).statusCode, 403);
  assert.equal((await patch(owner, 0)).statusCode, 422);
  assert.equal((await patch(owner)).statusCode, 200);
  assert.equal((await patch(owner)).statusCode, 409);
});
test('five scans reuse one ten-minute request; concurrent programs share the daily cap and excess attempts are audited', async () => {
  const commandKey = randomUUID(),
    responses = await Promise.all(Array.from({ length: 5 }, () => create(members[0], commandKey)));
  assert.ok(responses.every((r) => r.statusCode === 200));
  const first = responses[0]!.json();
  assert.equal(new Set(responses.map((r) => r.json().id)).size, 1);
  const row = (
    await db.query('SELECT created_at,expires_at FROM stamp_requests WHERE id=$1', [first.id])
  ).rows[0];
  assert.ok(Math.abs(row.expires_at - row.created_at - 600000) < 1000);
  const blocked = await create(members[1]);
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.json().error.code, 'REQUEST_DAILY_LIMIT');
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE merchant_id=$1 AND action='request.daily_limit'",
        [mid],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await db.query('SELECT count(*)::int AS n FROM stamp_requests WHERE merchant_id=$1', [mid]))
      .rows[0].n,
    1,
  );
  const cancellation = await app.inject({
    method: 'POST',
    url: '/api/v1/me/stamp-requests/' + first.id + '/cancel',
    headers: holder,
    payload: {},
  });
  assert.equal(cancellation.statusCode, 200);
  assert.equal(
    (await create(members[1])).statusCode,
    429,
    'cancellation must not reset the daily cap',
  );
  // Shift only this synthetic, cancelled fixture to the preceding local day.
  await db.query(
    "UPDATE stamp_requests SET created_at=clock_timestamp()-interval '2 days' WHERE id=$1",
    [first.id],
  );
  const race = await Promise.all(members.map((member) => create(member)));
  assert.deepEqual(race.map((r) => r.statusCode).sort(), [200, 429]);
  const surviving = race.find((r) => r.statusCode === 200)!.json().id;
  await db.query(
    "UPDATE stamp_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [surviving],
  );
  const listed = await app.inject({ url: '/api/v1/me/stamp-requests', headers: holder });
  assert.equal(
    listed.json().requests.find((r: { id: string }) => r.id === surviving).status,
    'expired',
  );
  const unavailable = await app.inject({
    method: 'POST',
    url: '/api/v1/me/stamp-requests',
    headers: { ...holder, ...key() },
    payload: {
      membershipId: members[0],
      branchId: branch,
      placementCode: 'nonexistent-placement-code',
    },
  });
  assert.equal(unavailable.statusCode, 410);
});
