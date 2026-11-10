import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merchantStatusLabel, subscriptionPlanLabel } from '../../apps/web/src/business-labels.js';
test('business status and subscription labels cover known values in both languages without exposing unknown internal codes', () => {
  assert.deepEqual(
    ['active', 'trial', 'suspended'].map((v) => merchantStatusLabel(v, 'ar')),
    ['نشط', 'تجريبي', 'موقوف'],
  );
  assert.deepEqual(
    ['starter', 'growth', 'pro'].map((v) => subscriptionPlanLabel(v, 'ar')),
    ['بداية', 'نمو', 'احترافية'],
  );
  assert.equal(merchantStatusLabel('active', 'en'), 'Active');
  assert.equal(subscriptionPlanLabel('growth', 'en'), 'Growth');
  assert.equal(merchantStatusLabel('FUTURE_INTERNAL_STATE', 'ar'), 'غير محدد');
  assert.equal(subscriptionPlanLabel(undefined, 'ar'), 'غير محدد');
});
