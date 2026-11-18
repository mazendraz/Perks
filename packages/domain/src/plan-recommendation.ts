import type { PublicPlan } from '../../contracts/src/plan-catalog.js';
import { enterpriseBranchThreshold } from '../../contracts/src/plan-catalog.js';

export interface PlanQuote {
  plan: PublicPlan;
  extraBranches: number;
  extraStaff: number;
  /** Monthly total in whole currency units, add-ons included. */
  monthlyTotal: number;
}

export type PlanRecommendation = { kind: 'plan'; quote: PlanQuote } | { kind: 'enterprise' };

function wholeCount(value: number, label: string) {
  if (!Number.isInteger(value) || value < 1)
    throw new RangeError(label + ' must be a whole number ≥ 1');
  return value;
}

/** What one plan would cost for this shop, or null when the plan cannot fit it. */
export function quotePlan(plan: PublicPlan, branches: number, staff: number): PlanQuote | null {
  wholeCount(branches, 'branches');
  wholeCount(staff, 'staff');
  if (branches > plan.maxTotalBranches) return null;
  const extraBranches = Math.max(0, branches - plan.includedBranches);
  if (extraBranches > 0 && plan.extraBranchPrice === null) return null;
  const extraStaff = plan.includedStaff === null ? 0 : Math.max(0, staff - plan.includedStaff);
  if (extraStaff > 0 && plan.extraStaffPrice === null) return null;
  return {
    plan,
    extraBranches,
    extraStaff,
    monthlyTotal:
      plan.monthlyPrice +
      extraBranches * (plan.extraBranchPrice ?? 0) +
      extraStaff * (plan.extraStaffPrice ?? 0),
  };
}

/**
 * The cheapest plan (with add-ons) that fits the shop. On a price tie the bigger plan wins, since it
 * includes more. More than the Enterprise threshold of branches always means Enterprise.
 */
export function recommendPlan(
  catalog: readonly PublicPlan[],
  branches: number,
  staff: number,
): PlanRecommendation {
  wholeCount(branches, 'branches');
  wholeCount(staff, 'staff');
  if (branches > enterpriseBranchThreshold) return { kind: 'enterprise' };
  let best: PlanQuote | null = null;
  for (const plan of catalog) {
    const quote = quotePlan(plan, branches, staff);
    if (quote && (!best || quote.monthlyTotal <= best.monthlyTotal)) best = quote;
  }
  return best ? { kind: 'plan', quote: best } : { kind: 'enterprise' };
}

/** Annual price for a monthly amount: pay `paidMonths`, get 12. */
export function annualPrice(monthly: number, paidMonths: number) {
  return monthly * paidMonths;
}
