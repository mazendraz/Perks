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
const staffRoles = {
  owner: { ar: 'مالك', en: 'Owner' },
  manager: { ar: 'مدير', en: 'Manager' },
  cashier: { ar: 'كاشير', en: 'Cashier' },
} as const;
export function staffRoleLabel(value: string, lang: Language) {
  return (
    staffRoles[value as keyof typeof staffRoles]?.[lang] || (lang === 'ar' ? 'غير محدد' : 'Unknown')
  );
}
export function staffStatusLabel(value: string, lang: Language) {
  if (value === 'active') return lang === 'ar' ? 'نشط' : 'Active';
  if (value === 'disabled') return lang === 'ar' ? 'موقوف' : 'Disabled';
  return lang === 'ar' ? 'غير محدد' : 'Unknown';
}
export function merchantStatusLabel(value: string | undefined, lang: Language) {
  return (
    statuses[value as keyof typeof statuses]?.[lang] || (lang === 'ar' ? 'غير محدد' : 'Unknown')
  );
}
export function subscriptionPlanLabel(value: string | undefined, lang: Language) {
  return plans[value as keyof typeof plans]?.[lang] || (lang === 'ar' ? 'غير محدد' : 'Unknown');
}
