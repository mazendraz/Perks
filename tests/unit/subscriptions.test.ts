import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneyMinor } from '../../packages/domain/src/subscriptions.js';
import { subscriptionPaymentInput } from '../../packages/contracts/src/subscriptions.js';
test('manual EGP amounts preserve piastres and reject rounding, ambiguous separators, coercion and invalid dates', () => {
  for (const [value, minor] of [
    ['950', 95000],
    ['950.50', 95050],
    ['0.01', 1],
    ['٠٫١٠', 10],
    ['۹۵۰٫۵۰', 95050],
    [' 000950,5 ', 95050],
    ['10000000', 1000000000],
  ] as const)
    assert.equal(moneyMinor(value), minor);
  for (const value of ['', '0', '-1', '1e3', '1,000', '1.234', '10000000.01', '1.2.3', 'Infinity'])
    assert.equal(moneyMinor(value), null);
  const body = {
    amountMinor: 95050,
    method: 'instapay',
    periodStart: '2028-02-29',
    periodEnd: '2028-03-01',
    reason: 'Synthetic fixture',
  };
  assert.equal(subscriptionPaymentInput.safeParse(body).success, true);
  for (const change of [
    { amountMinor: '95050' },
    { amountMinor: 95050.5 },
    { amountMinor: 0 },
    { periodStart: '2026-02-29' },
    { periodEnd: '2028-02-28' },
    { periodEnd: '2040-01-01' },
  ])
    assert.equal(subscriptionPaymentInput.safeParse({ ...body, ...change }).success, false);
});
