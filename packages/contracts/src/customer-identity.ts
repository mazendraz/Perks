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
// Staff-assisted recovery = pairing: the code is shown only on the customer's own phone.
export const pairingCode = z.string().regex(/^[0-9]{6}$/, 'Enter the 6-digit code');
export const customerPairingClaimInput = z
  .object({
    customerId: z.uuid(),
    branchId: z.uuid(),
    code: pairingCode,
    requestedByCustomer: z.literal(true),
  })
  .strict();
// With a phone: joining this shop with a number already on Perks (049). The staff member must
// type the same number with the code.
export const customerPairingStartInput = z
  .object({ merchantId: z.uuid(), phone: customerPhone.optional() })
  .strict();
export const customerJoinClaimInput = z
  .object({ branchId: z.uuid(), phone: customerPhone, code: pairingCode })
  .strict();
export const customerPairingDecisionInput = z.object({ approve: z.boolean() }).strict();
export const deviceNoticeInput = z.object({ removeDevice: z.boolean() }).strict();
export const whatsappProofInput = z
  .object({ phone: customerPhone, purpose: z.enum(['restore', 'update']) })
  .strict();
export type WhatsAppProofPurpose = z.infer<typeof whatsappProofInput>['purpose'];
export type PairingStatus =
  'waiting' | 'awaiting_approval' | 'approved' | 'consumed' | 'rejected' | 'cancelled' | 'expired';
