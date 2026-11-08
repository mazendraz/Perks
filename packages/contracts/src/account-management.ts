import { z } from 'zod';
export const contactPhone = z
  .string()
  .trim()
  .max(24)
  .transform((value) => {
    const compact = value.replace(/[\s()-]/g, '');
    if (/^01[0125][0-9]{8}$/.test(compact)) return '+20' + compact.slice(1);
    return compact.startsWith('00') ? '+' + compact.slice(2) : compact;
  })
  .refine(
    (value) => value === '' || /^\+[1-9][0-9]{7,14}$/.test(value),
    'Use an international phone number',
  );
const actionBase = {
  reason: z.string().trim().min(4).max(500),
  credentialVersion: z.number().int().min(0),
  acknowledgeAccountWide: z.literal(true),
};
export const staffSecurityCommand = z.discriminatedUnion('action', [
  z
    .object({ ...actionBase, action: z.literal('password'), password: z.string().min(12).max(128) })
    .strict(),
  z.object({ ...actionBase, action: z.literal('sessions') }).strict(),
  z.object({ ...actionBase, action: z.literal('unlock') }).strict(),
]);
