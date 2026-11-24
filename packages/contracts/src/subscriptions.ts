import { z } from 'zod';
/**
 * The last end date allowed for a period starting on `start` (YYYY-MM-DD): the same calendar
 * day five years later, so "up to five years" means exactly that, leap days included. A
 * 29 February start ends on 28 February (no 29th in the fifth year after a leap year).
 */
export function maxSubscriptionPeriodEnd(start: string) {
  const [y, m, d] = start.split('-').map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y + 5, m, 0)).getUTCDate();
  return `${String(y + 5).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
export const subscriptionPaymentInput = z
  .object({
    amountMinor: z.number().int().min(1).max(1000000000),
    method: z.enum(['instapay', 'cash', 'bank_transfer', 'vodafone_cash', 'wallet', 'card_link']),
    periodStart: z.iso.date(),
    periodEnd: z.iso.date(),
    reference: z.string().trim().max(100).default(''),
    reason: z.string().trim().min(4).max(500),
    resumeEarning: z.boolean().default(true),
  })
  .strict()
  .refine(
    (p) => p.periodEnd >= p.periodStart && p.periodEnd <= maxSubscriptionPeriodEnd(p.periodStart),
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
