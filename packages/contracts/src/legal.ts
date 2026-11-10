import { z } from 'zod';
export const legalAcceptanceFields = {
  acceptedPrivacyVersion: z.string().min(1).max(100),
  acceptedPrivacyHash: z.string().regex(/^[a-f0-9]{64}$/),
  acceptedPrivacyLocale: z.enum(['ar', 'en']),
};
export const legalAcceptanceInput = z.object(legalAcceptanceFields);
export const customerDeletionInput = z.object({ confirmed: z.literal(true) }).strict();
const document = z.object({
  title: z.string(),
  sections: z.array(z.object({ title: z.string(), body: z.string() })),
});
export const legalNoticeOutput = z.object({
  locale: z.enum(['ar', 'en']),
  reviewRequired: z.literal(true),
  updatedAt: z.iso.date(),
  privacy: document,
  terms: document,
  acceptance: z.object({
    version: z.string(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    text: z.string(),
  }),
});
export type LegalNotice = z.infer<typeof legalNoticeOutput>;
