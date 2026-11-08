import { contactPhone } from './account-management.js';
import { cardTemplate, stampDesign, logoStyles } from './branding.js';
import { z } from 'zod';
export const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const programInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    threshold: z.number().int().min(2).max(50),
    maxPerTx: z.number().int().min(1).max(100),
    rewardTitle: z.string().trim().min(2).max(240),
    rewardTerms: z.string().trim().min(4).max(2000),
    validityDays: z.number().int().min(1).max(365),
    endsAt: z.iso.datetime().nullable().default(null),
  })
  .strict();
export const provisioningInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,62}$/),
    timezone: z
      .string()
      .default('Africa/Cairo')
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, 'Invalid timezone'),
    contactPhone: contactPhone.default(''),
    contactEmail: z.email().transform((s) => s.toLowerCase()),
    primaryColor: color,
    accentColor: color,
    surfaceColor: color,
    template: cardTemplate,
    logoStyle: z.enum(logoStyles).default('framed'),
    logoSize: z.number().int().min(32).max(72).default(43),
    ...stampDesign,
    logoAssetId: z.uuid().nullable().optional(),
    terms: z.string().trim().min(4).max(3000),
    program: programInput,
    branches: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(100),
          address: z.string().max(300).default(''),
        }),
      )
      .min(1)
      .max(10),
    staff: z
      .array(
        z.object({
          email: z.email().transform((s) => s.toLowerCase()),
          role: z.enum(['owner', 'manager', 'cashier']),
          branchIndexes: z.array(z.number().int().min(0)).min(1).max(10),
          maxQty: z.number().int().min(1).max(100),
          accessMode: z.enum(['password', 'invitation']).default('invitation'),
        }),
      )
      .min(1)
      .max(40),
    plan: z.enum(['starter', 'growth', 'pro']).default('growth'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.staff.some((s) => s.role === 'owner'))
      ctx.addIssue({ code: 'custom', path: ['staff'], message: 'An owner is required.' });
    if (new Set(v.staff.map((s) => s.email)).size !== v.staff.length)
      ctx.addIssue({ code: 'custom', path: ['staff'], message: 'Duplicate staff email.' });
    if (
      v.staff.some(
        (s) =>
          s.branchIndexes.some((i) => i >= v.branches.length) ||
          new Set(s.branchIndexes).size !== s.branchIndexes.length,
      )
    )
      ctx.addIssue({ code: 'custom', path: ['staff'], message: 'Invalid branch assignment.' });
  });
export type ProvisioningInput = z.infer<typeof provisioningInput>;
export const planLimits = {
  starter: { branches: 1, staff: 3, programs: 1, customers: 500 },
  growth: { branches: 3, staff: 10, programs: 3, customers: 3000 },
  pro: { branches: 10, staff: 40, programs: 10, customers: 10000 },
} as const;
