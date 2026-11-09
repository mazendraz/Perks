import { z } from 'zod';
export const emailInput = z
  .email()
  .max(254)
  .transform((s) => s.toLowerCase());
export const newPassword = z.string().min(10).max(128);
export const loginInput = z
  .object({ email: emailInput, password: z.string().min(1).max(128) })
  .strict();
export const changePasswordInput = z
  .object({ currentPassword: z.string().min(1).max(128), password: newPassword })
  .strict();
export const resetRequestInput = z.object({ email: emailInput }).strict();
export const resetPasswordInput = z
  .object({ token: z.string().min(32).max(200), password: newPassword })
  .strict();
