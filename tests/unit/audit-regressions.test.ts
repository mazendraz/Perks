import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMapsPosition } from '../../packages/domain/src/geo.js';
import { catalogMoneyMinor, moneyMinor } from '../../packages/domain/src/subscriptions.js';
import {
  maxSubscriptionPeriodEnd,
  subscriptionPaymentInput,
} from '../../packages/contracts/src/subscriptions.js';

test('pasted map text with a stray percent sign is unreadable, not an exception', () => {
  assert.equal(parseMapsPosition('50% complete'), null);
  assert.equal(parseMapsPosition('%E0%A4%A'), null);
  assert.deepEqual(parseMapsPosition('30.0444, 31.2357'), {
    latitude: 30.0444,
    longitude: 31.2357,
  });
  assert.deepEqual(parseMapsPosition('https://maps.google.com/?q=30.1%2C31.2'), {
    latitude: 30.1,
    longitude: 31.2,
  });
});

test('catalog prices, setup fees and add-ons may be zero; payments may not', () => {
  assert.equal(catalogMoneyMinor('0'), 0);
  assert.equal(catalogMoneyMinor('0.00'), 0);
  assert.equal(catalogMoneyMinor('250'), 25000);
  assert.equal(catalogMoneyMinor('-1'), null);
  assert.equal(catalogMoneyMinor(''), null);
  assert.equal(moneyMinor('0'), null);
  assert.equal(moneyMinor('0.01'), 1);
});

test('a manual subscription period is at most five calendar years', () => {
  assert.equal(maxSubscriptionPeriodEnd('2026-11-23'), '2031-11-23');
  assert.equal(maxSubscriptionPeriodEnd('2028-02-29'), '2033-02-28');
  const base = { amountMinor: 100, method: 'cash', periodStart: '2026-11-23', reason: 'renewal' };
  for (const [end, ok] of [
    ['2026-11-23', true],
    ['2027-11-22', true],
    ['2031-11-23', true],
    ['2031-11-24', false],
    ['2031-11-27', false],
    ['2026-11-22', false],
  ] as const)
    assert.equal(subscriptionPaymentInput.safeParse({ ...base, periodEnd: end }).success, ok, end);
});
