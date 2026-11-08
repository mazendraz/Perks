import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awardMath, normalizeReceipt, businessDate } from '../../packages/domain/src/loyalty.js';
test('threshold conservation across quantities and multiple reward grants', () => {
  for (let threshold = 2; threshold <= 50; threshold++)
    for (let balance = 0; balance < threshold; balance++)
      for (let qty = 1; qty <= 100; qty++) {
        const r = awardMath(balance, qty, threshold);
        assert.equal(r.balanceAfter + r.rewardCount * threshold, balance + qty);
        assert.ok(r.balanceAfter >= 0 && r.balanceAfter < threshold);
      }
  assert.deepEqual(awardMath(4, 2, 5), { balanceAfter: 1, rewardCount: 1 });
  assert.deepEqual(awardMath(4, 12, 5), { balanceAfter: 1, rewardCount: 3 });
  assert.throws(() => awardMath(4, 1.5, 5));
});
test('receipt normalization handles case, whitespace and Arabic numerals consistently', () => {
  assert.equal(normalizeReceipt(' r-١٢٣ '), 'R-123');
  assert.equal(normalizeReceipt('R-۱۲۳'), 'R-123');
  assert.equal(normalizeReceipt(' R   123 '), 'R 123');
  assert.equal(businessDate('Africa/Cairo', new Date('2026-11-07T23:30:00Z')), '2026-11-08');
});
