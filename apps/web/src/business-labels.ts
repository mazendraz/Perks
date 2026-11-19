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
  scale: { ar: 'توسّع', en: 'Scale' },
  enterprise: { ar: 'مؤسسات', en: 'Enterprise' },
  legacy: { ar: 'الباقة التجريبية', en: 'Pilot' },
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
export function subscriptionPlanLabel(
  value: string | undefined,
  lang: Language,
  names?: { plan_name_ar?: string | null; plan_name_en?: string | null },
) {
  const named = lang === 'ar' ? names?.plan_name_ar : names?.plan_name_en;
  return (
    named || plans[value as keyof typeof plans]?.[lang] || (lang === 'ar' ? 'غير محدد' : 'Unknown')
  );
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
const integrationStatuses: Record<string, { ar: string; en: string }> = {
  configured: { ar: 'شغّال', en: 'Connected' },
  not_configured: { ar: 'مش متوصل', en: 'Not connected' },
  local_only: { ar: 'محلي بس', en: 'Local only' },
  local_disk: { ar: 'على هارد السيرفر', en: 'Server disk' },
  local_sink_only: { ar: 'بيتحفظ في ملف (مش بيتبعت)', en: 'Saved to a file (not sent)' },
  manual_links: { ar: 'لينكات واتساب يدوية', en: 'Manual WhatsApp links' },
  not_used: { ar: 'مش مستخدم', en: 'Not used' },
  manual_only: { ar: 'تسجيل يدوي', en: 'Recorded manually' },
};
const integrationNames: Record<string, { ar: string; en: string }> = {
  auth: { ar: 'تسجيل الدخول', en: 'Sign-in' },
  object_storage: { ar: 'تخزين الملفات', en: 'File storage' },
  apple_wallet: { ar: 'Apple Wallet', en: 'Apple Wallet' },
  google_wallet: { ar: 'Google Wallet', en: 'Google Wallet' },
  email: { ar: 'الإيميل', en: 'Email' },
  whatsapp: { ar: 'واتساب', en: 'WhatsApp' },
  sms: { ar: 'رسايل SMS', en: 'SMS' },
  web_push: { ar: 'إشعارات المتصفح', en: 'Browser notifications' },
  payments: { ar: 'المدفوعات', en: 'Payments' },
};
export function integrationLabel(id: string, lang: Language) {
  return integrationNames[id]?.[lang] || id;
}
export function integrationStatusLabel(value: string, lang: Language) {
  return integrationStatuses[value]?.[lang] || statusLabel(value, lang);
}
export function statusLabel(value: string, lang: Language) {
  return genericStatuses[value]?.[lang] || value;
}

// Plain words for the activity log instead of internal event names.
const auditEvents: Record<string, { ar: string; en: string }> = {
  'asset.upload': { ar: 'رفع ملف', en: 'Uploaded a file' },
  'branch.create': { ar: 'إضافة فرع', en: 'Added a branch' },
  'branch.update': { ar: 'تعديل فرع', en: 'Edited a branch' },
  'branding.logo_publish': { ar: 'نشر لوجو جديد', en: 'Published a new logo' },
  'branding.publish': { ar: 'نشر تصميم الكارت', en: 'Published the card design' },
  'card.reset': { ar: 'تصفير كارت عميل', en: 'Reset a customer card' },
  'collection.settings.update': {
    ar: 'تعديل قواعد جمع الأختام',
    en: 'Changed stamp collection rules',
  },
  'correction.apply': { ar: 'تنفيذ تصحيح', en: 'Applied a correction' },
  'correction.reject': { ar: 'رفض تصحيح', en: 'Rejected a correction' },
  'correction.request': { ar: 'طلب تصحيح', en: 'Requested a correction' },
  'correction.review': { ar: 'مراجعة تصحيح', en: 'Reviewed a correction' },
  'customer.export.download': { ar: 'تنزيل ملف العملاء', en: 'Downloaded the customer file' },
  'customer.export.request': { ar: 'طلب ملف العملاء', en: 'Requested the customer file' },
  'customer.reminders.configure': { ar: 'تعديل التذكيرات', en: 'Changed reminders' },
  'customer.whatsapp.draft': { ar: 'تجهيز رسالة واتساب لعميل', en: 'Prepared a WhatsApp message' },
  'entitlements.update': { ar: 'تعديل حدود الباقة', en: 'Changed plan limits' },
  'invitation.resend': { ar: 'إعادة إرسال دعوة', en: 'Resent an invitation' },
  'invitation.revoke': { ar: 'إلغاء دعوة', en: 'Revoked an invitation' },
  'job.retry': { ar: 'إعادة محاولة مهمة', en: 'Retried a job' },
  'loyalty.award': { ar: 'إضافة أختام', en: 'Gave stamps' },
  'membership.scan': { ar: 'مسح كارت عميل', en: 'Scanned a customer card' },
  'membership.enroll': { ar: 'عميل جديد سجّل', en: 'New customer joined' },
  'merchant.activate': { ar: 'تفعيل المحل', en: 'Activated the business' },
  'merchant.owner_preview': { ar: 'معاينة لوحة صاحب المحل', en: 'Previewed the owner dashboard' },
  'merchant.status': { ar: 'تغيير حالة المحل', en: 'Changed business status' },
  'merchant.whatsapp.draft': {
    ar: 'تجهيز رسالة واتساب للمحل',
    en: 'Prepared a WhatsApp message to the shop',
  },
  'placement.create': { ar: 'إنشاء QR', en: 'Created a QR' },
  'placement.replace': { ar: 'استبدال QR', en: 'Replaced a QR' },
  'plan.keep': { ar: 'الإبقاء على الباقة', en: 'Kept the plan' },
  'plan.request': { ar: 'طلب تغيير الباقة', en: 'Requested a plan change' },
  'program.create': { ar: 'إنشاء برنامج', en: 'Created a program' },
  'program.earning': { ar: 'تشغيل/إيقاف جمع الأختام', en: 'Turned stamp earning on/off' },
  'program.end': { ar: 'إنهاء برنامج', en: 'Ended a program' },
  'program.publish': { ar: 'نشر نسخة برنامج', en: 'Published a program version' },
  'redemption.cancel': { ar: 'إلغاء صرف مكافأة', en: 'Cancelled a reward' },
  'redemption.resume': { ar: 'استكمال صرف مكافأة', en: 'Resumed a reward' },
  'redemption.start': { ar: 'بدء صرف مكافأة', en: 'Started a reward' },
  'holder.confirm': { ar: 'تأكيد صاحب الكارت', en: 'Confirmed the card holder' },
  'request.create': { ar: 'طلب ختم من عميل', en: 'Customer asked for a stamp' },
  'request.daily_limit': { ar: 'وصل للحد اليومي', en: 'Hit the daily limit' },
  'request.limit.update': { ar: 'تعديل حد الطلبات', en: 'Changed the request limit' },
  'request.reject': { ar: 'رفض طلب ختم', en: 'Rejected a stamp request' },
  'reward.redeem': { ar: 'صرف مكافأة', en: 'Redeemed a reward' },
  'staff.invite': { ar: 'إضافة موظف', en: 'Added a staff member' },
  'staff.update': { ar: 'تعديل موظف', en: 'Edited a staff member' },
  'subscription.earning.changed': {
    ar: 'تغيير جمع الأختام من الاشتراك',
    en: 'Stamp earning changed by billing',
  },
  'subscription.payment.recorded': { ar: 'تسجيل دفعة', en: 'Recorded a payment' },
  'subscription.payment.voided': { ar: 'إلغاء دفعة', en: 'Voided a payment' },
  'support.create': { ar: 'فتح تذكرة دعم', en: 'Opened a support ticket' },
  'support.reply': { ar: 'رد على تذكرة', en: 'Replied to a ticket' },
  'support.status': { ar: 'تغيير حالة تذكرة', en: 'Changed a ticket status' },
  'wallet.message.send': { ar: 'إرسال رسالة Wallet', en: 'Sent a Wallet message' },
  domain_event: { ar: 'تحديث كروت Wallet', en: 'Wallet card update' },
  invitation_email: { ar: 'إيميل دعوة', en: 'Invitation email' },
};
export function auditLabel(action: string, lang: Language) {
  return auditEvents[action]?.[lang] || action;
}
