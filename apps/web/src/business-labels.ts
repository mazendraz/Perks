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
const placementStatuses = {
  requested: { ar: 'مطلوبة', en: 'Requested' },
  ready: { ar: 'جاهزة', en: 'Ready' },
  shipped: { ar: 'اتشحنت', en: 'Shipped' },
  installed: { ar: 'اتركبت', en: 'Installed' },
  verified: { ar: 'اتجربت واشتغلت', en: 'Verified' },
  revoked: { ar: 'الرابط ملغي', en: 'Revoked' },
} as const;
const placementKinds = {
  stand: { ar: 'حامل على الكاونتر', en: 'Counter stand' },
  sticker: { ar: 'ستيكر', en: 'Sticker' },
  nfc: { ar: 'تاج NFC', en: 'NFC tag' },
} as const;
export function placementStatusLabel(value: string, lang: Language) {
  return (
    placementStatuses[value as keyof typeof placementStatuses]?.[lang] ||
    (lang === 'ar' ? 'غير محدد' : 'Unknown')
  );
}
export function placementKindLabel(value: string, lang: Language) {
  return (
    placementKinds[value as keyof typeof placementKinds]?.[lang] ||
    (lang === 'ar' ? 'غير محدد' : 'Unknown')
  );
}
export function merchantStatusLabel(value: string | undefined, lang: Language) {
  return (
    statuses[value as keyof typeof statuses]?.[lang] || (lang === 'ar' ? 'غير محدد' : 'Unknown')
  );
}
export function subscriptionPlanLabel(value: string | undefined, lang: Language) {
  return plans[value as keyof typeof plans]?.[lang] || (lang === 'ar' ? 'غير محدد' : 'Unknown');
}
const transactionTypes = {
  award: { ar: 'أختام', en: 'Stamps' },
  redeem: { ar: 'استبدال مكافأة', en: 'Reward redeemed' },
  correction: { ar: 'تصحيح', en: 'Correction' },
} as const;
export function transactionTypeLabel(value: string, lang: Language) {
  return (
    transactionTypes[value as keyof typeof transactionTypes]?.[lang] ||
    (lang === 'ar' ? 'عملية' : 'Transaction')
  );
}
const genericStatuses: Record<string, { ar: string; en: string }> = {
  active: { ar: 'نشط', en: 'Active' },
  disabled: { ar: 'موقوف', en: 'Disabled' },
  paused: { ar: 'متوقف مؤقتًا', en: 'Paused' },
  suspended: { ar: 'موقوف', en: 'Suspended' },
  pending: { ar: 'مستني المراجعة', en: 'Pending' },
  needs_review: { ar: 'محتاج مراجعة خاصة', en: 'Needs review' },
  approved: { ar: 'اتوافق عليه', en: 'Approved' },
  applied: { ar: 'اتنفذ', en: 'Applied' },
  rejected: { ar: 'اترفض', en: 'Rejected' },
  draft: { ar: 'مسودة', en: 'Draft' },
  published: { ar: 'منشور', en: 'Published' },
  archived: { ar: 'مؤرشف', en: 'Archived' },
  retired: { ar: 'متوقف', en: 'Retired' },
  invited: { ar: 'مدعو', en: 'Invited' },
  accepted: { ar: 'اتقبلت', en: 'Accepted' },
  revoked: { ar: 'اتلغت', en: 'Revoked' },
  expired: { ar: 'انتهت', en: 'Expired' },
  cancelled: { ar: 'اتلغى', en: 'Cancelled' },
  open: { ar: 'مفتوحة', en: 'Open' },
  in_progress: { ar: 'شغالين عليها', en: 'In progress' },
  waiting_merchant: { ar: 'مستنية المحل', en: 'Waiting for shop' },
  waiting: { ar: 'مستنية', en: 'Waiting' },
  resolved: { ar: 'اتحلت', en: 'Resolved' },
  closed: { ar: 'مقفولة', en: 'Closed' },
  queued: { ar: 'في الطابور', en: 'Queued' },
  running: { ar: 'شغالة', en: 'Running' },
  succeeded: { ar: 'نجحت', en: 'Succeeded' },
  failed: { ar: 'فشلت', en: 'Failed' },
  blocked: { ar: 'متوقفة على إعداد', en: 'Blocked' },
  dead: { ar: 'متوقفة نهائيًا', en: 'Dead' },
  ready: { ar: 'جاهزة', en: 'Ready' },
  requested: { ar: 'مطلوبة', en: 'Requested' },
  shipped: { ar: 'اتشحنت', en: 'Shipped' },
  installed: { ar: 'اتركبت', en: 'Installed' },
  verified: { ar: 'اتجربت', en: 'Verified' },
};
/** Display label for internal status values; unknown values stay visible as-is. */
export function statusLabel(value: string, lang: Language) {
  return genericStatuses[value]?.[lang] || value;
}
