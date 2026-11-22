import { z } from 'zod';

/** Kinds of business. Each has default "normal return" numbers in analytics_category_defaults. */
export const businessCategories = [
  'cafe',
  'bakery',
  'restaurant',
  'barber',
  'salon',
  'carwash',
  'gym',
  'workspace',
  'retail',
  'other',
] as const;
export type BusinessCategory = (typeof businessCategories)[number];
export const businessCategory = z.enum(businessCategories);

export const businessCategoryLabels: Record<BusinessCategory, { ar: string; en: string }> = {
  cafe: { ar: 'كافيه', en: 'Café' },
  bakery: { ar: 'مخبز / حلويات', en: 'Bakery / sweets' },
  restaurant: { ar: 'مطعم', en: 'Restaurant' },
  barber: { ar: 'حلاق', en: 'Barber' },
  salon: { ar: 'صالون / بيوتي', en: 'Salon / beauty' },
  carwash: { ar: 'مغسلة عربيات', en: 'Car wash' },
  gym: { ar: 'جيم / ستوديو', en: 'Gym / studio' },
  workspace: { ar: 'مساحة عمل', en: 'Workspace' },
  retail: { ar: 'محل / ملابس', en: 'Retail / clothing' },
  other: { ar: 'نشاط تاني', en: 'Other' },
};

const days = (max: number) => z.number().int().min(1).max(max).nullable();

/** NULL numbers mean "use my category's numbers". */
export const cadenceInput = z
  .object({
    category: businessCategory,
    expectedGapDays: days(180),
    atRiskAfterDays: days(300).optional().default(null),
    lostAfterDays: days(365),
  })
  .strict()
  .refine(
    (v) =>
      (v.expectedGapDays === null ||
        v.lostAfterDays === null ||
        v.expectedGapDays < v.lostAfterDays) &&
      (v.expectedGapDays === null ||
        v.atRiskAfterDays === null ||
        v.expectedGapDays < v.atRiskAfterDays) &&
      (v.atRiskAfterDays === null ||
        v.lostAfterDays === null ||
        v.atRiskAfterDays < v.lostAfterDays),
    { message: 'Days must grow: normal < late < gone.' },
  );
export type CadenceInput = z.input<typeof cadenceInput>;

export interface CategoryDefaults {
  category: BusinessCategory;
  expectedGapDays: number;
  atRiskAfterDays: number;
  lostAfterDays: number;
}
export interface Cadence {
  category: BusinessCategory;
  confirmed: boolean;
  /** Effective numbers after the shop's own settings. */
  gap: number;
  risk: number;
  lost: number;
  customized: boolean;
  /** What the shop typed, if anything. */
  own: {
    expectedGapDays: number | null;
    atRiskAfterDays: number | null;
    lostAfterDays: number | null;
  };
  defaults: CategoryDefaults[];
}

export const categoryDefaultsInput = z
  .object({
    expectedGapDays: z.number().int().min(1).max(180),
    atRiskAfterDays: z.number().int().min(2).max(300),
    lostAfterDays: z.number().int().min(3).max(365),
  })
  .strict()
  .refine((v) => v.expectedGapDays < v.atRiskAfterDays && v.atRiskAfterDays < v.lostAfterDays);

// ── The analytics page ─────────────────────────────────────────────────────────────────────────

export const analyticsQuery = z
  .object({
    days: z.coerce
      .number()
      .int()
      .refine((n) => [7, 30, 90].includes(n))
      .default(30),
    branchId: z.uuid().optional(),
  })
  .strict();
export type AnalyticsPeriod = 7 | 30 | 90;

export const lifecycles = [
  'never',
  'new',
  'one_time',
  'regular',
  'at_risk',
  'lost',
  'reactivated',
] as const;
export type Lifecycle = (typeof lifecycles)[number];
export const customerTags = ['near_reward', 'reward_holder', 'vip'] as const;
export type CustomerTag = (typeof customerTags)[number];
/** A list of customers the owner can open or message: a lifecycle or a tag. */
export const segmentKeys = [...lifecycles, ...customerTags] as const;
export type SegmentKey = (typeof segmentKeys)[number];
export const segmentKey = z.enum(segmentKeys);

/**
 * The page's sections and the analytics level each needs. Every plan is on "advanced" today, so all
 * are open; moving a section up later is a catalog change, and subscribers keep it until their
 * period ends (entitlement snapshots).
 */
export const analyticsSections = {
  actions: 'basic',
  kpis: 'basic',
  trend: 'basic',
  value: 'basic',
  segments: 'basic',
  atRisk: 'basic',
  segmentList: 'basic',
  customer: 'basic',
  funnel: 'basic',
  distribution: 'basic',
  branches: 'basic',
  heat: 'basic',
  messageImpact: 'basic',
  health: 'basic',
  cohorts: 'basic',
  export: 'basic',
} as const satisfies Record<string, 'basic' | 'branches' | 'advanced'>;
export type AnalyticsSection = keyof typeof analyticsSections;
const levelRank = { basic: 0, branches: 1, advanced: 2 } as const;
export function sectionsFor(level: unknown): Record<AnalyticsSection, boolean> {
  const have = levelRank[(level as keyof typeof levelRank) ?? 'basic'] ?? 0;
  return Object.fromEntries(
    Object.entries(analyticsSections).map(([k, need]) => [k, have >= levelRank[need]]),
  ) as Record<AnalyticsSection, boolean>;
}

/** A section that needs a minimum of data says so instead of showing noise. */
export type Gate<T> =
  | ({ status: 'ready' } & T)
  | { status: 'not_enough_data'; have: number; need: number }
  | { status: 'locked' };

export interface ActionCard {
  key: 'at_risk' | 'near_reward' | 'one_time' | 'reward_holder';
  count: number;
}
export interface Kpis {
  customers: number;
  active: number;
  newCustomers: number;
  visits: number;
  /** Share of this period's visitors who had been before, 0–100; null with no visitors. */
  returnRate: number | null;
  /** Median personal rhythm of customers who have one, in days. */
  typicalGapDays: number | null;
  previous: { active: number; newCustomers: number; visits: number; returnRate: number | null };
}
export interface AtRiskCustomer {
  profileId: string;
  alias: string;
  expectedGapDays: number;
  sinceDays: number;
  stampsToReward: number | null;
}
export interface FunnelStep {
  key: 'registered' | 'first_visit' | 'second_visit' | 'reward_earned' | 'reward_redeemed';
  count: number;
}
export interface HealthPart {
  key: 'return' | 'second_visit' | 'completion' | 'redemption' | 'active';
  /** Percent achieved, 0–100. */
  value: number;
  /** The target percent this part is measured against. */
  target: number;
  weight: number;
}
/** Targets a healthy loyalty programme reaches; each part scores value/target, capped at 1. */
export const healthTargets: Record<HealthPart['key'], { target: number; weight: number }> = {
  return: { target: 50, weight: 30 },
  second_visit: { target: 50, weight: 25 },
  completion: { target: 25, weight: 20 },
  redemption: { target: 80, weight: 15 },
  active: { target: 50, weight: 10 },
};
export function healthScore(values: Record<HealthPart['key'], number>) {
  const parts = (Object.keys(healthTargets) as HealthPart['key'][]).map((key) => ({
    key,
    value: Math.round(values[key]),
    ...healthTargets[key],
  }));
  const score = Math.round(
    parts.reduce((n, p) => n + p.weight * Math.min(1, p.value / p.target), 0),
  );
  const weakest = parts.reduce((w, p) => (p.value / p.target < w.value / w.target ? p : w)).key;
  return { score, weakest, parts };
}
export interface BranchRow {
  id: string;
  name: string;
  visits: number;
  newCustomers: number;
  returnRate: number | null;
  medianApprovalSeconds: number | null;
  pending: number;
}
export interface AnalyticsResponse {
  period: { days: AnalyticsPeriod; from: string; to: string; timezone: string };
  updatedAt: string;
  statsRefreshedAt: string | null;
  cadence: {
    category: BusinessCategory;
    confirmed: boolean;
    gap: number;
    risk: number;
    lost: number;
  };
  sections: Record<AnalyticsSection, boolean>;
  actions: ActionCard[];
  kpis: Kpis;
  trend: { day: string; visits: number }[];
  value: { returningVisits: number; visitsAfterMessages: number };
  segments: Record<SegmentKey, number>;
  atRisk: AtRiskCustomer[];
  funnel: Gate<{ steps: FunnelStep[] }>;
  distribution: Gate<{ buckets: [number, number, number, number, number] }>;
  /** Saturday first; slots: 6–11, 11–14, 14–17, 17–20, 20–6 in the shop's time. */
  heat: Gate<{ cells: number[][]; quietest: { day: number; slot: number } }>;
  branches: BranchRow[];
  /** 0–100 against simple targets; shown once the shop has enough history. */
  health: Gate<{ score: number; weakest: HealthPart['key']; parts: HealthPart[] }>;
  /** Customers by the month of their first visit, and how many came back within 30 days. */
  cohorts: Gate<{ rows: { month: string; first: number; back30: number }[] }>;
  /** The latest Wallet message to each group in the last 60 days, and who came back after it. */
  messageImpact: { audience: string; sentAt: string; recipients: number; returned: number }[];
}

export interface SegmentCustomer {
  profileId: string;
  alias: string;
  lifecycle: Lifecycle;
  tags: CustomerTag[];
  visits: number;
  sinceDays: number | null;
  expectedGapDays: number;
  stampsToReward: number | null;
  lastVisitAt: string | null;
}
export interface SegmentPage {
  key: SegmentKey;
  total: number;
  customers: SegmentCustomer[];
  nextCursor: string | null;
}
export const segmentQuery = z
  .object({
    cursor: z.string().max(200).optional(),
    q: z.string().trim().max(60).optional(),
    branchId: z.uuid().optional(),
  })
  .strict();

export type TimelineEvent =
  | { kind: 'visit'; at: string; branch: string | null; stamps: number; receipts: string[] }
  | { kind: 'reward_earned' | 'reward_redeemed'; at: string; title: string }
  | { kind: 'message'; at: string; text: string; source: 'owner' | 'reminder' };
export interface CustomerInsights {
  profileId: string;
  alias: string;
  joinedAt: string;
  lifecycle: Lifecycle;
  tags: CustomerTag[];
  visits: number;
  visits90d: number;
  sinceDays: number | null;
  expectedGapDays: number;
  personalGapDays: number | null;
  stampsToReward: number | null;
  rewardsEarned: number;
  rewardsRedeemed: number;
  walletSaved: boolean;
  favoriteBranch: string | null;
  timeline: TimelineEvent[];
}
