import type { Language } from '../../../../packages/contracts/src/index.js';
import type {
  LimitKey,
  SubscriptionStatus,
} from '../../../../packages/contracts/src/entitlements.js';

type Pair = [ar: string, en: string];
const pick = (pair: Pair | undefined, lang: Language, fallback: string) =>
  pair ? pair[lang === 'ar' ? 0 : 1] : fallback;

const limits: Record<LimitKey, Pair> = {
  max_branches: ['الفروع', 'Branches'],
  max_staff: ['الموظفين', 'Staff'],
  max_active_programs: ['برامج الأختام الشغالة', 'Active stamp programs'],
  manual_messages_per_month: ['رسايل Wallet في الشهر', 'Manual Wallet messages a month'],
};
const features: Record<string, Pair> = {
  merchant_branding: ['لوجو وألوان المحل', 'Shop logo and colours'],
  apple_wallet: ['Apple Wallet', 'Apple Wallet'],
  google_wallet: ['Google Wallet', 'Google Wallet'],
  web_card: ['كارت الويب', 'Web card'],
  qr_enrollment: ['التسجيل بـ QR', 'QR sign-up'],
  nfc_enrollment: ['التسجيل بـ NFC', 'NFC sign-up'],
  data_export_csv: ['تنزيل العملاء CSV', 'Customer CSV export'],
  customer_segments: ['تقسيم العملاء', 'Customer segments'],
  custom_card_template: ['تصميم كارت خاص', 'Custom card template'],
  reminders: ['التذكيرات', 'Reminders'],
  analytics_level: ['التقارير', 'Analytics'],
  support_level: ['الدعم', 'Support'],
};
const levels: Record<string, Pair> = {
  reward_near: ['لما الهدية تقرب', 'When a reward is near'],
  all: ['كل التذكيرات', 'All reminders'],
  basic: ['أساسية', 'Basic'],
  branches: ['لكل فرع', 'Per branch'],
  advanced: ['متقدمة', 'Advanced'],
  standard: ['عادي', 'Standard'],
  priority: ['أولوية', 'Priority'],
  account_manager: ['مسؤول حساب', 'Account manager'],
  sla: ['اتفاقية خدمة SLA', 'SLA'],
};
const statuses: Record<SubscriptionStatus, Pair> = {
  trialing: ['تجربة مجانية', 'Free trial'],
  active: ['شغال', 'Active'],
  past_due: ['متأخر في الدفع', 'Past due'],
  grace: ['فترة سماح', 'Grace period'],
  suspended: ['موقوف', 'Suspended'],
  cancelled: ['ملغي', 'Cancelled'],
};
const events: Record<string, Pair> = {
  'plan.catalog_changed': ['اتغيّر كتالوج الباقة', 'Plan catalog changed'],
  'plan.items_rebalanced': [
    'اتقفل/اتفتح عناصر حسب الباقة',
    'Items locked or unlocked for the plan',
  ],
  'subscription.addon_changed': ['اتغيّرت الإضافات', 'Add-ons changed'],
  'subscription.cancelled': ['اتلغى الاشتراك', 'Subscription cancelled'],
  'subscription.earning.changed': ['اتغيّر جمع الأختام', 'Stamp earning changed'],
  'subscription.legacy_created': ['اتعمل اشتراك من الإعداد القديم', 'Created from the old setup'],
  'subscription.override_revoked': ['اتشال استثناء', 'Override removed'],
  'subscription.override_set': ['اتحط استثناء', 'Override set'],
  'subscription.payment.recorded': ['اتسجلت دفعة', 'Payment recorded'],
  'subscription.payment_recorded': ['اتسجلت دفعة', 'Payment recorded'],
  'subscription.payment.voided': ['اتلغى تسجيل دفعة', 'Payment voided'],
  'subscription.payment_voided': ['اتلغى تسجيل دفعة', 'Payment voided'],
  'subscription.plan_changed': ['اتغيّرت الباقة', 'Plan changed'],
  'subscription.plan_scheduled': ['اتجدول تغيير الباقة', 'Plan change scheduled'],
  'subscription.price_set': ['اتحط سعر متفق عليه', 'Agreed price set'],
  'subscription.reactivated': ['رجع الاشتراك', 'Subscription reactivated'],
  'subscription.status_changed': ['اتغيّرت حالة الاشتراك', 'Status changed'],
  'subscription.trial_started': ['بدأت تجربة مجانية', 'Trial started'],
};
const methods: Record<string, Pair> = {
  instapay: ['إنستاباي', 'InstaPay'],
  cash: ['كاش', 'Cash'],
  bank_transfer: ['تحويل بنكي', 'Bank transfer'],
  vodafone_cash: ['فودافون كاش', 'Vodafone Cash'],
  wallet: ['محفظة موبايل', 'Mobile wallet'],
  card_link: ['رابط دفع بالكارت', 'Card payment link'],
};
const addons: Record<string, Pair> = {
  extra_branch: ['فرع زيادة', 'Extra branch'],
  extra_staff: ['موظف زيادة', 'Extra staff'],
};

export const limitLabel = (k: string, lang: Language) => pick(limits[k as LimitKey], lang, k);
export const featureLabel = (k: string, lang: Language) => pick(features[k], lang, k);
export const levelLabel = (v: string, lang: Language) => pick(levels[v], lang, v);
export const statusLabel = (s: string, lang: Language) =>
  pick(statuses[s as SubscriptionStatus], lang, s);
export const eventLabel = (t: string, lang: Language) => pick(events[t], lang, t);
export const methodLabel = (m: string, lang: Language) => pick(methods[m], lang, m);
export const addonLabel = (k: string, lang: Language) => pick(addons[k], lang, k);
export const paymentMethods = Object.keys(methods);

/** Whole pounds without decimals when the amount is round (900 not 900.00). */
export function money(minor: number, currency: string, lang: Language) {
  return new Intl.NumberFormat(lang === 'ar' ? 'ar-EG' : 'en', {
    style: 'currency',
    currency,
    maximumFractionDigits: minor % 100 ? 2 : 0,
  }).format(minor / 100);
}
export function day(value: string | null | undefined, lang: Language) {
  if (!value) return '—';
  return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Africa/Cairo',
  }).format(new Date(value));
}
