import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  merchantStatusLabel,
  subscriptionPlanLabel,
  staffRoleLabel,
  staffStatusLabel,
  placementKindLabel,
  placementStatusLabel,
} from '../../apps/web/src/business-labels.js';
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
  assert.deepEqual(
    ['owner', 'manager', 'cashier'].map((v) => staffRoleLabel(v, 'ar')),
    ['مالك', 'مدير', 'كاشير'],
  );
  assert.equal(staffStatusLabel('active', 'ar'), 'نشط');
  assert.equal(staffStatusLabel('disabled', 'ar'), 'موقوف');
  assert.equal(staffRoleLabel('cashier', 'en'), 'Cashier');
  assert.equal(staffStatusLabel('disabled', 'en'), 'Disabled');
  assert.equal(staffRoleLabel('FUTURE', 'ar'), 'غير محدد');
  assert.equal(staffStatusLabel('FUTURE', 'ar'), 'غير محدد');
  assert.deepEqual(
    ['requested', 'ready', 'shipped', 'installed', 'verified', 'revoked'].map((v) =>
      placementStatusLabel(v, 'ar'),
    ),
    ['مطلوبة', 'جاهزة', 'اتشحنت', 'اتركبت', 'اتجربت واشتغلت', 'الرابط ملغي'],
  );
  assert.deepEqual(
    ['stand', 'sticker', 'nfc'].map((v) => placementKindLabel(v, 'ar')),
    ['حامل على الكاونتر', 'ستيكر', 'تاج NFC'],
  );
  assert.equal(placementStatusLabel('requested', 'en'), 'Requested');
  assert.equal(placementKindLabel('stand', 'en'), 'Counter stand');
  assert.equal(placementStatusLabel('FUTURE', 'ar'), 'غير محدد');
  assert.equal(placementKindLabel('FUTURE', 'ar'), 'غير محدد');
});
