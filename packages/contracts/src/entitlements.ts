import { z } from 'zod';

/** Limits counted against a number (null in an effective set = unlimited). */
export const limitKeys = [
  'max_branches',
  'max_staff',
  'max_active_programs',
  'manual_messages_per_month',
] as const;
export type LimitKey = (typeof limitKeys)[number];

export const booleanFeatureKeys = [
  'merchant_branding',
  'apple_wallet',
  'google_wallet',
  'web_card',
  'qr_enrollment',
  'nfc_enrollment',
  'data_export_csv',
  'customer_segments',
  'custom_card_template',
] as const;
export type BooleanFeatureKey = (typeof booleanFeatureKeys)[number];

export const enumFeatures = {
  reminders: ['reward_near', 'all'],
  analytics_level: ['basic', 'branches', 'advanced'],
  support_level: ['standard', 'priority', 'account_manager', 'sla'],
} as const;
export type EnumFeatureKey = keyof typeof enumFeatures;
export type EntitlementKey = LimitKey | BooleanFeatureKey | EnumFeatureKey;

export const subscriptionStatuses = [
  'trialing',
  'active',
  'past_due',
  'grace',
  'suspended',
  'cancelled',
] as const;
export type SubscriptionStatus = (typeof subscriptionStatuses)[number];

const planRef = z.object({ key: z.string(), nameAr: z.string(), nameEn: z.string() });

/** The shape effective_entitlements() returns; parsed so a schema drift fails loudly. */
export const effectiveEntitlements = z.object({
  plan: planRef.extend({ custom: z.boolean() }),
  status: z.enum(subscriptionStatuses),
  currency: z.enum(['EGP', 'SAR', 'AED']),
  billingPeriod: z.enum(['monthly', 'annual']),
  trialEndsAt: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  cancelAtPeriodEnd: z.boolean(),
  pendingPlan: planRef.nullable(),
  limits: z.record(z.enum(limitKeys), z.number().int().nonnegative().nullable()),
  features: z.record(z.string(), z.union([z.boolean(), z.string()])),
  usage: z.record(z.enum(limitKeys), z.number().int().nonnegative()),
  usagePeriod: z.string().regex(/^\d{4}-\d{2}$/),
  revision: z.number().int(),
});
export type EffectiveEntitlements = z.infer<typeof effectiveEntitlements>;

export const entitlementOption = z.discriminatedUnion('type', [
  // Price and currency are only included for the shop owner and the platform team.
  z
    .object({
      type: z.literal('addon'),
      key: z.enum(['extra_branch', 'extra_staff']),
      price: z.number().nonnegative().optional(),
      currency: z.string().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('upgrade'),
      plan: z.string(),
      price: z.number().nonnegative().optional(),
      currency: z.string().optional(),
    })
    .strict(),
  z.object({ type: z.literal('contact'), plan: z.literal('enterprise') }).strict(),
]);
export type EntitlementOption = z.infer<typeof entitlementOption>;

/** Extra fields on a PLAN_LIMIT_REACHED error response. */
export const planLimitDetail = z
  .object({
    entitlement: z.enum(limitKeys),
    limit: z.number().int().nonnegative(),
    used: z.number().int().nonnegative(),
    options: z.array(entitlementOption),
  })
  .strict();
/** Extra fields on a FEATURE_NOT_IN_PLAN error response. */
export const featureDetail = z
  .object({ entitlement: z.string(), options: z.array(entitlementOption) })
  .strict();
export type PlanLimitDetail = z.infer<typeof planLimitDetail>;
