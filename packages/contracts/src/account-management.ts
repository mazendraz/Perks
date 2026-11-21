import { z } from 'zod';
export const contactPhone = z
  .string()
  .trim()
  .max(24)
  .transform((value) => {
    // Arabic-Indic and Persian digits are what many Egyptian phone keyboards type.
    let compact = value
      .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
      .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
      .replace(/[\s()\-.]/g, '');
    if (compact.startsWith('00')) compact = '+' + compact.slice(2);
    // Egyptian mobiles as people actually type them: 010…, 10… (no leading 0),
    // 2010… (no plus) and +20010… (country code plus the local 0).
    const egypt = /^(?:\+?20)?0?(1[0125][0-9]{8})$/.exec(compact);
    if (egypt) return '+20' + egypt[1];
    return compact;
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
    .object({ ...actionBase, action: z.literal('password'), password: z.string().min(10).max(128) })
    .strict(),
  z.object({ ...actionBase, action: z.literal('sessions') }).strict(),
  z.object({ ...actionBase, action: z.literal('unlock') }).strict(),
]);
