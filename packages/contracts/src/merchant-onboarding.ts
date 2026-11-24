import { z } from 'zod';
import { color, programInput } from './provisioning.js';
import { cardTemplate, logoStyles, stampIcons, stampShapes, stampStyles } from './branding.js';

export const merchantOnboardingSetup = z
  .object({
    branchName: z.string().trim().min(2).max(120),
    branchAddress: z.string().trim().min(2).max(300),
    rewardTitle: programInput.shape.rewardTitle,
    threshold: programInput.shape.threshold,
    cardColor: color,
    accentColor: color.optional(),
    surfaceColor: color.optional(),
    template: cardTemplate.optional(),
    logoStyle: z.enum(logoStyles).optional(),
    logoSize: z.number().int().min(32).max(72).optional(),
    stampShape: z.enum(stampShapes).optional(),
    stampIcon: z.enum(stampIcons).optional(),
    stampStyle: z.enum(stampStyles).optional(),
  })
  .strict();

export type MerchantOnboardingSetup = z.infer<typeof merchantOnboardingSetup>;
