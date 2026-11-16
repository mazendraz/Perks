/**
 * The public price list shown on the /business landing page (Egypt, EGP per month, excluding VAT).
 *
 * This is marketing copy, not enforcement. Server-side limits come from the database plan tables
 * (seeded from these same numbers); a unit test keeps the two in step once those tables exist.
 */
export type PublicPlanKey = 'starter' | 'growth' | 'pro' | 'scale';

export interface PublicPlan {
  key: PublicPlanKey;
  name: string;
  monthlyPrice: number;
  includedBranches: number;
  /** null = no staff cap (fair use). */
  includedStaff: number | null;
  activePrograms: number;
  manualMessagesPerMonth: number;
  /** null = no extra-branch add-on on this plan (upgrade instead). */
  extraBranchPrice: number | null;
  /** null = staff are not sold separately on this plan. */
  extraStaffPrice: number | null;
  /** Total branches (included + add-ons) this plan can reach. */
  maxTotalBranches: number;
}

export const publicPlanCurrency = 'EGP';
/** Annual billing: pay 10 months, get 12. */
export const annualPaidMonths = 10;
export const setupFeePerBranch = 500;
/** Above this many branches the answer is Enterprise (contact sales). */
export const enterpriseBranchThreshold = 10;

export const publicPlanCatalog: readonly PublicPlan[] = [
  {
    key: 'starter',
    name: 'Starter',
    monthlyPrice: 500,
    includedBranches: 1,
    includedStaff: 3,
    activePrograms: 1,
    manualMessagesPerMonth: 2,
    extraBranchPrice: null,
    extraStaffPrice: 50,
    maxTotalBranches: 1,
  },
  {
    key: 'growth',
    name: 'Growth',
    monthlyPrice: 900,
    includedBranches: 2,
    includedStaff: 6,
    activePrograms: 3,
    manualMessagesPerMonth: 8,
    extraBranchPrice: 400,
    extraStaffPrice: 50,
    maxTotalBranches: enterpriseBranchThreshold,
  },
  {
    key: 'pro',
    name: 'Pro',
    monthlyPrice: 1500,
    includedBranches: 4,
    includedStaff: 12,
    activePrograms: 5,
    manualMessagesPerMonth: 15,
    extraBranchPrice: 350,
    extraStaffPrice: 50,
    maxTotalBranches: enterpriseBranchThreshold,
  },
  {
    key: 'scale',
    name: 'Scale',
    monthlyPrice: 2500,
    includedBranches: 10,
    includedStaff: null,
    activePrograms: 10,
    manualMessagesPerMonth: 30,
    extraBranchPrice: 250,
    extraStaffPrice: null,
    maxTotalBranches: enterpriseBranchThreshold,
  },
];
