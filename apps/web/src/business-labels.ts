import type { Language } from '../../../packages/contracts/src/index.js';
const statuses = {
  active: { ar: 'نشط', en: 'Active' },
  trial: { ar: 'تجريبي', en: 'Trial' },
  suspended: { ar: 'موقوف', en: 'Suspended' },
} as const;
const plans = {
  starter: { ar: 'بداية', en: 'Starter' },
  growth: { ar: 'نمو', en: 'Growth' },
  pro: { ar: 'احترافية', en: 'Pro' },
} as const;
export function merchantStatusLabel(value: string | undefined, lang: Language) {
  return (
    statuses[value as keyof typeof statuses]?.[lang] || (lang === 'ar' ? 'غير محدد' : 'Unknown')
  );
}
export function subscriptionPlanLabel(value: string | undefined, lang: Language) {
  return plans[value as keyof typeof plans]?.[lang] || (lang === 'ar' ? 'غير محدد' : 'Unknown');
}
