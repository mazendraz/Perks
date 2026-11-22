import { z } from 'zod';

const note = z.string().trim().max(500).optional();
export const planRequestInput = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('change_plan'),
      plan: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/),
      billingPeriod: z.enum(['monthly', 'annual']),
      note,
    })
    .strict(),
  z
    .object({
      kind: z.literal('addon'),
      addonKey: z.enum(['extra_branch', 'extra_staff']),
      quantity: z.number().int().min(1).max(100),
      note,
    })
    .strict(),
]);
export type PlanRequestInput = z.infer<typeof planRequestInput>;

export const keepInput = z
  .object({
    kind: z.enum(['branch', 'program', 'staff']),
    ids: z.array(z.uuid()).max(500),
  })
  .strict();

export const walletAudiences = [
  'all',
  'reward_ready',
  'near_reward',
  'inactive',
  // Analytics segments (044).
  'new',
  'one_time',
  'regular',
  'at_risk',
  'lost',
  'reactivated',
  'vip',
] as const;
export type WalletAudience = (typeof walletAudiences)[number];

/** Short enough for the lock-screen notification; {name} and {business} are filled per card. */
export const walletMessageBody = z
  .string()
  .trim()
  .min(1)
  .max(150)
  .refine((v) => !/[{}]/.test(v.replace(/\{(?:name|business)\}/g, '')), {
    message: 'Use {name} and {business} only.',
  })
  .refine((v) => !/[<>]/.test(v), { message: 'Plain text only.' });

export const walletMessageInput = z
  .object({
    audience: z.enum(walletAudiences),
    inactiveDays: z.number().int().min(7).max(365).optional(),
    bodyAr: walletMessageBody,
    bodyEn: walletMessageBody.optional(),
  })
  .strict()
  .refine((m) => (m.audience === 'inactive') === (m.inactiveDays !== undefined), {
    path: ['inactiveDays'],
    message: 'Inactive customers need a number of days.',
  });
export type WalletMessageInput = z.infer<typeof walletMessageInput>;

export const walletPreviewQuery = z
  .object({
    audience: z.enum(walletAudiences),
    inactiveDays: z.coerce.number().int().min(7).max(365).optional(),
  })
  .strict();

export interface WalletMessagePreview {
  groupSize: number;
  customers: number;
  apple: number;
  google: number;
  notLinked: number;
  notificationsOff: number;
  recentlyContacted: number;
}

/** Fills {name} and {business} in a manual Wallet message. */
export function fillWalletMessage(body: string, name: string, business: string) {
  return body.replaceAll('{name}', name || '').replaceAll('{business}', business);
}
