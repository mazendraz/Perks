import { z } from 'zod';
import { contactPhone } from './account-management.js';
import { legalAcceptanceFields } from './legal.js';
export const customerPhone = contactPhone.refine(
  (value) => value.length > 0 && (!value.startsWith('+20') || /^\+201[0125][0-9]{8}$/.test(value)),
  'Enter your mobile number',
);
export const customerRegistrationInput = z
  .object({
    displayName: z.string().trim().min(1).max(60),
    phone: customerPhone,
    merchantId: z.uuid(),
    programId: z.uuid(),
    programVersionId: z.uuid(),
    acceptedTerms: z.literal(true),
    acceptedTermsHash: z.string().regex(/^[a-f0-9]{64}$/),
    branchId: z.uuid(),
    placementCode: z.string().min(20).max(80).optional(),
    source: z.enum(['qr', 'nfc', 'link']).default('qr'),
    ...legalAcceptanceFields,
  })
  .strict();
export const customerLookupInput = z.object({ phone: customerPhone, branchId: z.uuid() }).strict();
export const customerRecoveryInput = z
  .object({ customerId: z.uuid(), branchId: z.uuid(), requestedByCustomer: z.literal(true) })
  .strict();
export const recoveryConsumeInput = z
  .object({ revokeOldDevices: z.boolean().default(true) })
  .strict();
