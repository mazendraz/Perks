import { z } from 'zod';
export const subscriptionPaymentInput = z
  .object({
    amountMinor: z.number().int().min(1).max(1000000000),
    method: z.enum(['instapay', 'cash', 'bank_transfer', 'vodafone_cash']),
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    reference: z.string().trim().max(100).default(''),
    reason: z.string().trim().min(4).max(500),
    resumeEarning: z.boolean().default(true),
  })
  .strict()
  .refine(
    (p) =>
      p.periodEnd >= p.periodStart &&
      Date.parse(p.periodEnd) - Date.parse(p.periodStart) <= 5 * 366 * 86400000,
    { path: ['periodEnd'], message: 'Choose a valid subscription period up to five years' },
  );
export const subscriptionPauseInput = z
  .object({ earningPaused: z.boolean(), reason: z.string().trim().min(4).max(500) })
  .strict();
export const subscriptionVoidInput = z
  .object({ reason: z.string().trim().min(4).max(500) })
  .strict();
export const subscriptionStateOutput = z.object({
  revision: z.number().int(),
  billingRequired: z.boolean(),
  earningPaused: z.boolean(),
  earningAllowed: z.boolean(),
  expiresAt: z.iso.datetime().nullable(),
  timeZone: z.string(),
  payments: z.array(
    z.object({
      id: z.uuid(),
      amount_minor: z.number().int(),
      currency: z.literal('EGP'),
      method: z.string(),
      period_start: z.iso.date(),
      period_end: z.iso.date(),
      payment_reference: z.string(),
      reason: z.string(),
      created_at: z.iso.datetime(),
      recorded_by: z.uuid(),
      recorded_by_name: z.string(),
      voided_at: z.iso.datetime().nullable(),
      void_reason: z.string().nullable(),
    }),
  ),
});
export type SubscriptionState = {
  revision: number;
  billingRequired: boolean;
  earningPaused: boolean;
  earningAllowed: boolean;
  expiresAt: string | null;
  timeZone: string;
  payments: {
    id: string;
    amount_minor: number;
    currency: 'EGP';
    method: string;
    period_start: string;
    period_end: string;
    payment_reference: string;
    reason: string;
    created_at: string;
    recorded_by: string;
    recorded_by_name: string;
    voided_at: string | null;
    void_reason: string | null;
  }[];
};
