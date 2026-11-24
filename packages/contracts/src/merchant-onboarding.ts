import { z } from 'zod';
import { color, programInput } from './provisioning.js';

export const merchantOnboardingSetup = z
  .object({
    branchName: z.string().trim().min(2).max(120),
    branchAddress: z.string().trim().min(2).max(300),
    rewardTitle: programInput.shape.rewardTitle,
    threshold: programInput.shape.threshold,
    cardColor: color,
  })
  .strict();

export type MerchantOnboardingSetup = z.infer<typeof merchantOnboardingSetup>;
