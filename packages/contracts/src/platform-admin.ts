import { z } from 'zod';
const reason = z.string().trim().min(4).max(500);
export const platformAdminInput = z
  .object({
    name: z.string().trim().min(1).max(100),
    email: z
      .email()
      .max(254)
      .transform((e) => e.toLowerCase()),
    password: z.string().min(12).max(128).meta({ writeOnly: true }),
    reason,
    acknowledgeFullAccess: z.literal(true),
  })
  .strict();
const common = {
  reason,
  credentialVersion: z.number().int().min(0),
  acknowledgeFullAccess: z.literal(true),
};
export const platformAdminCommand = z.discriminatedUnion('action', [
  z
    .object({
      ...common,
      action: z.literal('password'),
      password: z.string().min(12).max(128).meta({ writeOnly: true }),
    })
    .strict(),
  ...(['sessions', 'unlock', 'disable', 'enable'] as const).map((action) =>
    z.object({ ...common, action: z.literal(action) }).strict(),
  ),
]);
