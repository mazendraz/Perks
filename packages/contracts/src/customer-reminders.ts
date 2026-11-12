import { z } from 'zod';

export const reminderDefaults = {
  enabled: false,
  inactivityDays: 14,
  cooldownDays: 30,
  sendHour: 12,
  wallet: {
    ar: 'وحشتنا يا {name}! مستنيين زيارتك في {business}. كارتك معاك وتقدر تكمل تجميع أختامك.',
    en: 'We miss you, {name}! Visit us at {business} and keep collecting stamps on your card.',
  },
  whatsapp: {
    followup: {
      ar: 'أهلًا يا {name}، بنطمن عليك من {business}. يا رب زيارتك كانت حلوة! لو عندك أي سؤال عن كارت الولاء أو حابب تقولنا رأيك ابعتلنا هنا.',
      en: 'Hi {name}, checking in from {business}. We hope you enjoyed your visit! Message us here with any questions about your loyalty card or to share your feedback.',
    },
    welcome: {
      ar: 'أهلًا يا {name}، منور {business}! كارت الولاء بتاعك جاهز، ومستنيين أول زيارة ليك. لو عندك أي سؤال ابعتلنا هنا.',
      en: 'Hi {name}, welcome to {business}! Your loyalty card is ready. We look forward to your first visit. Message us here if you need a hand.',
    },
    inactive: {
      ar: 'وحشتنا يا {name}! بقالنا فترة مشوفناكش في {business}. تنورنا قريب وتكمل أختامك على كارت الولاء. مستنيينك!',
      en: 'We miss you, {name}! It has been a while since your last visit to {business}. Come by and keep collecting stamps on your loyalty card. See you soon!',
    },
    reward: {
      ar: 'يا {name}، عندك مكافأة جاهزة في {business}! افتح كارتك وشوف تفاصيلها وصلاحيتها، وتنورنا تستلمها في زيارتك الجاية.',
      en: 'Hi {name}, you have a reward ready at {business}! Open your card to check its details and expiry, and visit us to redeem it.',
    },
  },
};
const template = z
  .string()
  .trim()
  .min(1)
  .max(800)
  .refine(
    (value) => !/[{}]/.test(value.replace(/\{(?:name|business)\}/g, '')),
    'Use {name} and {business} for personalization.',
  );
const localizedTemplate = z.object({ ar: template, en: template }).strict();
export const reminderSettingsInput = z
  .object({
    enabled: z.boolean(),
    inactivityDays: z.number().int().min(1).max(365),
    cooldownDays: z.number().int().min(7).max(365),
    sendHour: z.number().int().min(8).max(20),
    wallet: localizedTemplate,
    whatsapp: z
      .object({
        followup: localizedTemplate,
        welcome: localizedTemplate,
        inactive: localizedTemplate,
        reward: localizedTemplate,
      })
      .strict(),
  })
  .strict();
export type ReminderSettings = z.infer<typeof reminderSettingsInput>;
export type WhatsAppPurpose = keyof ReminderSettings['whatsapp'];

export function personalizeMessage(template: string, name: string, business: string) {
  return template.replace(/\{(name|business)\}/g, (_, key: string) =>
    key === 'name' ? name : business,
  );
}
