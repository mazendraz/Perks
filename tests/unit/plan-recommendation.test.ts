import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  publicPlanCatalog,
  annualPaidMonths,
  enterpriseBranchThreshold,
} from '../../packages/contracts/src/plan-catalog.js';
import {
  recommendPlan,
  quotePlan,
  annualPrice,
} from '../../packages/domain/src/plan-recommendation.js';

function pick(branches: number, staff: number) {
  const r = recommendPlan(publicPlanCatalog, branches, staff);
  return r.kind === 'enterprise'
    ? 'enterprise'
    : `${r.quote.plan.key}+${r.quote.extraBranches}b+${r.quote.extraStaff}s=${r.quote.monthlyTotal}`;
}

test('the landing recommends the cheapest plan that fits, add-ons included', () => {
  assert.equal(pick(1, 1), 'starter+0b+0s=500');
  assert.equal(pick(1, 3), 'starter+0b+0s=500');
  // Extra staff on Starter is still cheaper than moving to Growth.
  assert.equal(pick(1, 6), 'starter+0b+3s=650');
  assert.equal(pick(2, 4), 'growth+0b+0s=900');
  // Growth + one extra branch (1,300) beats Pro (1,500).
  assert.equal(pick(3, 4), 'growth+1b+0s=1300');
  // Growth + two branches (1,700) loses to Pro (1,500).
  assert.equal(pick(4, 8), 'pro+0b+0s=1500');
  assert.equal(pick(5, 12), 'pro+1b+0s=1850');
  assert.equal(pick(4, 13), 'pro+0b+1s=1550');
  // Ten branches: Scale (2,500) beats Pro + 6 branches (3,600).
  assert.equal(pick(10, 40), 'scale+0b+0s=2500');
  assert.equal(pick(enterpriseBranchThreshold + 1, 5), 'enterprise');
});

test('Starter never sells an extra branch and Scale never sells staff', () => {
  const starter = publicPlanCatalog.find((p) => p.key === 'starter')!;
  const scale = publicPlanCatalog.find((p) => p.key === 'scale')!;
  assert.equal(quotePlan(starter, 2, 1), null);
  assert.equal(quotePlan(scale, 10, 500)?.extraStaff, 0);
  assert.equal(quotePlan(scale, 11, 1), null);
});

test('annual billing charges 10 months for 12', () => {
  assert.equal(annualPaidMonths, 10);
  assert.equal(annualPrice(900, annualPaidMonths), 9000);
});

test('counts must be whole positive numbers', () => {
  assert.throws(() => recommendPlan(publicPlanCatalog, 0, 1), RangeError);
  assert.throws(() => recommendPlan(publicPlanCatalog, 2.5, 1), RangeError);
  assert.throws(() => recommendPlan(publicPlanCatalog, 2, Number.NaN), RangeError);
});

test('the catalog matches the agreed price list', () => {
  assert.deepEqual(
    publicPlanCatalog.map((p) => [p.key, p.monthlyPrice, p.includedBranches, p.includedStaff]),
    [
      ['starter', 500, 1, 3],
      ['growth', 900, 2, 6],
      ['pro', 1500, 4, 12],
      ['scale', 2500, 10, null],
    ],
  );
});
