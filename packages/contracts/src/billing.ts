import { z } from 'zod';
import { limitKeys, booleanFeatureKeys, enumFeatures } from './entitlements.js';

const reason = z.string().trim().min(4).max(500);
const money = z.number().int().min(0).max(1000000000);
export const currencies = ['EGP', 'SAR', 'AED'] as const;
export const billingPeriods = ['monthly', 'annual'] as const;

/** One entitlement value as the Super Admin sets it: a number, unlimited, on/off, or a level. */
export const entitlementValue = z.union([
  z
    .object({
      key: z.enum(limitKeys),
      type: z.literal('int'),
      value: z.number().int().min(0).max(100000),
    })
    .strict(),
  z.object({ key: z.enum(limitKeys), type: z.literal('unlimited') }).strict(),
  z
    .object({ key: z.enum(booleanFeatureKeys), type: z.literal('bool'), value: z.boolean() })
    .strict(),
  z
    .object({
      key: z.literal('reminders'),
      type: z.literal('enum'),
      value: z.enum(enumFeatures.reminders),
    })
    .strict(),
  z
    .object({
      key: z.literal('analytics_level'),
      type: z.literal('enum'),
      value: z.enum(enumFeatures.analytics_level),
    })
    .strict(),
  z
    .object({
      key: z.literal('support_level'),
      type: z.literal('enum'),
      value: z.enum(enumFeatures.support_level),
    })
    .strict(),
]);
export type EntitlementValue = z.infer<typeof entitlementValue>;

export const planUpdateInput = z
  .object({
    nameAr: z.string().trim().min(1).max(60),
    nameEn: z.string().trim().min(1).max(60),
    isPublic: z.boolean(),
    isActive: z.boolean(),
    prices: z
      .array(
        z
          .object({
            currency: z.enum(currencies),
            billingPeriod: z.enum(billingPeriods),
            amountMinor: money,
            setupFeePerBranchMinor: money,
          })
          .strict(),
      )
      .max(6),
    entitlements: z.array(entitlementValue).max(20),
    addons: z
      .array(
        z
          .object({
            key: z.enum(['extra_branch', 'extra_staff']),
            currency: z.enum(currencies),
            unitAmountMinor: money,
            maxTotal: z.number().int().min(1).max(100000).nullable(),
            isActive: z.boolean(),
          })
          .strict(),
      )
      .max(6),
    /** Off by default: a catalog price change never moves what existing merchants pay. */
    applyPriceToExisting: z.boolean().default(false),
    reason,
  })
  .strict()
  .refine(
    (p) =>
      new Set(p.prices.map((x) => x.currency + x.billingPeriod)).size === p.prices.length &&
      new Set(p.entitlements.map((x) => x.key)).size === p.entitlements.length &&
      new Set(p.addons.map((x) => x.key + x.currency)).size === p.addons.length,
    { path: ['prices'], message: 'Each price, entitlement and add-on appears once' },
  );

export const planChangeInput = z
  .object({
    plan: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
    billingPeriod: z.enum(billingPeriods),
    effective: z.enum(['now', 'period_end']),
    reason,
  })
  .strict();
export const addonInput = z
  .object({ quantity: z.number().int().min(0).max(1000), reason })
  .strict();
export const overrideInput = z
  .object({
    value: entitlementValue,
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
    reason,
  })
  .strict()
  .refine((p) => p.expiresAt === null || Date.parse(p.expiresAt) > Date.now(), {
    path: ['expiresAt'],
    message: 'Choose a future date',
  });
export const trialInput = z
  .object({
    plan: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
    days: z.number().int().min(1).max(60).default(14),
    reason,
  })
  .strict();
export const cancelInput = z.object({ atPeriodEnd: z.boolean(), reason }).strict();
export const reasonInput = z.object({ reason }).strict();
export const agreedPriceInput = z.object({ priceMinor: money, reason }).strict();
