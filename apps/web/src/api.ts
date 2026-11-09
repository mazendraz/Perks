import type { ApiFailure, Session } from '../../../packages/contracts/src/index.js';
import { portalForPath, type Portal } from './portals.js';
import { setNetworkUnavailable } from './network.js';
let csrf = '';
let ownerPreview: { merchantId: string; staffId: string } | null = null;
export function setOwnerPreview(value: typeof ownerPreview) {
  ownerPreview = value;
}
export function setCsrf(value: string) {
  csrf = value;
}
export class ApiError extends Error {
  constructor(
    public code: string,
    public status: number,
    public requestId?: string,
    public fields: { path: string; code: string }[] = [],
  ) {
    super(code);
  }
}
export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    key?: string;
    revision?: number;
    workspace?: Portal | 'shared';
  } = {},
  restoreDevice = true,
): Promise<T> {
  const headers: Record<string, string> = {};
  headers['x-nuqta-language'] = document.documentElement.lang === 'en' ? 'en' : 'ar';
  const authEntry = path === '/auth/login' || path === '/auth/register';
  const portal =
    options.workspace === 'shared'
      ? undefined
      : options.workspace ||
        (authEntry
          ? location.pathname.startsWith('/join/')
            ? 'customer'
            : undefined
          : portalForPath(location.pathname));
  if (portal) headers['x-nuqta-workspace'] = portal;
  const preview =
    ownerPreview &&
    location.pathname === '/platform/merchants/' + ownerPreview.merchantId + '/owner-view'
      ? ownerPreview
      : null;
  if (
    preview &&
    path !== '/auth/logout' &&
    path !== '/session' &&
    path !== '/platform/merchants/' + preview.merchantId + '/owner-preview'
  ) {
    if ((options.method || 'GET') !== 'GET') throw new ApiError('OWNER_PREVIEW_READ_ONLY', 403);
    headers['x-nuqta-owner-preview'] = preview.merchantId + ':' + preview.staffId;
  }
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET') headers['x-csrf-token'] = csrf;
  if (options.key) headers['Idempotency-Key'] = options.key;
  if (options.revision !== undefined) headers['If-Match'] = String(options.revision);
  let response: Response;
  try {
    response = await fetch('/api/v1' + path, {
      credentials: 'same-origin',
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    setNetworkUnavailable(true);
    throw new ApiError('NETWORK_UNCERTAIN', 0);
  }
  setNetworkUnavailable(false);
  if (response.status === 204) return undefined as T;
  const body = (await response.json()) as T & ApiFailure;
  if (
    restoreDevice &&
    portal === 'customer' &&
    path !== '/session' &&
    ((response.status === 401 && body.error?.code === 'UNAUTHENTICATED') ||
      (response.status === 403 && body.error?.code === 'CSRF_REJECTED'))
  ) {
    try {
      const session = await api<Session>('/session', { workspace: 'customer' }, false);
      csrf = session.csrfToken;
      window.dispatchEvent(new Event('nuqta:customer-session-restored'));
      // Authentication/CSRF rejected the first attempt before its handler ran.
      // Retry once, retaining the exact commercial command and idempotency key.
      return api<T>(path, options, false);
    } catch {
      /* A revoked or absent device must still receive the original failure. */
    }
  }
  if (response.status === 403 && body.error?.code === 'MFA_REQUIRED')
    window.dispatchEvent(new Event('nuqta:mfa-required'));
  if (
    path !== '/session' &&
    response.status === 401 &&
    csrf &&
    body.error?.code === 'UNAUTHENTICATED'
  ) {
    csrf = '';
    window.dispatchEvent(new Event('nuqta:session-expired'));
  }
  if (!response.ok)
    throw new ApiError(
      body.error?.code || 'REQUEST_FAILED',
      response.status,
      body.error?.requestId,
      body.error?.fields,
    );
  return body;
}
const arErrors: Record<string, string> = {
  CUSTOMER_DEVICE_REQUIRED:
    'كارت العميل بيفتح من سكان المحل أو رابط الاسترجاع على واتساب. الإيميل والباسورد للفريق والإدارة.',
  REGISTRATION_CLOSED:
    'حسابات الفريق بيضيفها المسؤول أو صاحب المحل. العميل يفتح الكارت من كود المحل.',
  CUSTOMER_PHONE_EXISTS: 'الرقم ده عليه كارت. اطلب من الكاشير يبعتهولك على واتساب.',
  CUSTOMER_DEVICE_REVOKED: 'الكارت مش على الجهاز ده. اطلب من الكاشير يرجعهولك على واتساب.',
  CUSTOMER_REGISTRATION_LIMIT: 'وصلت لعدد المحاولات المسموح. جرّب بعد ساعة أو اسأل الكاشير.',
  CUSTOMER_SEARCH_LIMIT: 'وصلت لحد البحث في الساعة. اسأل المدير يساعد العميل.',
  CUSTOMER_RECOVERY_LIMIT: 'وصلنا لحد10روابط للعميل النهارده. جرّب بكرة.',
  CASHIER_RECOVERY_DISABLED: 'استرجاع الكروت متاح للمالك أو المدير عندكم. اطلب مساعدتهم.',
  RECOVERY_LINK_INVALID: 'الرابط ده اتستخدم أو انتهى. اطلب من الكاشير رابط جديد.',
  DEVICE_ALREADY_BOUND: 'فيه كارت تاني مربوط بالجهاز. اخرج منه الأول أو افتح الرابط في متصفح تاني.',
  CUSTOMER_QR_REQUIRED: 'امسح كود العميل من موبايله الأول، وبعدها اعتمد الطلب.',
  REQUEST_DAILY_LIMIT: 'وصلت لحد طلبات الأختام النهارده. ارجع بكرة أو راجع فريق المحل.',
  ADMIN_EMAIL_IN_USE: 'الإيميل ده مستخدم بالفعل. اختار إيميل مستقل لحساب الإدارة.',
  ADMIN_SELF_MANAGEMENT: 'إعدادات حسابك الحالي من «حسابي». ماينفعش توقف نفسك من الفريق.',
  LAST_PLATFORM_ADMIN: 'لازم يفضل فيه سوبر أدمن نشط واحد على الأقل.',
  PORTAL_ACCESS_REQUIRED:
    'الحساب ده مش مخصص للبوابة دي. ادخل من البوابة المناسبة أو راجع مسؤول الحساب.',
  OWNER_PREVIEW_READ_ONLY:
    'دي معاينة لواجهة المالك. احفظ التعديلات الفعلية من ملف المحل في إدارة المنصة.',
  OWNER_PREVIEW_SCOPE: 'الصفحة دي خارج نطاق معاينة المحل.',
  PREVIEW_OWNER_UNAVAILABLE: 'المحل محتاج حساب مالك نشط علشان تفتح واجهته. راجع الفروع والحسابات.',
  ACCOUNT_SECURITY_NOT_MANAGED:
    'الحساب ده شخصي أو مشترك، أو خارج صلاحيتك. استخدم استعادة الحساب أو إدارة المنصة.',
  WHATSAPP_PHONE_REQUIRED: 'رقم واتساب مش مضاف. كمّل رقم التواصل الأول.',
  WHATSAPP_CONSENT_REQUIRED:
    'العميل مش موافق على واتساب حاليًا. يقدر يختار الموافقة بنفسه من تفضيلات كارته.',
  PHONE_UPDATE_FROM_PREFERENCES: 'غيّر رقمك من تفضيلات كارتك الحالي.',
  LAST_OWNER: 'لازم يفضل فيه مالك نشط للمحل. أضف مالك تاني قبل إيقاف الحساب ده.',
  SELF_ESCALATION_FORBIDDEN: 'ماينفعش توقف أو تسحب صلاحية حساب المالك اللي داخل بيه.',

  STAFF_PASSWORD_REQUIRED: 'اكتب باسورد لكل حساب جديد من خطوة الفروع والفريق.',
  ACCOUNT_EXISTS_USE_INVITATION:
    'الإيميل ده له حساب بالفعل. اختار دعوة لحساب موجود بدل إنشاء باسورد جديد.',
  ACCOUNT_NOT_IN_DRAFT: 'راجع إيميلات الفريق واحفظ المسودة الأول.',
  LOGO_NOT_FOUND: 'اللوجو مش متاح للمسودة دي. ارفعه تاني.',
  ASSET_TOO_LARGE: 'حجم اللوجو أكبر من ٢ ميجا.',
  UNSAFE_FILE: 'اختار صورة PNG أو JPG أو WebP صالحة.',
  INVALID_CREDENTIALS: 'الإيميل أوالباسورد مش صحيح.',
  ACCOUNT_UNAVAILABLE: 'الحساب ده موجود بالفعل. سجّل دخولك أوغيّر الباسورد من استعادة الحساب.',
  RESET_LINK_INVALID: 'رابط الاستعادة انتهى أواتستخدم. اطلب رابط جديد.',
  PASSWORD_LOGIN_REQUIRED: 'ادخل بالإيميل والباسورد.',
  PASSWORD_LENGTH: 'اختار باسورد من ١٠ لـ١٢٨ حرف.',
  PASSWORD_TOO_COMMON: 'الباسورد ده شائع وسهل تخمينه. اختار جملة أطول ومختلفة.',
  AUTH_BUSY: 'استنى لحظة وحاول تاني.',
  TERMS_CHANGED: 'الشروط اتحدثت. راجع النسخة الجديدة ووافق عليها قبل التسجيل.',
  EXPORT_SCOPE_CHANGED: 'صلاحيات الفروع اتغيرت. اطلب ملف تصدير جديد بصلاحياتك الحالية.',
  PURCHASE_ALREADY_USED: 'الإيصال ده اتسجل قبل كده. راجع العملية الموجودة.',
  QTY_OVER_LIMIT: 'عدد الأختام أكبر من الحد المسموح.',
  TOKEN_INVALID_OR_EXPIRED: 'الكود انتهى أوغير صالح. اطلب من العميل يجدده.',
  TOKEN_INVALID: 'الكود مش صالح للخطوة دي.',
  BRANCH_UNAUTHORIZED: 'الفرع ده مش متاح لصلاحيتك.',
  MERCHANT_PAUSED: 'النشاط موقوف مؤقتًا. تواصل مع الدعم.',
  PROGRAM_INACTIVE: 'جمع الأختام متوقف للبرنامج ده.',
  PROGRAM_VERSION_CHANGED: 'شروط البرنامج اتحدثت. افتحها وراجعها تاني.',
  REVISION_CONFLICT: 'البيانات اتحدثت. افتح آخر نسخة قبل التعديل.',
  MATCH_CODE_INVALID: 'كود المطابقة مش صحيح. راجعه مع العميل.',
  MATCH_ATTEMPTS_EXHAUSTED: 'محاولات المطابقة خلصت. العميل يلغي الطلب ويعمل طلب جديد.',
  REQUEST_EXPIRED: 'انتهت صلاحية الطلب. العميل محتاج يعمل طلب جديد.',
  REQUEST_ALREADY_DECIDED: 'الطلب اتقفل. راجع نتيجته قبل أي طلب جديد.',
  PLACEMENT_REVOKED: 'القطعة دي اتلغت. اطلب الرابط أوالقطعة الجديدة من الفرع.',
  PLACEMENT_UNAVAILABLE: 'الرابط مش متاح حاليًا. تواصل مع الفرع.',
  PLAN_LIMIT: 'وصلت لحد الخطة. راجع المالك أوالدعم.',
  DOWNGRADE_OVER_USAGE: 'الاستخدام الحالي أكبر من حدود الخطة الجديدة. مفيش بيانات اتحذفت.',
  REWARD_EXPIRED: 'المكافأة انتهت صلاحيتها.',
  REWARD_NOT_AVAILABLE: 'المكافأة مش متاحة للاستبدال دلوقتي.',
  UNAUTHENTICATED: 'سجّل دخولك عشان تكمّل.',
  INVALID_OR_EXPIRED_CODE: 'الكود غلط أوانتهت صلاحيته. اطلب كود جديد.',
  INVALID_MFA_CODE: 'رمز التحقق مش صحيح أواتستخدم قبل كده.',
  MFA_REQUIRED: 'أكد هويتك برمز تطبيق التحقق الأول.',
  ORIGIN_REJECTED: 'افتح التطبيق من عنوانه الصحيح.',
  CSRF_REJECTED: 'الجلسة محتاجة تحديث. افتح الصفحة تاني.',
  NOT_FOUND: 'البيانات مش متاحة للحساب ده.',
  FORBIDDEN: 'حسابك مش مصرح له بالإجراء ده.',
  VALIDATION_FAILED: 'راجع البيانات المطلوبة.',
  NETWORK_UNCERTAIN: 'النتيجة لسه مش مؤكدة. هنتحقق من نفس العملية.',
  CONFLICT: 'البيانات اتغيرت أوالطلب اتسجل قبل كده.',
  RATE_LIMITED: 'محاولات كتير. استنى شوية وحاول تاني.',
  INTERNAL_ERROR: 'حصل خطأ. استخدم مرجع الطلب مع الدعم.',
};
const enErrors: Record<string, string> = {
  CUSTOMER_DEVICE_REQUIRED:
    'Open your customer card from the shop code or a WhatsApp recovery link. Email and password are for staff and administrators.',
  REGISTRATION_CLOSED:
    'An administrator or owner creates team accounts. Customers open a card from the shop code.',
  CUSTOMER_PHONE_EXISTS:
    'This number already has a card. Ask the cashier to send it to you on WhatsApp.',
  CUSTOMER_DEVICE_REVOKED:
    'Your card is not on this device. Ask the cashier to restore it on WhatsApp.',
  CUSTOMER_REGISTRATION_LIMIT: 'Too many attempts. Try again in an hour or ask the cashier.',
  CUSTOMER_SEARCH_LIMIT: 'The hourly search limit was reached. Ask a manager to help the customer.',
  CUSTOMER_RECOVERY_LIMIT:
    'This customer reached the limit of 10 recovery links today. Try tomorrow.',
  CASHIER_RECOVERY_DISABLED: 'Ask the owner or manager to restore this customer’s card.',
  RECOVERY_LINK_INVALID: 'This link was used or expired. Ask the cashier for a new one.',
  DEVICE_ALREADY_BOUND:
    'This device is linked to another customer. Sign out first or use another browser.',
  CUSTOMER_QR_REQUIRED: 'Scan the customer code from their phone before approving the request.',
  REQUEST_DAILY_LIMIT:
    'You have reached today’s stamp request limit. Scan again tomorrow or ask the shop team.',
  PLACEMENT_UNAVAILABLE: 'This shop code is unavailable. Ask the branch team for the current code.',
  PLACEMENT_REVOKED: 'This shop code was replaced. Ask the branch team for the current code.',
  PASSWORD_LENGTH: 'Choose a password with 10 to 128 characters.',
  PASSWORD_TOO_COMMON: 'This password is commonly used. Choose a different, memorable phrase.',
  INVALID_MFA_CODE: 'This verification code is incorrect, expired or already used.',
  MFA_REQUIRED: 'Verify with your authenticator or an unused recovery code to continue.',
  ADMIN_EMAIL_IN_USE: 'This email is already in use. Use a separate email for this administrator.',
  ADMIN_SELF_MANAGEMENT:
    'Manage your current account in My account. You cannot disable yourself here.',
  LAST_PLATFORM_ADMIN: 'Keep at least one active super administrator.',
  PORTAL_ACCESS_REQUIRED:
    'This account does not have access to this portal. Use the correct portal or contact your account administrator.',
  OWNER_PREVIEW_READ_ONLY:
    'This is an owner preview. Save actual changes from the business workspace in the platform.',
  OWNER_PREVIEW_SCOPE: 'This page is outside this business preview.',
  PREVIEW_OWNER_UNAVAILABLE:
    'This business needs an active owner account before its dashboard can be previewed. Check Branches and accounts.',
  ACCOUNT_SECURITY_NOT_MANAGED:
    'This is a personal, shared or protected account. Use account recovery or platform administration.',
  WHATSAPP_PHONE_REQUIRED: 'Add a WhatsApp contact number first.',
  WHATSAPP_CONSENT_REQUIRED:
    'The customer has not opted into WhatsApp messages. They can choose consent in card preferences.',
  PHONE_UPDATE_FROM_PREFERENCES: 'Change your number from the preferences on your existing card.',
  LAST_OWNER: 'Keep at least one active owner. Add another owner before disabling this account.',

  STAFF_PASSWORD_REQUIRED: 'Enter a password for each new account in Branches and team.',
  ACCOUNT_EXISTS_USE_INVITATION:
    'This email already has an account. Choose the existing-account invitation option.',
  ACCOUNT_NOT_IN_DRAFT: 'Review staff emails and save the draft first.',
  LOGO_NOT_FOUND: 'This logo does not belong to the draft. Upload it again.',
  ASSET_TOO_LARGE: 'The logo must be 2 MB or smaller.',
  UNSAFE_FILE: 'Choose a valid PNG, JPG or WebP image.',
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  ACCOUNT_UNAVAILABLE: 'This account already exists. Sign in or recover your password.',
  RESET_LINK_INVALID: 'This recovery link has expired or was used. Request a new one.',
  AUTH_BUSY: 'Please wait a moment and try again.',
};
export function errorText(error: unknown, lang: 'ar' | 'en' = 'ar') {
  if (error instanceof ApiError)
    return (
      (lang === 'ar'
        ? arErrors[error.code] || error.code.replaceAll('_', ' ')
        : enErrors[error.code] || error.code.replaceAll('_', ' ')) +
      (error.requestId ? ' · ' + error.requestId : '')
    );
  return lang === 'ar' ? 'تعذر إكمال الطلب. حاول تاني.' : 'Unable to complete the request.';
}
