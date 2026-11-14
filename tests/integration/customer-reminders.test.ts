import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import pg from 'pg';
import { randomUUID, generateKeyPairSync } from 'node:crypto';
import { readConfig } from '../../apps/api/src/config.js';
import { buildApp } from '../../apps/api/src/server.js';
import { seed, ids } from '../../db/seed.js';
import { key, login } from '../helpers.js';
import {
  reminderDefaults,
  stampsLeftText,
} from '../../packages/contracts/src/customer-reminders.js';
import { deliverCustomerReminder } from '../../apps/worker/src/customer-reminders.js';
import type { GoogleWallet } from '../../apps/api/src/wallet/google-wallet.js';
import { passJson, texts, type AppleWalletSigner } from '../../apps/api/src/wallet/apple-pass.js';

const c = readConfig(),
  db = new pg.Client({ connectionString: c.DATABASE_MIGRATOR_URL }),
  worker = new pg.Pool({ connectionString: c.WORKER_DATABASE_URL, max: 2 }),
  { app } = await buildApp({ APP_ENV: 'test', LOG_LEVEL: 'silent' }),
  base = '/api/v1/merchants/' + ids.merchantA + '/customer-reminders';
let owner: Awaited<ReturnType<typeof login>>,
  customer: typeof owner,
  membership: string,
  profile: string;
before(async () => {
  await db.connect();
  await seed(db);
  await app.ready();
  owner = await login(app, 'owner@bunn.test');
  customer = await login(app, 'reminder-' + randomUUID() + '@example.test');
  const program = (await app.inject({ url: '/api/v1/public/merchants/bunn' })).json().programs[0];
  const joined = await app.inject({
    method: 'POST',
    url: '/api/v1/me/memberships',
    headers: { ...customer, ...key() },
    payload: {
      merchantId: ids.merchantA,
      programId: program.id,
      programVersionId: program.versionId,
      alias: 'مريم',
      acceptedTerms: true,
      acceptedTermsHash: program.termsHash,
    },
  });
  assert.equal(joined.statusCode, 200, joined.body);
  membership = joined.json().membershipId;
  profile = (await db.query('SELECT profile_id FROM memberships WHERE id=$1', [membership])).rows[0]
    .profile_id;
  const offset = new Date().getUTCHours() - 12;
  await db.query('UPDATE merchants SET timezone=$1 WHERE id=$2', [
    'Etc/GMT' + (offset >= 0 ? '+' : '') + offset,
    ids.merchantA,
  ]);
  await db.query(
    "INSERT INTO google_wallet_objects(membership_id,merchant_id,fingerprint) VALUES($1,$2,'')",
    [membership, ids.merchantA],
  );
  const serial = (
    await db.query(
      "INSERT INTO wallet_passes(membership_id,merchant_id,auth_token_hash,fingerprint) VALUES($1,$2,$3,'') RETURNING serial",
      [membership, ids.merchantA, 'a'.repeat(64)],
    )
  ).rows[0].serial;
  await db.query(
    "INSERT INTO wallet_registrations(device_library_id,serial,push_token) VALUES('reminder-fixture',$1,$2)",
    [serial, 'b'.repeat(64)],
  );
});
after(async () => {
  await db.query("UPDATE merchants SET timezone='Africa/Cairo' WHERE id=$1", [ids.merchantA]);
  await db.query(
    "UPDATE customer_reminder_settings SET settings=jsonb_set(settings,'{enabled}','false') WHERE merchant_id=$1",
    [ids.merchantA],
  );
  await app.close();
  await worker.end();
  await db.end();
});
async function purchase(at: string, source = 'auto') {
  const operation = (
    await db.query(
      "INSERT INTO operations(actor_id,merchant_id,scope,idempotency_key,request_hash) VALUES($1,$2,'reminder.fixture',$3,'fixture') RETURNING id",
      [ids.ownerA, ids.merchantA, randomUUID()],
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO loyalty_transactions(public_reference,merchant_id,membership_id,program_version_id,branch_id,operation_id,type,quantity,source,at)
    SELECT $1,merchant_id,id,program_version_id,$3,$4,'award',1,$5,$6 FROM memberships WHERE id=$2`,
    [randomUUID(), membership, ids.branchA, operation, source, at],
  );
}
const schedule = async () =>
  (await worker.query('SELECT schedule_customer_reminders(true,true) AS count')).rows[0]
    .count as number;
const claim = async () =>
  (await worker.query('SELECT claim_customer_reminder(true,true) AS job')).rows[0].job;
async function consent(granted: boolean) {
  const r = await app.inject({
    method: 'PATCH',
    url: '/api/v1/me/merchants/' + ids.merchantA + '/preferences',
    headers: customer,
    payload: { channel: 'push', granted },
  });
  assert.equal(r.statusCode, 200, r.body);
}

test('settings, customer consent, scheduling, leases, delivery and return tracking work through normal entry points', async () => {
  const initial = await app.inject({ url: base, headers: owner });
  assert.equal(initial.statusCode, 200, initial.body);
  assert.equal(initial.json().settings.enabled, false);
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: base,
        headers: { ...owner, ...key(), 'if-match': '0' },
        payload: { ...reminderDefaults, wallet: { ar: 'Hello {unknown}', en: 'Hello' } },
      })
    ).statusCode,
    422,
  );
  const settings = { ...reminderDefaults, enabled: true, sendHour: 8 };
  const headers = { ...owner, ...key(), 'if-match': '0' };
  const save = await app.inject({ method: 'PATCH', url: base, headers, payload: settings });
  assert.equal(save.statusCode, 200, save.body);
  assert.equal(
    (await app.inject({ method: 'PATCH', url: base, headers, payload: settings })).statusCode,
    200,
  );
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: base,
        headers: { ...owner, ...key(), 'if-match': '0' },
        payload: settings,
      })
    ).statusCode,
    409,
  );
  const otherOwner = await login(app, 'owner@lamsa.test');
  assert.equal((await app.inject({ url: base, headers: otherOwner })).statusCode, 404);
  const cashier = await login(app, 'cashier@bunn.test');
  assert.equal(
    (
      await app.inject({
        method: 'PATCH',
        url: base,
        headers: { ...cashier, ...key(), 'if-match': '1' },
        payload: settings,
      })
    ).statusCode,
    403,
  );
  const preferences = (
    await app.inject({
      url: '/api/v1/me/merchants/' + ids.merchantA + '/preferences',
      headers: customer,
    })
  ).json().preferences;
  assert.equal(preferences.find((p: { channel: string }) => p.channel === 'push').granted, false);
  await consent(true);
  // Welcome stamps do not count as a confirmed visit.
  await purchase(new Date(Date.now() - 21 * 86400000).toISOString(), 'welcome');
  assert.equal(await schedule(), 0);
  // Managers can use the merchant's templates without seeing full-tenant reminder activity.
  await db.query("UPDATE staff_memberships SET role='manager' WHERE id=$1", [ids.staffA]);
  try {
    const restricted = await app.inject({ url: base, headers: owner });
    assert.equal(restricted.statusCode, 200, restricted.body);
    assert.equal(restricted.json().canManage, false);
    assert.equal(restricted.json().stats, null);
    assert.deepEqual(restricted.json().recent, []);
    assert.equal(
      (
        await app.inject({
          method: 'PATCH',
          url: base,
          headers: { ...owner, ...key(), 'if-match': '1' },
          payload: settings,
        })
      ).statusCode,
      403,
    );
  } finally {
    await db.query("UPDATE staff_memberships SET role='owner' WHERE id=$1", [ids.staffA]);
  }
  await purchase(new Date(Date.now() - 20 * 86400000).toISOString());
  await consent(false);
  assert.equal(await schedule(), 0);
  await consent(true);
  const concurrent = await Promise.all([schedule(), schedule()]);
  assert.equal(
    concurrent.reduce((a, b) => a + b, 0),
    2,
  );
  assert.equal(await schedule(), 0);
  const jobs = await Promise.all([claim(), claim()]);
  assert.equal(new Set(jobs.map((job) => job.id)).size, 2);
  assert.equal(await claim(), null);
  const apple = jobs.find((job) => job.channel === 'apple'),
    google = jobs.find((job) => job.channel === 'google');
  const card = (await db.query('SELECT wallet_card_json($1) AS card', [membership])).rows[0].card;
  assert.ok(card.reminder_templates?.wallet, 'the pass gets the shop templates');
  assert.equal(card.reminder_ar, undefined);
  const pass = passJson(card, {
    serial: randomUUID(),
    authToken: 'test',
    origin: 'https://example.test',
    signer: { passTypeIdentifier: 'pass.test', teamIdentifier: 'TEST' } as AppleWalletSigner,
  });
  const reminderValue = pass.storeCard.backFields.find((field) => field.key === 'reminder')!.value;
  assert.match(reminderValue, /^reminder_[a-f0-9]+$/);
  const arText = (texts(card).ar as Record<string, string>)[reminderValue]!,
    left = card.threshold - card.display_balance;
  // Written for this customer: their name and their own stamps left.
  assert.match(arText, /مريم/);
  assert.ok(arText.includes(stampsLeftText(left, 'ar')), arText);
  assert.ok(
    (texts(card).en as Record<string, string>)[reminderValue]!.includes(stampsLeftText(left, 'en')),
  );
  let pushes = 0;
  const appleResult = await deliverCustomerReminder(apple, worker, {
    apple: async () => {
      pushes++;
      return 200;
    },
  });
  assert.equal(appleResult.outcome, 'accepted');
  assert.equal(pushes, 1);
  // A stale worker cannot finish another worker's lease.
  await worker.query("SELECT finish_customer_reminder($1,$2,'accepted',NULL)", [
    apple.id,
    randomUUID(),
  ]);
  assert.equal(
    (await db.query('SELECT status FROM customer_reminders WHERE id=$1', [apple.id])).rows[0]
      .status,
    'processing',
  );
  await worker.query("SELECT finish_customer_reminder($1,$2,'accepted',NULL)", [
    apple.id,
    apple.lease,
  ]);
  // A withdrawn consent cancels an already claimed reminder before transport.
  await consent(false);
  const skipped = await deliverCustomerReminder(google, worker, {});
  assert.equal(skipped.outcome, 'skipped');
  assert.equal(
    (await db.query('SELECT wallet_card_json($1) AS card', [membership])).rows[0].card
      .reminder_templates,
    null,
  );
  await consent(true);
  // A lost POST response is reconciled by GET. Duplicate message IDs alone do not deduplicate Google sends.
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  let posts = 0,
    seen = false;
  const provider: GoogleWallet = {
    issuerId: '12345',
    clientEmail: 'reminders@example.test',
    privateKey: keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    fetch: async (url, init) => {
      if (String(url).includes('oauth2'))
        return Response.json({ access_token: 'fixture', expires_in: 3600 });
      if (init?.method === 'POST') {
        posts++;
        seen = true;
        throw new Error('lost response');
      }
      return Response.json({ messages: seen ? [{ id: google.id }] : [] });
    },
  };
  const uncertain = await deliverCustomerReminder(google, worker, { google: provider });
  assert.equal(uncertain.outcome, 'uncertain');
  const reconciled = await deliverCustomerReminder({ ...google, reconcileOnly: true }, worker, {
    google: provider,
  });
  assert.equal(reconciled.outcome, 'accepted');
  assert.equal(posts, 1);
  seen = false;
  assert.equal(
    (
      await deliverCustomerReminder({ ...google, reconcileOnly: true }, worker, {
        google: provider,
      })
    ).outcome,
    'uncertain',
  );
  assert.equal(posts, 1);
  await worker.query("SELECT finish_customer_reminder($1,$2,'accepted',NULL)", [
    google.id,
    google.lease,
  ]);
  // The same absence gets the next reminder once cooldownDays pass, up to maxReminders (3).
  const age = (days: number) =>
    db.query(
      `UPDATE customer_reminders SET created_at=created_at-make_interval(days=>$2) WHERE profile_id=$1`,
      [profile, days],
    );
  assert.equal(await schedule(), 0, 'cooldown holds the next reminder');
  await age(settings.cooldownDays + 1);
  assert.equal(await schedule(), 2, 'second reminder, one per channel');
  await age(settings.cooldownDays + 1);
  assert.equal(await schedule(), 2, 'third reminder');
  await age(settings.cooldownDays + 1);
  assert.equal(await schedule(), 0, 'no more than maxReminders per absence');
  assert.deepEqual(
    (
      await db.query(
        "SELECT array_agg(step ORDER BY step) AS steps FROM customer_reminders WHERE profile_id=$1 AND channel='apple'",
        [profile],
      )
    ).rows[0].steps,
    [1, 2, 3],
  );
  // A visit restarts the absence: the queued third reminder is dropped before it is sent,
  // and nothing new is scheduled the same day. Collecting a reward counts as a visit too.
  const operation = (
    await db.query(
      "INSERT INTO operations(actor_id,merchant_id,scope,idempotency_key,request_hash) VALUES($1,$2,'reminder.fixture',$3,'fixture') RETURNING id",
      [ids.ownerA, ids.merchantA, randomUUID()],
    )
  ).rows[0].id;
  await db.query(
    `INSERT INTO loyalty_transactions(public_reference,merchant_id,membership_id,program_version_id,branch_id,staff_id,operation_id,type,quantity,source)
    SELECT $1,merchant_id,id,program_version_id,$3,$4,$5,'redeem',0,'redemption' FROM memberships WHERE id=$2`,
    [randomUUID(), membership, ids.branchA, ids.staffA, operation],
  );
  assert.equal(await claim(), null);
  assert.equal(await claim(), null);
  assert.deepEqual(
    (
      await db.query(
        'SELECT DISTINCT status FROM customer_reminders WHERE profile_id=$1 AND step=3',
        [profile],
      )
    ).rows,
    [{ status: 'skipped' }],
  );
  await age(settings.cooldownDays + 1);
  assert.equal(await schedule(), 0, 'no reminder on the day of a visit');
  await purchase('now');
  await schedule();
  assert.equal(
    (
      await db.query(
        'SELECT count(*)::int AS count FROM customer_reminders WHERE profile_id=$1 AND returned_at IS NOT NULL',
        [profile],
      )
    ).rows[0].count,
    2,
  );
  const stats = (await app.inject({ url: base, headers: owner })).json().stats;
  assert.equal(stats.customers, 1);
  assert.equal(stats.returned, 1);
  assert.equal(await schedule(), 0);
  // Public strip data keeps an explicit projection and never exposes reminder text or names.
  const strip = (
    await db.query(
      'SELECT google_wallet_strip(object_key) AS strip FROM google_wallet_objects WHERE membership_id=$1',
      [membership],
    )
  ).rows[0].strip;
  assert.equal(strip.reminder_templates, undefined);
  assert.equal(strip.customer_name, undefined);
});
