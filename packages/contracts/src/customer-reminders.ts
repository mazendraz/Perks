import { z } from 'zod';

export const reminderDefaults = {
  enabled: false,
  inactivityDays: 3,
  cooldownDays: 4,
  maxReminders: 3,
  sendHour: 12,
  wallet: {
    ar: 'يا {name}، فاضلك {left} وتاخد {reward} من {business} 🎁 مستنيينك!',
    en: 'Hi {name}, just {left} to go for your {reward} at {business} 🎁 See you soon!',
  },
  // Sent instead of the message above when the customer already has a reward waiting.
  walletReady: {
    ar: 'يا {name}، مكافأتك جاهزة: {reward} 🎁 عدّي على {business} واستلمها!',
    en: 'Your reward is ready, {name}: {reward} 🎁 Drop by {business} to claim it!',
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
const templateWith = (keys: string, hint: string) =>
  z
    .string()
    .trim()
    .min(1)
    .max(800)
    .refine(
      (value) => !/[{}]/.test(value.replace(new RegExp('\\{(?:' + keys + ')\\}', 'g'), '')),
      hint,
    );
const template = templateWith('name|business', 'Use {name} and {business} for personalization.');
const walletTemplate = templateWith(
  'name|business|left|reward',
  'Use {name}, {business}, {left} and {reward} for personalization.',
);
const localizedTemplate = z.object({ ar: template, en: template }).strict();
const localizedWalletTemplate = z.object({ ar: walletTemplate, en: walletTemplate }).strict();
export const reminderSettingsInput = z
  .object({
    enabled: z.boolean(),
    inactivityDays: z.number().int().min(1).max(365),
    // Days between two reminders. Two days at least, so the card is never a daily nag.
    cooldownDays: z.number().int().min(2).max(365),
    // Reminders per absence: the first after inactivityDays, the rest cooldownDays apart.
    maxReminders: z.number().int().min(1).max(5).default(1),
    sendHour: z.number().int().min(8).max(20),
    wallet: localizedWalletTemplate,
    walletReady: localizedWalletTemplate.default(reminderDefaults.walletReady),
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

export function personalizeMessage(
  template: string,
  name: string,
  business: string,
  extra: { left?: string; reward?: string } = {},
) {
  return template.replace(/\{(name|business|left|reward)\}/g, (match, key: string) =>
    key === 'name'
      ? name
      : key === 'business'
        ? business
        : (extra[key as 'left' | 'reward'] ?? match),
  );
}

/** "ختمين", "3 أختام", "2 stamps": how many stamps are left, the way people say it. */
export function stampsLeftText(n: number, lang: 'ar' | 'en') {
  if (lang === 'en') return `${n} ${n === 1 ? 'stamp' : 'stamps'}`;
  return n === 1 ? 'ختم واحد' : n === 2 ? 'ختمين' : n <= 10 ? `${n} أختام` : `${n} ختم`;
}

/** Saved settings from before a field existed are completed with the defaults. */
export function withReminderDefaults(saved: Partial<ReminderSettings> | null | undefined) {
  // A shop that saved before repeats existed keeps one reminder per absence (as the scheduler does).
  return (
    saved ? { ...reminderDefaults, maxReminders: 1, ...saved } : reminderDefaults
  ) as ReminderSettings;
}

/**
 * The Wallet reminder for one card: the reward-ready message when a reward is waiting,
 * otherwise the "{left} to go" message, filled with this customer's own numbers.
 */
export function walletReminderText(
  templates: {
    wallet: { ar: string; en: string };
    walletReady?: { ar: string; en: string } | null;
  },
  card: {
    customer_name?: string;
    merchant_name: string;
    threshold: number;
    display_balance: number;
    pending_rewards: number;
    reward_title: string;
  },
  lang: 'ar' | 'en',
) {
  const ready = card.pending_rewards > 0,
    chosen = ready ? (templates.walletReady ?? reminderDefaults.walletReady) : templates.wallet,
    left = Math.max(1, card.threshold - card.display_balance);
  return personalizeMessage(chosen[lang], card.customer_name || '', card.merchant_name, {
    left: stampsLeftText(left, lang),
    reward: card.reward_title,
  });
}
