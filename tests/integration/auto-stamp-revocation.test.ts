import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomBytes, randomUUID } from 'node:crypto';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { adminLogin, enrollmentTerms, key, login } from '../helpers.js';
import { businessDate } from '../../packages/domain/src/loyalty.js';

const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' });
const program = '40000000-0000-4000-8000-000000000001',
  version = '50000000-0000-4000-8000-000000000001',
  settingsUrl = '/api/v1/platform/merchants/' + ids.merchantA + '/stamp-collection-settings',
  merchantUrl = '/api/v1/merchants/' + ids.merchantA;
type Headers = Awaited<ReturnType<typeof login>>;
type Customer = { headers: Headers; membership: string };
let admin: Headers, owner: Headers, cashier: Headers, terms: string;
const codes: Record<string, string> = {};
const automatic = {
  requireLocation: false,
  requireCashier: false,
  maxAccuracy: 100,
  collectionsPerDay: 2,
  stampsPerDay: null,
  limitWindow: 'local_day',
  cooldownMinutes: 0,
  defaultStamps: 1,
  allowMultiple: true,
  maxStampsPerCollection: 100,
  welcomeStamps: 0,
  autoBranchHourlyCap: 1000,
  openCollectionAcknowledged: true,
  revokeWindowMinutes: 30,
};
async function configure(changes: Record<string, unknown> = {}) {
  const current = (await app.inject({ url: settingsUrl, headers: admin })).json();
  const r = await app.inject({
    method: 'PATCH',
    url: settingsUrl,
    headers: { ...admin, 'if-match': String(current.settings.revision) },
    payload: { ...automatic, ...changes },
  });
  assert.equal(r.statusCode, 200, r.body);
  return r.json().settings;
}
// The sign-in limiter counts per address; each synthetic customer signs in from its own.
let address = 0;
async function signIn(email: string): Promise<Headers> {
  const origin = c.PUBLIC_APP_ORIGIN,
    remoteAddress = '10.11.' + Math.floor(++address / 250) + '.' + ((address % 250) + 1);
  const challenge = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/challenges',
    headers: { origin },
    payload: { email },
    remoteAddress,
  });
  assert.equal(challenge.statusCode, 202, challenge.body);
  const id = challenge.json().challengeId;
  const mailbox = (
    await app.inject({ url: '/api/v1/local/mail', remoteAddress: '127.0.0.1' })
  ).json();
  const result = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/challenges/' + id + '/verify',
    headers: { origin },
    payload: { code: mailbox.messages.find((m: { id: string }) => m.id === id).code },
    remoteAddress,
  });
  assert.equal(result.statusCode, 200, result.body);
  return {
    cookie: result.cookies.map((x) => x.name + '=' + x.value).join('; '),
    origin,
    'x-csrf-token': result.json().csrfToken as string,
  };
}
async function customer(): Promise<Customer> {
  const headers = await signIn('revoke-' + randomUUID() + '@nuqta.test');
  const enrolled = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...headers, ...key() },
    payload: {
      merchantId: ids.merchantA,
      programId: program,
      programVersionId: version,
      alias: 'Revoked',
      acceptedTerms: true,
      acceptedTermsHash: terms,
      branchId: ids.branchA,
    },
  });
  assert.equal(enrolled.statusCode, 200, enrolled.body);
  return { headers, membership: enrolled.json().membershipId as string };
}
const collect = (who: Customer, branch = ids.branchA) =>
  app.inject({
    method: 'POST',
    url: '/api/v1/me/stamp-collections',
    headers: { ...who.headers, ...key() },
    payload: { membershipId: who.membership, branchId: branch, placementCode: codes[branch] },
  });
async function autoStamp(who: Customer, branch = ids.branchA) {
  const r = await collect(who, branch);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().outcome, 'awarded', r.body);
  return r.json().transactionId as string;
}
async function cashierAward(who: Customer, quantity: number) {
  const token = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/me/memberships/' + who.membership + '/presentation-tokens',
      headers: { ...who.headers, ...key() },
      payload: {},
    })
  ).json().token;
  const proof = (
    await app.inject({
      method: 'POST',
      url: '/api/v1/cashier/scans/resolve',
      headers: cashier,
      payload: { merchantId: ids.merchantA, branchId: ids.branchA, token },
    })
  ).json().presentationContext;
  return app.inject({
    method: 'POST',
    url: merchantUrl + '/stamp-awards',
    headers: { ...cashier, ...key() },
    payload: {
      presentationContext: proof,
      branchId: ids.branchA,
      membershipId: who.membership,
      quantity,
      purchaseReference: {
        namespace: 'manual',
        reference: 'R-' + randomUUID(),
        businessDate: businessDate('Africa/Cairo'),
      },
    },
  });
}
const revoke = (
  as: Headers,
  tx: string,
  idempotency = randomUUID(),
  reason = 'Customer tapped twice',
) =>
  app.inject({
    method: 'POST',
    url: merchantUrl + '/auto-stamps/' + tx + '/revoke',
    headers: { ...as, 'idempotency-key': idempotency },
    payload: { reason },
  });
const account = async (membership: string) =>
  (
    await db.query(
      'SELECT a.balance,a.revision,(SELECT coalesce(sum(amount),0)::int FROM ledger_entries e WHERE e.membership_id=a.membership_id) AS ledger FROM loyalty_accounts a WHERE membership_id=$1',
      [membership],
    )
  ).rows[0] as { balance: number; revision: number; ledger: number };
const rewards = async (membership: string) =>
  (
    await db.query(
      'SELECT id,status FROM reward_grants WHERE membership_id=$1 ORDER BY earned_at',
      [membership],
    )
  ).rows as { id: string; status: string }[];
async function age(tx: string, interval: string) {
  await db.query('ALTER TABLE loyalty_transactions DISABLE TRIGGER transaction_immutable');
  try {
    await db.query('UPDATE loyalty_transactions SET at=at-$2::interval WHERE id=$1', [
      tx,
      interval,
    ]);
  } finally {
    await db.query('ALTER TABLE loyalty_transactions ENABLE TRIGGER transaction_immutable');
  }
}
const errorCode = (r: { json: () => { error?: { code?: string } } }) => r.json().error?.code;

before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  admin = await adminLogin(app, db);
  owner = await login(app, 'owner@bunn.test');
  cashier = await login(app, 'cashier@bunn.test');
  for (const branch of [ids.branchA, ids.branchA2]) {
    codes[branch] = randomBytes(24).toString('base64url');
    await db.query(
      "INSERT INTO placements(merchant_id,branch_id,label,kind,public_code,created_by) VALUES($1,$2,'Revoke fixture','stand',$3,$4)",
      [ids.merchantA, branch, codes[branch], ids.ownerA],
    );
  }
  terms = await enrollmentTerms(app, program);
});
after(async () => {
  const current = (await app.inject({ url: settingsUrl, headers: admin })).json();
  await app.inject({
    method: 'PATCH',
    url: settingsUrl,
    headers: { ...admin, 'if-match': String(current.settings.revision) },
    payload: {
      ...automatic,
      requireCashier: true,
      collectionsPerDay: null,
      autoBranchHourlyCap: 60,
      openCollectionAcknowledged: false,
    },
  });
  await app.close();
  await db.end();
});

test('the revoke window is a platform setting, 30 minutes by default and kept when omitted', async () => {
  const fresh = (await app.inject({ url: settingsUrl, headers: admin })).json().settings;
  assert.equal(fresh.revokeWindowMinutes, 30);
  const { revokeWindowMinutes: _omitted, ...withoutWindow } = automatic;
  const set = await configure({ revokeWindowMinutes: 45 });
  assert.equal(set.revokeWindowMinutes, 45);
  const current = (await app.inject({ url: settingsUrl, headers: admin })).json();
  const kept = await app.inject({
    method: 'PATCH',
    url: settingsUrl,
    headers: { ...admin, 'if-match': String(current.settings.revision) },
    payload: withoutWindow,
  });
  assert.equal(kept.statusCode, 200, kept.body);
  assert.equal(kept.json().settings.revokeWindowMinutes, 45);
  const tooShort = await app.inject({
    method: 'PATCH',
    url: settingsUrl,
    headers: { ...admin, 'if-match': String(kept.json().settings.revision) },
    payload: { ...automatic, revokeWindowMinutes: 2 },
  });
  assert.equal(tooShort.statusCode, 422);
  await configure();
});

test('a cashier takes back an automatic stamp at their branch: compensated, audited, pass refreshed, once', async () => {
  await configure();
  const who = await customer();
  const tx = await autoStamp(who);
  await db.query(
    "INSERT INTO wallet_passes(membership_id,merchant_id,auth_token_hash,fingerprint) VALUES($1,$2,$3,'seen')",
    [who.membership, ids.merchantA, 'a'.repeat(64)],
  );
  const cardBefore = (
    await db.query('SELECT wallet_fingerprint(wallet_card_json($1)) AS value', [who.membership])
  ).rows[0].value;
  const before = await account(who.membership);
  assert.equal(before.balance, 1);
  const idempotency = randomUUID();
  const r = await revoke(cashier, tx, idempotency);
  assert.equal(r.statusCode, 200, r.body);
  const body = r.json();
  assert.equal(body.status, 'applied');
  assert.equal(body.balanceAfter, 0);
  assert.equal(body.accountRevision, before.revision + 1);
  const after = await account(who.membership);
  assert.deepEqual([after.balance, after.ledger], [0, 0]);
  // The automatic stamp stays in the history next to its compensating correction.
  const history = (
    await db.query(
      'SELECT type,source,quantity,original_transaction_id FROM loyalty_transactions WHERE membership_id=$1 ORDER BY sequence',
      [who.membership],
    )
  ).rows;
  assert.deepEqual(history, [
    { type: 'award', source: 'auto', quantity: 1, original_transaction_id: null },
    { type: 'correction', source: 'revoke', quantity: -1, original_transaction_id: tx },
  ]);
  const correction = (
    await db.query(
      'SELECT kind,status,requested_by,requested_delta,reason FROM correction_requests WHERE original_transaction_id=$1',
      [tx],
    )
  ).rows;
  assert.deepEqual(correction, [
    {
      kind: 'revoke',
      status: 'applied',
      requested_by: ids.cashier,
      requested_delta: -1,
      reason: 'Customer tapped twice',
    },
  ]);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE action='auto-stamp.revoke' AND target_id=$1 AND actor_id=$2",
        [tx, ids.cashier],
      )
    ).rows[0].n,
    1,
  );
  // The installed pass is marked changed, and its content really differs.
  assert.equal(
    (
      await db.query('SELECT fingerprint FROM wallet_passes WHERE membership_id=$1', [
        who.membership,
      ])
    ).rows[0].fingerprint,
    '',
  );
  assert.notEqual(
    (await db.query('SELECT wallet_fingerprint(wallet_card_json($1)) AS value', [who.membership]))
      .rows[0].value,
    cardBefore,
  );
  // A replay returns the same answer; a second revoke is refused and changes nothing.
  const replay = await revoke(cashier, tx, idempotency);
  assert.equal(replay.statusCode, 200, replay.body);
  assert.equal(replay.json().correctionId, body.correctionId);
  const twice = await revoke(owner, tx);
  assert.equal(twice.statusCode, 409);
  assert.equal(errorCode(twice), 'ALREADY_REVERSED');
  assert.equal((await account(who.membership)).balance, 0);
});

test('only automatic and welcome stamps can be revoked, and a reason is required', async () => {
  await configure({ welcomeStamps: 2 });
  const who = await customer();
  const welcome = (
    await db.query(
      "SELECT id FROM loyalty_transactions WHERE membership_id=$1 AND source='welcome'",
      [who.membership],
    )
  ).rows[0].id;
  const short = await revoke(cashier, welcome, randomUUID(), 'no');
  assert.equal(short.statusCode, 422);
  const award = await cashierAward(who, 1);
  assert.equal(award.statusCode, 200, award.body);
  const manual = await revoke(owner, award.json().transactionId);
  assert.equal(manual.statusCode, 409);
  assert.equal(errorCode(manual), 'NOT_AUTOMATIC_STAMP');
  const r = await revoke(cashier, welcome);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal((await account(who.membership)).balance, 1);
  await configure();
});

test('the window: cashiers within the shop setting, owners and managers within 7 days', async () => {
  await configure({ revokeWindowMinutes: 30 });
  const who = await customer();
  const tx = await autoStamp(who);
  await age(tx, '31 minutes');
  const late = await revoke(cashier, tx);
  assert.equal(late.statusCode, 409);
  assert.equal(errorCode(late), 'REVOKE_WINDOW_CLOSED');
  const byOwner = await revoke(owner, tx);
  assert.equal(byOwner.statusCode, 200, byOwner.body);

  const old = await customer();
  const oldTx = await autoStamp(old);
  await age(oldTx, '8 days');
  const tooOld = await revoke(owner, oldTx);
  assert.equal(tooOld.statusCode, 409);
  assert.equal(errorCode(tooOld), 'REVOKE_WINDOW_CLOSED');
  assert.equal((await account(old.membership)).balance, 1);
});

test('a cashier cannot revoke a stamp collected at a branch they do not work at', async () => {
  await configure();
  const who = await customer();
  const tx = await autoStamp(who, ids.branchA2);
  const r = await revoke(cashier, tx);
  assert.equal(r.statusCode, 403);
  assert.equal(errorCode(r), 'BRANCH_UNAUTHORIZED');
  assert.equal((await account(who.membership)).balance, 1);
  assert.equal((await revoke(owner, tx)).statusCode, 200);
  // Another shop's owner does not even see it.
  const otherOwner = await login(app, 'owner@lamsa.test');
  const foreign = await app.inject({
    method: 'POST',
    url: '/api/v1/merchants/' + ids.merchantB + '/auto-stamps/' + tx + '/revoke',
    headers: { ...otherOwner, ...key() },
    payload: { reason: 'Not my stamp' },
  });
  assert.equal(foreign.statusCode, 404);
});

test('revoking the stamp that completed the card voids the reward it earned', async () => {
  // Four welcome stamps plus one automatic stamp complete the five-stamp card.
  await configure({ welcomeStamps: 4 });
  const who = await customer();
  const tx = await autoStamp(who);
  assert.equal((await account(who.membership)).balance, 0);
  const [reward] = await rewards(who.membership);
  assert.equal(reward!.status, 'available');
  const r = await revoke(cashier, tx);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().voidedRewards, [reward!.id]);
  assert.deepEqual(await rewards(who.membership), [{ id: reward!.id, status: 'voided' }]);
  const after = await account(who.membership);
  assert.deepEqual([after.balance, after.ledger], [4, 4]);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM reward_events WHERE reward_id=$1 AND event_type='voided'",
        [reward!.id],
      )
    ).rows[0].n,
    1,
  );
  await configure();
});

test('a redeemed reward is never undone: cashiers are refused, owners take back only the stamp', async () => {
  await configure({ welcomeStamps: 4 });
  const who = await customer();
  const tx = await autoStamp(who);
  const [reward] = await rewards(who.membership);
  await db.query(
    "UPDATE reward_grants SET status='redeemed',redeemed_at=clock_timestamp() WHERE id=$1",
    [reward!.id],
  );
  const refused = await revoke(cashier, tx);
  assert.equal(refused.statusCode, 409);
  assert.equal(errorCode(refused), 'REWARD_ALREADY_REDEEMED');
  // Nothing left on the card to take the stamp from.
  const empty = await revoke(owner, tx);
  assert.equal(errorCode(empty), 'BALANCE_TOO_LOW');
  // After the next visit the owner can take the stamp back; the reward stays redeemed.
  assert.equal((await autoStamp(who)) !== tx, true);
  const r = await revoke(owner, tx);
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().voidedRewards, []);
  assert.deepEqual(await rewards(who.membership), [{ id: reward!.id, status: 'redeemed' }]);
  const after = await account(who.membership);
  assert.deepEqual([after.balance, after.ledger], [0, 0]);
  await configure();
});

test('a card reset is for owners and managers, needs a reason and the current revision', async () => {
  await configure({ welcomeStamps: 4 });
  const who = await customer();
  await autoStamp(who); // completes the card: one available reward
  await autoStamp(who); // and one stamp on the new card
  const state = await account(who.membership);
  assert.equal(state.balance, 1);
  const reset = (
    as: Headers,
    revision: number,
    payload: Record<string, unknown>,
    idem = randomUUID(),
  ) =>
    app.inject({
      method: 'POST',
      url: merchantUrl + '/memberships/' + who.membership + '/reset',
      headers: { ...as, 'idempotency-key': idem, 'if-match': String(revision) },
      payload,
    });
  assert.equal((await reset(cashier, state.revision, { reason: 'Abuse' })).statusCode, 403);
  assert.equal((await reset(owner, state.revision, { reason: 'no' })).statusCode, 422);
  const stale = await reset(owner, state.revision - 1, { reason: 'Shared sticker abuse' });
  assert.equal(stale.statusCode, 409);
  assert.equal(errorCode(stale), 'REVISION_CONFLICT');
  assert.equal((await account(who.membership)).balance, 1);
  const r = await reset(owner, state.revision, { reason: 'Shared sticker abuse' });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().previousBalance, 1);
  assert.equal(r.json().voidedRewards.length, 1);
  assert.equal(r.json().autoCollectBlocked, false);
  const after = await account(who.membership);
  assert.deepEqual([after.balance, after.ledger, after.revision], [0, 0, state.revision + 1]);
  assert.deepEqual(
    (await rewards(who.membership)).map((x) => x.status),
    ['voided'],
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM correction_requests WHERE membership_id=$1 AND kind='reset' AND original_transaction_id IS NULL",
        [who.membership],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM audit_events WHERE action='card.reset' AND target_id=$1",
        [who.membership],
      )
    ).rows[0].n,
    1,
  );
  // The same revision cannot reset twice.
  assert.equal(
    errorCode(await reset(owner, state.revision, { reason: 'Again please' })),
    'REVISION_CONFLICT',
  );
  await configure();
});

test('a reset keeps redeemed rewards and stamps revoked before it stay final', async () => {
  await configure({ welcomeStamps: 4 });
  const who = await customer();
  const tx = await autoStamp(who);
  const [reward] = await rewards(who.membership);
  await db.query(
    "UPDATE reward_grants SET status='redeemed',redeemed_at=clock_timestamp() WHERE id=$1",
    [reward!.id],
  );
  const { revision } = await account(who.membership);
  const r = await app.inject({
    method: 'POST',
    url: merchantUrl + '/memberships/' + who.membership + '/reset',
    headers: { ...owner, ...key(), 'if-match': String(revision) },
    payload: { reason: 'Fresh start' },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.deepEqual(r.json().voidedRewards, []);
  assert.deepEqual(await rewards(who.membership), [{ id: reward!.id, status: 'redeemed' }]);
  // The reset already took this stamp away.
  assert.equal(errorCode(await revoke(owner, tx)), 'CARD_RESET_SINCE');
  await configure();
});

test('a blocked card goes to the cashier instead of collecting on its own', async () => {
  await configure();
  const who = await customer();
  const block = (as: Headers, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: merchantUrl + '/memberships/' + who.membership + '/auto-block',
      headers: { ...as, ...key() },
      payload,
    });
  assert.equal((await block(cashier, { blocked: true, reason: 'Sticker abuse' })).statusCode, 403);
  assert.equal((await block(owner, { blocked: true })).statusCode, 422);
  const blocked = await block(owner, { blocked: true, reason: 'Sticker abuse' });
  assert.equal(blocked.statusCode, 200, blocked.body);
  assert.deepEqual([blocked.json().autoCollectBlocked, blocked.json().changed], [true, true]);
  const refused = await collect(who);
  assert.equal(refused.statusCode, 200, refused.body);
  assert.deepEqual(
    [refused.json().outcome, refused.json().reason],
    ['not_eligible', 'cashier_required'],
  );
  assert.equal((await account(who.membership)).balance, 0);
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM stamp_collection_checks WHERE membership_id=$1 AND outcome='blocked'",
        [who.membership],
      )
    ).rows[0].n,
    1,
  );
  // The database refuses too, whatever the API path.
  const op = (
    await db.query(
      "INSERT INTO operations(actor_id,merchant_id,scope,idempotency_key,request_hash) SELECT user_id,merchant_id,'test.blocked',$2,'x' FROM memberships WHERE id=$1 RETURNING id,actor_id",
      [who.membership, randomUUID()],
    )
  ).rows[0];
  await db.query('BEGIN');
  try {
    await db.query("SELECT set_config('app.user_id',$1,true)", [op.actor_id]);
    const direct = (
      await db.query('SELECT collect_stamp_automatically($1,$2,$3) AS value', [
        who.membership,
        ids.branchA,
        op.id,
      ])
    ).rows[0].value;
    assert.deepEqual(direct, { eligible: false, reason: 'blocked' });
  } finally {
    await db.query('ROLLBACK');
  }
  // The cashier still stamps the card.
  assert.equal((await cashierAward(who, 1)).statusCode, 200);
  const unblocked = await block(owner, { blocked: false });
  assert.equal(unblocked.statusCode, 200, unblocked.body);
  assert.equal(unblocked.json().autoCollectBlocked, false);
  assert.equal((await collect(who)).json().outcome, 'awarded');
  assert.equal(
    (
      await db.query(
        "SELECT array_agg(action ORDER BY at) AS actions FROM audit_events WHERE target_id=$1 AND action LIKE 'card.auto-%'",
        [who.membership],
      )
    ).rows[0].actions.join(','),
    'card.auto-block,card.auto-unblock',
  );
});

test('a reset can block automatic collection in the same step', async () => {
  await configure();
  const who = await customer();
  await autoStamp(who);
  const { revision } = await account(who.membership);
  const r = await app.inject({
    method: 'POST',
    url: merchantUrl + '/memberships/' + who.membership + '/reset',
    headers: { ...owner, ...key(), 'if-match': String(revision) },
    payload: { reason: 'Collected from home', blockAutoCollect: true },
  });
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.json().autoCollectBlocked, true);
  assert.equal((await collect(who)).json().reason, 'cashier_required');
});

test('the cashier feed lists automatic stamps of their own branch only, with revoke state', async () => {
  await configure({ welcomeStamps: 4 });
  const here = await customer(),
    there = await customer();
  const completing = await autoStamp(here); // completes the five-stamp card
  const elsewhere = await autoStamp(there, ids.branchA2);
  const feed = async (as: Headers, branch: string) =>
    app.inject({ url: merchantUrl + '/auto-stamps?branchId=' + branch, headers: as });
  const own = await feed(cashier, ids.branchA);
  assert.equal(own.statusCode, 200, own.body);
  const rows = own.json().stamps as Record<string, unknown>[];
  assert.ok(rows.every((r) => r.transactionId !== elsewhere));
  const row = rows.find((r) => r.transactionId === completing)!;
  assert.equal(row.alias, 'Revoked');
  assert.equal(row.source, 'auto');
  assert.equal(row.balanceAfter, 0);
  assert.equal(row.rewardEarned, true);
  assert.equal(row.revoked, false);
  // A cashier's window is the shop setting (30 minutes); the owner's is 7 days.
  const cashierUntil = Date.parse(row.revocableUntil as string) - Date.parse(row.at as string);
  assert.equal(cashierUntil, 30 * 60_000);
  const ownerRow = (
    (await feed(owner, ids.branchA)).json().stamps as Record<string, unknown>[]
  ).find((r) => r.transactionId === completing)!;
  assert.equal(
    Date.parse(ownerRow.revocableUntil as string) - Date.parse(ownerRow.at as string),
    7 * 86_400_000,
  );
  // The welcome stamps of the same card are listed too.
  assert.ok(rows.some((r) => r.membershipId === here.membership && r.source === 'welcome'));
  // Branch B is refused outright, not filtered to an empty list.
  const other = await feed(cashier, ids.branchA2);
  assert.equal(other.statusCode, 403);
  assert.equal(errorCode(other), 'BRANCH_UNAUTHORIZED');
  // After a revoke the row stays, marked revoked and no longer revocable.
  assert.equal((await revoke(cashier, completing)).statusCode, 200);
  const after = (
    (await feed(cashier, ids.branchA)).json().stamps as Record<string, unknown>[]
  ).find((r) => r.transactionId === completing)!;
  assert.deepEqual([after.revoked, after.revocableUntil], [true, null]);
  await configure();
});

test('the branch stream announces an automatic stamp to that branch only', async () => {
  await configure();
  const base = await app.listen({ host: '127.0.0.1', port: 0 });
  type Event = { type: string; data: Record<string, string> };
  const streams: { events: Event[]; stop: () => void }[] = [];
  const open = async (as: Headers, branch: string) => {
    const controller = new AbortController();
    const response = await fetch(base + '/api/v1/branches/' + branch + '/events', {
      headers: as,
      signal: controller.signal,
    });
    if (response.status !== 200) {
      controller.abort();
      return response.status;
    }
    const events: Event[] = [],
      reader = response.body!.getReader(),
      decoder = new TextDecoder();
    void (async () => {
      let buffer = '';
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffer += decoder.decode(chunk.value, { stream: true });
          let split: number;
          while ((split = buffer.indexOf('\n\n')) >= 0) {
            const block = buffer.slice(0, split);
            buffer = buffer.slice(split + 2);
            const type = /^event: ([^\n]+)/m.exec(block)?.[1],
              data = /^data: (.+)/m.exec(block)?.[1];
            if (type && data) events.push({ type, data: JSON.parse(data) });
          }
        }
      } catch {
        /* aborted */
      }
    })();
    const stream = { events, stop: () => controller.abort() };
    streams.push(stream);
    return stream;
  };
  const until = async (check: () => boolean) => {
    const end = Date.now() + 3000;
    while (!check() && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
  };
  try {
    // The cashier cannot even open branch B's stream; the branch is not visible to them at all.
    assert.equal(await open(cashier, ids.branchA2), 404);
    const cashierA = (await open(cashier, ids.branchA)) as Exclude<
      Awaited<ReturnType<typeof open>>,
      number
    >;
    const ownerB = (await open(owner, ids.branchA2)) as typeof cashierA;
    await until(() => [cashierA, ownerB].every((s) => s.events.some((e) => e.type === 'sync')));
    const who = await customer();
    const atB = await autoStamp(who, ids.branchA2);
    await until(() => ownerB.events.some((e) => e.type === 'auto-stamp'));
    assert.deepEqual(
      ownerB.events.filter((e) => e.type === 'auto-stamp').map((e) => e.data.transactionId),
      [atB],
    );
    const atA = await autoStamp(who);
    await until(() => cashierA.events.some((e) => e.type === 'auto-stamp'));
    const seenByCashier = cashierA.events
      .filter((e) => e.type === 'auto-stamp')
      .map((e) => e.data.transactionId);
    assert.deepEqual(seenByCashier, [atA]);
    assert.ok(
      cashierA.events.every(
        (e) => e.data.branchId === undefined || e.data.branchId === ids.branchA,
      ),
    );
    // A revoke is ordinary activity: the list refreshes, nothing is announced as a new stamp.
    assert.equal((await revoke(cashier, atA)).statusCode, 200);
    await until(() => cashierA.events.filter((e) => e.type === 'activity').length >= 2);
    assert.equal(cashierA.events.filter((e) => e.type === 'auto-stamp').length, 1);
  } finally {
    for (const s of streams) s.stop();
  }
});
