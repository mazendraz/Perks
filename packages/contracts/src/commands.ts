import { contactPhone } from './account-management.js';
import { z } from 'zod';
import { legalAcceptanceFields } from './legal.js';

export const enrollmentInput = z
  .object({
    merchantId: z.uuid(),
    programId: z.uuid(),
    programVersionId: z.uuid(),
    alias: z.string().trim().min(1).max(60),
    contactPhone: contactPhone.optional(),
    acceptedTerms: z.literal(true),
    acceptedTermsHash: z.string().regex(/^[a-f0-9]{64}$/),
    acceptedPrivacyVersion: legalAcceptanceFields.acceptedPrivacyVersion.optional(),
    acceptedPrivacyHash: legalAcceptanceFields.acceptedPrivacyHash.optional(),
    acceptedPrivacyLocale: legalAcceptanceFields.acceptedPrivacyLocale.optional(),
    source: z.enum(['qr', 'nfc', 'link']).default('link'),
    branchId: z.uuid().nullable().default(null),
    consents: z
      .object({
        email: z.boolean().default(false),
        sms: z.boolean().default(false),
        whatsapp: z.boolean().default(false),
      })
      .default({ email: false, sms: false, whatsapp: false }),
  })
  .strict();
export const awardInput = z
  .object({
    branchId: z.uuid(),
    membershipId: z.uuid(),
    quantity: z.number().int().min(1).max(100),
    purchaseReference: z
      .object({
        namespace: z.literal('manual').default('manual'),
        reference: z.string().trim().min(1).max(120),
        businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      })
      .strict(),
    presentationContext: z.string().max(200),
  })
  .strict();
export type AwardInput = z.infer<typeof awardInput>;
export const stampRequestInput = z
  .object({
    membershipId: z.uuid(),
    branchId: z.uuid(),
    placementCode: z.string().min(20).max(80).optional(),
  })
  .strict();
export const draftInput = z
  .object({
    data: z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
      const walk = (item: unknown, path: (string | number)[]) => {
        if (!item || typeof item !== 'object') return;
        for (const [key, nested] of Object.entries(item)) {
          if (/password|credential|secret/i.test(key))
            ctx.addIssue({
              code: 'custom',
              path: [...path, key],
              message: 'Use the protected credentials endpoint for passwords.',
            });
          else walk(nested, [...path, key]);
        }
      };
      walk(value, []);
    }),
  })
  .strict();
export const draftActivationInput = z.object({ draftRevision: z.number().int().min(1) }).strict();
export const redemptionStartInput = z
  .object({ branchId: z.uuid(), presentationContext: z.string().max(200) })
  .strict();
export const redemptionDecisionInput = z
  .object({ approve: z.boolean(), code: z.string().regex(/^\d{6}$/) })
  .strict();
export const preferenceInput = z
  .object({ channel: z.enum(['email', 'sms', 'whatsapp', 'push']), granted: z.boolean() })
  .strict();
export const requestDecisionInput = z.discriminatedUnion('approve', [
  z
    .object({
      approve: z.literal(true),
      code: z.string().regex(/^\d{6}$/),
      award: awardInput,
    })
    .strict(),
  z.object({ approve: z.literal(false), reason: z.string().trim().min(4).max(500) }).strict(),
]);
export const enrollmentOutput = z.object({
  membershipId: z.uuid(),
  alreadyMember: z.boolean(),
  operationId: z.uuid(),
});
export const awardOutput = z.object({
  operationId: z.uuid(),
  transactionId: z.uuid(),
  reference: z.string(),
  purchaseId: z.uuid(),
  membershipId: z.uuid(),
  quantity: z.number().int(),
  balanceAfter: z.number().int(),
  accountRevision: z.number().int(),
  rewardGrants: z.array(
    z
      .object({
        id: z.uuid(),
        title: z.string(),
        terms: z.string(),
        status: z.string(),
        earned_at: z.string(),
        expires_at: z.string(),
      })
      .passthrough(),
  ),
  committedAt: z.string(),
  source: z.string(),
});
export const redemptionOutput = z.object({
  operationId: z.uuid(),
  transactionId: z.uuid(),
  reference: z.string(),
  rewardId: z.uuid(),
  title: z.string(),
  status: z.literal('redeemed'),
  cycleNumber: z.number().int().min(2),
  balanceAfter: z.number().int().min(0),
  accountRevision: z.number().int(),
  committedAt: z.string(),
});
export const failureOutput = z.object({
  error: z.object({
    code: z.string(),
    requestId: z.string().optional(),
    retryable: z.boolean().optional(),
    fields: z.array(z.object({ path: z.string(), code: z.string() })).optional(),
  }),
});

export const draftOutput = z.object({
  draft: z
    .object({
      id: z.uuid(),
      revision: z.number().int(),
      status: z.string(),
      data: z.record(z.string(), z.unknown()),
      updated_at: z.string(),
    })
    .passthrough(),
  operationId: z.uuid().optional(),
});
export const activationOutput = z.object({
  activationId: z.uuid(),
  operationId: z.uuid(),
  merchant: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }).passthrough(),
  branches: z.array(z.object({ id: z.uuid(), name: z.string() }).passthrough()),
  programId: z.uuid(),
  versionId: z.uuid(),
  invitations: z.array(
    z.object({ id: z.uuid(), email: z.email(), status: z.string() }).passthrough(),
  ),
  accounts: z
    .array(
      z.object({
        id: z.uuid(),
        userId: z.uuid(),
        email: z.email(),
        role: z.enum(['owner', 'manager', 'cashier']),
        status: z.literal('active'),
      }),
    )
    .optional(),
  placements: z
    .array(z.object({ id: z.uuid(), branch_id: z.uuid(), label: z.string() }))
    .optional(),
  capabilities: z.record(z.string(), z.string()),
});
export const redemptionStartOutput = z.object({
  challengeId: z.uuid(),
  expiresAt: z.string(),
  code: z.string().regex(/^\d{6}$/),
  operationId: z.uuid(),
});
export const redemptionDecisionOutput = z.object({
  challengeId: z.uuid(),
  status: z.enum(['confirmed', 'declined']),
  operationId: z.uuid(),
});
export const requestDecisionOutput = z.union([
  awardOutput,
  z.object({ status: z.literal('rejected'), id: z.uuid(), operationId: z.uuid() }),
]);
export const preferenceOutput = z.object({
  preference: z.object({
    merchant_id: z.uuid(),
    user_id: z.uuid(),
    channel: z.string(),
    granted: z.boolean(),
    revision: z.number().int(),
    updated_at: z.string(),
  }),
});
