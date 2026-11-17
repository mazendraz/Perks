import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { messageFor, planLimitText, knownErrorCodes } from '../../apps/web/src/error-messages.js';

/** Every error code the server can send to a person. */
async function serverCodes() {
  const codes = new Set<string>();
  for (const f of await readdir('db/migrations'))
    for (const m of (await readFile('db/migrations/' + f, 'utf8')).matchAll(/NQ:([A-Z_]+)/g))
      codes.add(m[1]!);
  const walk = async (dir: string): Promise<string[]> =>
    (
      await Promise.all(
        (await readdir(dir, { withFileTypes: true })).map((e) =>
          e.isDirectory() ? walk(dir + '/' + e.name) : [dir + '/' + e.name],
        ),
      )
    ).flat();
  for (const f of (await walk('apps/api/src')).filter((f) => f.endsWith('.ts'))) {
    const src = await readFile(f, 'utf8');
    for (const m of src.matchAll(/new AppError\(\s*'([A-Z_]+)'/g)) codes.add(m[1]!);
    for (const m of src.matchAll(/requireCondition\([\s\S]*?,\s*'([A-Z_]+)'/g)) codes.add(m[1]!);
  }
  // Codes that never reach a screen (internal assertions or provider replies).
  for (const internal of [
    'ADMIN_REQUIRED_FOR_TEST',
    'ONE_USER_ALL_DEVICES',
    'MAIL_INTENT_CONFLICT',
    'INVALID_MAIL_OUTCOME',
    'SMTP_REJECTED',
    'SMTP_UNKNOWN',
  ])
    codes.delete(internal);
  return codes;
}

test('every error the server can send has a plain sentence in Arabic and English', async () => {
  const missing = [...(await serverCodes())].filter((c) => !knownErrorCodes.has(c));
  assert.deepEqual(missing, []);
  for (const code of knownErrorCodes)
    for (const lang of ['ar', 'en'] as const) {
      const text = messageFor(code, lang, 'staff');
      assert.ok(text.length > 8, code + ' ' + lang);
      assert.doesNotMatch(text, /[A-Z]{3,}_[A-Z_]+/, 'no raw codes in ' + code);
    }
});

test('messages never show a raw request id, only a short reference for unknown problems', () => {
  const id = '92e9cccd-6fcb-4306-a5bc-72d415b09d61';
  assert.equal(
    messageFor('REVISION_CONFLICT', 'ar', 'staff', undefined, id).includes('92e9'),
    false,
  );
  const unknown = messageFor('SOMETHING_NEW', 'ar', 'staff', undefined, id);
  assert.match(unknown, /رقم المشكلة: 92E9CCCD$/);
  assert.doesNotMatch(unknown, /-/);
});

test('customers never read about plans, payments or Perks admin', () => {
  for (const code of [
    'SUBSCRIPTION_INACTIVE',
    'EARNING_PAUSED',
    'MERCHANT_PAUSED',
    'PLAN_LIMIT_REACHED',
    'FEATURE_NOT_IN_PLAN',
    'SUBSCRIPTION_GRACE',
    'ENTITLEMENTS_NOT_CONFIGURED',
  ]) {
    const text = messageFor(code, 'ar', 'customer', {
      entitlement: 'max_branches',
      limit: 2,
      used: 2,
    });
    assert.doesNotMatch(text, /باقة|اشتراك|دفع|Perks|جنيه/, code);
  }
});

test('the plan limit sentence uses the real numbers and the ways out', () => {
  assert.equal(
    planLimitText(
      {
        entitlement: 'max_branches',
        limit: 2,
        used: 2,
        options: [
          { type: 'addon', key: 'extra_branch', price: 400 },
          { type: 'upgrade', plan: 'pro', price: 1500 },
        ],
      },
      'ar',
    ),
    'وصلت لحد باقتك في الفروع (2 من 2). تقدر تضيف فرع زيادة بـ 400 جنيه في الشهر، أو تطلّع Pro بـ 1,500.',
  );
  assert.equal(
    planLimitText(
      { entitlement: 'manual_messages_per_month', limit: 8, used: 8, options: [] },
      'ar',
    ),
    'خلصت رسايل الشهر ده (8 من 8). الرسايل بتتجدد أول الشهر الجاي.',
  );
  // A manager gets the ways out without prices.
  assert.equal(
    planLimitText(
      {
        entitlement: 'max_staff',
        limit: 3,
        used: 3,
        options: [{ type: 'upgrade', plan: 'growth' }],
      },
      'ar',
    ),
    'وصلت لحد باقتك في الموظفين (3 من 3). تقدر تطلّع Growth.',
  );
});
