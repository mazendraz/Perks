import type { WalletAudience } from './owner-plan.js';
import type { ActionCard, SegmentKey } from './analytics.js';

/**
 * Ready-to-send Wallet messages for each segment the owner can reach from analytics.
 * Plain Egyptian Arabic, at most 150 characters, {name} and {business} filled per card.
 * The owner always sees and can edit the text before it goes.
 */
export const segmentMessages: Partial<Record<WalletAudience, { ar: string; en: string }>> = {
  at_risk: {
    ar: 'وحشتنا يا {name}! كارتك في {business} لسه مستنيك. عدّي علينا وكمّل أختامك.',
    en: 'We miss you, {name}! Your {business} card is still waiting. Drop by and keep collecting.',
  },
  near_reward: {
    ar: 'يا {name}، فاضلك ختم أو اتنين وتاخد هديتك من {business} 🎁',
    en: '{name}, you are one or two stamps away from your reward at {business} 🎁',
  },
  one_time: {
    ar: 'نورتنا في {business} يا {name}! زيارتك الجاية بختم جديد على كارتك. مستنيينك.',
    en: 'Thanks for visiting {business}, {name}! Your next visit adds a stamp. See you soon.',
  },
  reward_ready: {
    ar: 'يا {name}، هديتك جاهزة في {business} 🎁 عدّي استلمها.',
    en: '{name}, your reward is ready at {business} 🎁 Drop by to claim it.',
  },
  lost: {
    ar: 'زمان ماشفناكش يا {name}! كارتك في {business} لسه شغال وأختامك محفوظة.',
    en: 'It has been a while, {name}! Your {business} card still works and your stamps are safe.',
  },
  new: {
    ar: 'أهلًا بيك في {business} يا {name}! كل زيارة بختم، والهدية مستنياك في الآخر.',
    en: 'Welcome to {business}, {name}! Every visit earns a stamp, and a reward waits at the end.',
  },
  vip: {
    ar: 'يا {name}، إنت من أقرب زباين {business} لقلبنا. شكرًا إنك دايمًا معانا 💛',
    en: '{name}, you are one of our favourite customers at {business}. Thank you for coming back 💛',
  },
  reactivated: {
    ar: 'منوّر {business} تاني يا {name}! مبسوطين برجوعك.',
    en: 'Great to see you back at {business}, {name}!',
  },
  regular: {
    ar: 'يا {name}، شكرًا إنك دايمًا بتيجي {business}. كارتك بيكبر معاك.',
    en: '{name}, thanks for always coming to {business}. Your card grows with you.',
  },
};

/** The Wallet audience behind a segment or a "what to do today" card, if it can be messaged. */
export function audienceFor(key: SegmentKey | ActionCard['key']): WalletAudience | null {
  if (key === 'reward_holder') return 'reward_ready';
  if (key === 'never') return null;
  return key;
}
