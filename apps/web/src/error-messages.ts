/**
 * Every message a person can see when something did not work.
 * Rule for each line: say what happened in plain words, then what to do about it.
 * No internal codes, no request ids (except a short reference when we truly do not know
 * what went wrong), and nothing about the shop's plan or billing ever reaches a customer.
 */
export type Lang = 'ar' | 'en';
export type Audience = 'customer' | 'staff';

export interface ErrorDetails {
  entitlement?: string;
  limit?: number;
  used?: number;
  options?: { type: string; key?: string; plan?: string; price?: number }[];
}

type Line = [ar: string, en: string];

const messages: Record<string, Line> = {
  // ---- connection and sessions
  NETWORK_UNCERTAIN: [
    'النت فصل قبل ما نتأكد إن العملية تمت. أول ما يرجع، افتح الصفحة تاني وهتلاقي النتيجة.',
    'The connection dropped before we could confirm. Once you are back online, reopen the page to see the result.',
  ],
  REQUEST_TIMEOUT: [
    'الصفحة اتأخرت في التحميل. جرّب تاني بعد لحظة.',
    'This is taking longer than usual. Try again in a moment.',
  ],
  RATE_LIMITED: [
    'محاولات كتير ورا بعض. استنى دقيقة وجرّب تاني.',
    'Too many tries in a row. Wait a minute and try again.',
  ],
  AUTH_BUSY: ['استنى لحظة وجرّب تاني.', 'Wait a moment and try again.'],
  UNAUTHENTICATED: [
    'خرجت من حسابك. سجّل دخولك تاني وكمّل.',
    'You were signed out. Sign in again to continue.',
  ],
  CSRF_REJECTED: [
    'الصفحة قديمة شوية. اعمل تحديث للصفحة وكمّل.',
    'This page is out of date. Refresh it and continue.',
  ],
  ORIGIN_REJECTED: [
    'افتح Perks من الرابط الأساسي بتاعه وجرّب تاني.',
    'Open Perks from its main address and try again.',
  ],
  INTERNAL_ERROR: [
    'حصلت مشكلة عندنا مش منك. جرّب تاني، ولو اتكررت ابعتلنا رقم المشكلة اللي تحت.',
    'Something went wrong on our side. Try again; if it keeps happening, send us the reference below.',
  ],
  REQUEST_FAILED: [
    'ماقدرناش نكمّل الطلب. جرّب تاني بعد لحظة.',
    'We could not finish that. Try again in a moment.',
  ],
  INVALID_REQUEST: [
    'فيه حاجة ناقصة في الطلب. حدّث الصفحة وجرّب تاني.',
    'Something was missing from the request. Refresh and try again.',
  ],
  VALIDATION_FAILED: [
    'فيه خانة محتاجة تتظبط. راجع الخانات المعلّمة بالأحمر.',
    'A field needs fixing. Check the fields marked in red.',
  ],
  NOT_FOUND: [
    'مش لاقيين الحاجة دي، أو مش ضمن صلاحيات حسابك. ارجع للصفحة الرئيسية وجرّب تاني.',
    'We could not find this, or it is outside your account. Go back home and try again.',
  ],
  FORBIDDEN: [
    'حسابك مالوش صلاحية للخطوة دي. اطلبها من صاحب المحل.',
    'Your account cannot do this. Ask the shop owner.',
  ],
  CONFLICT: [
    'الحاجة دي اتسجلت أو اتغيرت قبل كده. حدّث الصفحة وشوف آخر حالة.',
    'This was already saved or changed. Refresh to see the latest.',
  ],
  REVISION_CONFLICT: [
    'حد تاني عدّل نفس البيانات من شوية. حدّث الصفحة، وبعدين اعمل تعديلك.',
    'Someone else just changed this. Refresh, then make your change.',
  ],
  IDEMPOTENCY_CONFLICT: [
    'نفس الطلب اتبعت ببيانات مختلفة. حدّث الصفحة وابعته تاني.',
    'The same request was sent with different details. Refresh and send it again.',
  ],
  INVALID_QUERY: [
    'فيه قيمة مش مظبوطة في البحث أو الطلب. غيّرها وجرّب تاني.',
    'A value in the search or request is not valid. Change it and try again.',
  ],

  // ---- sign in and accounts
  INVALID_CREDENTIALS: [
    'الإيميل أو الباسورد مش مظبوط. راجعهم، أو اعمل باسورد جديد من "نسيت كلمة المرور؟".',
    'The email or password is not right. Check them, or reset your password.',
  ],
  ACCOUNT_UNAVAILABLE: [
    'الإيميل ده عليه حساب بالفعل. سجّل دخولك، أو اعمل باسورد جديد من "نسيت كلمة المرور؟".',
    'This email already has an account. Sign in or reset your password.',
  ],
  RESET_LINK_INVALID: [
    'رابط تغيير الباسورد خلص أو اتستخدم. اطلب رابط جديد.',
    'This reset link expired or was used. Request a new one.',
  ],
  PASSWORD_LOGIN_REQUIRED: ['ادخل بالإيميل والباسورد.', 'Sign in with your email and password.'],
  PASSWORD_LENGTH: [
    'الباسورد لازم يكون من 10 لـ 128 حرف.',
    'Use a password of 10 to 128 characters.',
  ],
  PASSWORD_TOO_COMMON: [
    'الباسورد ده مشهور وسهل حد يخمّنه. اختار جملة أطول تفتكرها.',
    'This password is too common. Pick a longer phrase you will remember.',
  ],
  PASSWORD_CHANGE_REQUIRED: [
    'اختار باسورد جديد خاص بيك الأول، وبعدين كمّل.',
    'Choose your own new password first, then continue.',
  ],
  INVALID_OR_EXPIRED_CODE: [
    'الكود غلط أو خلص. اطلب كود جديد.',
    'The code is wrong or expired. Request a new one.',
  ],
  INVALID_MFA_CODE: [
    'رمز التحقق مش صح أو اتستخدم قبل كده. خد الرمز الجديد من التطبيق.',
    'The verification code is wrong or was already used. Use the latest code from the app.',
  ],
  MFA_REQUIRED: [
    'أكّد إنه انت برمز تطبيق التحقق الأول.',
    'Confirm it is you with your authenticator code first.',
  ],
  MANAGED_AUTH_REQUIRED: [
    'الطريقة دي مش متاحة. ادخل بالإيميل والباسورد.',
    'This sign-in method is unavailable. Use email and password.',
  ],
  PASSWORD_AUTH_NOT_CONFIGURED: [
    'الدخول واقف عندنا دلوقتي. كلّمنا على 01006111380.',
    'Sign-in is unavailable right now. Call us on 01006111380.',
  ],
  PORTAL_ACCESS_REQUIRED: [
    'الحساب ده مش للصفحة دي. ادخل من الصفحة المناسبة لدورك (صاحب محل، كاشير، أو أدمن).',
    'This account is not for this page. Sign in from the page for your role.',
  ],
  REGISTRATION_CLOSED: [
    'حسابات الفريق بيعملها صاحب المحل. لو انت زبون، افتح الكارت من كود المحل.',
    'Team accounts are created by the shop owner. Customers open their card from the shop code.',
  ],
  SLUG_TAKEN: [
    'اسم رابط التسجيل ده مستخدم لمحل تاني. اختار اسم رابط مختلف.',
    'This enrollment slug is already used by another business. Choose a different one.',
  ],
  ACCOUNT_EXISTS_USE_INVITATION: [
    'الإيميل ده عليه حساب. ابعتله دعوة بدل ما تعمله باسورد جديد.',
    'This email already has an account. Send an invitation instead of a new password.',
  ],
  INVALID_ACCOUNT: [
    'بيانات الحساب ناقصة: اختار الدور وفرع واحد على الأقل، واكتب باسورد مناسب.',
    'Account details are incomplete: pick a role, at least one branch and a valid password.',
  ],
  INVALID_ACCOUNT_ACTION: [
    'الإجراء ده مش مناسب للحساب. حدّث الصفحة واختار تاني.',
    'That action does not fit this account. Refresh and choose again.',
  ],
  STAFF_PASSWORD_REQUIRED: [
    'اكتب باسورد لكل حساب جديد في خطوة الفروع والفريق.',
    'Enter a password for each new account in Branches and team.',
  ],
  ACCOUNT_NOT_IN_DRAFT: [
    'راجع إيميلات الفريق واحفظ قبل ما تكمّل.',
    'Review the team emails and save first.',
  ],
  ACCOUNT_SECURITY_NOT_MANAGED: [
    'الحساب ده شخصي ومش بيتدار من هنا. صاحبه يغيّر الباسورد من "نسيت كلمة المرور؟".',
    'This is a personal account managed by its owner. They can reset it from "Forgot password".',
  ],
  ADMIN_EMAIL_IN_USE: [
    'الإيميل ده مستخدم. اختار إيميل تاني للأدمن.',
    'This email is in use. Choose another for the admin.',
  ],
  ADMIN_SELF_MANAGEMENT: [
    'حسابك انت بتعدّله من "حسابي"، ومينفعش توقفه من هنا.',
    'Edit your own account from My account; you cannot disable yourself here.',
  ],
  LAST_PLATFORM_ADMIN: ['لازم يفضل أدمن واحد شغال على الأقل.', 'Keep at least one active admin.'],
  LAST_OWNER: [
    'المحل لازم يفضل ليه صاحب شغال. ضيف صاحب تاني قبل ما توقف الحساب ده.',
    'The shop needs an active owner. Add another owner before disabling this one.',
  ],
  SELF_ESCALATION_FORBIDDEN: [
    'مينفعش تقلل صلاحيات حسابك انت.',
    'You cannot reduce your own access.',
  ],
  STAFF_DISABLED: [
    'الحساب ده موقوف. كلّم صاحب المحل يرجّعه.',
    'This account is disabled. Ask the shop owner to restore it.',
  ],

  // ---- the shop's plan (staff only; customers never see these)
  ENTITLEMENTS_NOT_CONFIGURED: [
    'باقة المحل لسه متظبطتش. كلّمنا على 01006111380 ونظبطها في دقايق.',
    'This shop’s plan is not set up yet. Call us on 01006111380 and we will set it up.',
  ],
  SUBSCRIPTION_GRACE: [
    'الحساب في فترة سماح. مش هتقدر تضيف فروع أو موظفين أو برامج جديدة لحد ما الدفع يتسجل.',
    'The account is in its grace period. New branches, staff and programs wait until the payment is recorded.',
  ],
  PLAN_LIMIT: [
    'وصلت لحد باقتك. طلّع الباقة أو كلّمنا.',
    'You reached your plan limit. Upgrade or contact us.',
  ],
  DOWNGRADE_OVER_USAGE: [
    'الباقة الجديدة أصغر من اللي بتستخدمه دلوقتي. اختار اللي يفضل شغال، ومفيش بيانات هتتمسح.',
    'The new plan is smaller than what you use now. Choose what stays active; no data is deleted.',
  ],
  BRANCH_LOCKED: [
    'الفرع ده مقفول مؤقتًا لأنه برّه باقة المحل. كلّم صاحب المحل.',
    'This branch is locked because it is outside the shop’s plan. Ask the shop owner.',
  ],
  STAFF_LOCKED: [
    'حسابك مقفول مؤقتًا لأن عدد الموظفين أكبر من باقة المحل. كلّم صاحب المحل.',
    'Your account is locked because the shop has more staff than its plan allows. Ask the shop owner.',
  ],
  ADDON_NOT_IN_PLAN: [
    'الإضافة دي مش متاحة في الباقة دي. غيّر الباقة الأول.',
    'This add-on is not available on this plan. Change the plan first.',
  ],
  ADDON_CAP_REACHED: [
    'العدد ده أكتر من أقصى حد للإضافة في الباقة دي. لو محتاج أكتر، اعمل عرض Enterprise.',
    'That is more than this plan allows for the add-on. For more, set up an Enterprise deal.',
  ],
  NO_BILLING_PERIOD: [
    'المحل معندوش ميعاد تجديد لسه. سجّل دفعة الأول أو غيّر الباقة دلوقتي.',
    'This shop has no renewal date yet. Record a payment first, or change the plan now.',
  ],
  PLAN_PRICE_MISSING: [
    'الباقة دي ملهاش سعر للمدة دي. حط السعر في كتالوج الباقات الأول.',
    'This plan has no price for that billing period. Add it in the plans catalog first.',
  ],
  SUBSCRIPTION_READ_ONLY: [
    'الاشتراك اتلغى، فالحساب بقى للعرض بس. تقدر تنزّل عملاءك CSV لمدة 30 يوم من الإلغاء. عايز ترجع؟ كلّمنا على 01006111380.',
    'The subscription ended, so the account is view-only. You can export customers as CSV for 30 days. Want to come back? Call 01006111380.',
  ],
  PLAN_REQUEST_OPEN: [
    'عندك طلب مفتوح مع فريق Perks. استنى ردنا أو الغيه من باقتي.',
    'You already have an open request with the Perks team. Wait for our reply or withdraw it in My plan.',
  ],
  NO_RECIPIENTS: [
    'مفيش عملاء توصلهم الرسالة دي دلوقتي. اختار مجموعة تانية، واللي وصلتله رسالة النهارده مش هيتبعتله تاني.',
    'Nobody would get this message right now. Pick another group; anyone messaged today is skipped.',
  ],
  WALLET_MESSAGES_UNAVAILABLE: [
    'رسايل Wallet لسه متفعلتش. كلّم Perks على 01006111380.',
    'Wallet messages are not switched on yet. Contact Perks on 01006111380.',
  ],
  MERCHANT_PAUSED: [
    'الحساب متوقف مؤقتًا. كلّم Perks على 01006111380.',
    'This account is paused. Contact Perks on 01006111380.',
  ],
  SUBSCRIPTION_INACTIVE: [
    'جمع الأختام متوقف مؤقتًا من إدارة Perks. الكروت والمكافآت محفوظة. كلّمنا على 01006111380.',
    'Stamp collection is paused by Perks. Cards and rewards are kept. Call us on 01006111380.',
  ],
  EARNING_PAUSED: [
    'جمع الأختام متوقف مؤقتًا من إدارة Perks. الكروت والمكافآت محفوظة. كلّمنا على 01006111380.',
    'Stamp collection is paused by Perks. Cards and rewards are kept. Call us on 01006111380.',
  ],
  OWNER_PREVIEW_READ_ONLY: [
    'دي معاينة بس. التعديلات الحقيقية بتتعمل من ملف المحل في لوحة الأدمن.',
    'This is a preview only. Make real changes from the shop file in the admin panel.',
  ],
  OWNER_PREVIEW_SCOPE: ['الصفحة دي خارج معاينة المحل.', 'This page is outside the shop preview.'],
  PREVIEW_OWNER_UNAVAILABLE: [
    'المحل محتاج حساب صاحب محل شغال عشان تشوف واجهته.',
    'The shop needs an active owner account before you can preview it.',
  ],

  // ---- branches, programs, cashier work
  BRANCH_UNAUTHORIZED: [
    'الفرع ده مش ضمن الفروع المسموحة لحسابك.',
    'This branch is not one of your allowed branches.',
  ],
  LAST_ACTIVE_BRANCH: ['لازم يفضل فرع واحد شغال على الأقل.', 'Keep at least one branch active.'],
  BRANCH_POSITION_REQUIRED: [
    'حدد مكان كل فرع شغال على الخريطة الأول، وبعدين فعّل التحقق من الموقع.',
    'Set each active branch on the map first, then turn on location checks.',
  ],
  MAPS_LINK_UNREADABLE: [
    'ماعرفناش نقرا المكان من الرابط ده. افتح خرايط جوجل، دوس مطوّل على المحل، وانسخ الأرقام اللي بتظهر.',
    'We could not read that link. In Google Maps, long-press the shop and copy the numbers shown.',
  ],
  PROGRAM_INACTIVE: [
    'البرنامج ده واقف دلوقتي، فمفيش أختام جديدة عليه.',
    'This program is not running now, so it takes no new stamps.',
  ],
  PROGRAM_VERSION_CHANGED: [
    'شروط البرنامج اتحدّثت. افتحها تاني وراجعها.',
    'The program terms changed. Open them again and review.',
  ],
  PROGRAM_BRANCH_UNAUTHORIZED: [
    'البرنامج ده مش شغال في الفرع ده.',
    'This program does not run at this branch.',
  ],
  QTY_OVER_LIMIT: [
    'عدد الأختام أكتر من المسموح في المرة الواحدة. قلّل العدد.',
    'That is more stamps than allowed at once. Lower the number.',
  ],
  PURCHASE_ALREADY_USED: [
    'الإيصال ده اتسجل عليه ختم قبل كده.',
    'This receipt already got a stamp.',
  ],
  RECEIPT_INVALID: [
    'رقم الإيصال فيه رموز مش مسموحة. اكتب حروف وأرقام بس.',
    'Use only letters and numbers in the receipt number.',
  ],
  BUSINESS_DATE_MISMATCH: [
    'اليوم اتغير من ساعة ما فتحت الصفحة. حدّثها وجرّب تاني.',
    'The day changed since you opened the page. Refresh and try again.',
  ],
  CUSTOMER_QR_REQUIRED: [
    'امسح كود الزبون من موبايله الأول، وبعدين وافق.',
    'Scan the customer’s code from their phone first, then approve.',
  ],
  TOKEN_INVALID: [
    'الكود ده مش للخطوة دي. اطلب من الزبون يفتح كارته ويوريك الكود تاني.',
    'This code is not for this step. Ask the customer to show their card code again.',
  ],
  TOKEN_INVALID_OR_EXPIRED: [
    'الكود خلص. خلّي الزبون يحدّث كارته ويوريك الكود الجديد.',
    'The code expired. Ask the customer to refresh their card and show the new code.',
  ],
  MATCH_CODE_INVALID: [
    'كود المطابقة مش هو. راجعه مع الزبون تاني.',
    'The match code is not right. Check it with the customer.',
  ],
  MATCH_ATTEMPTS_EXHAUSTED: [
    'المحاولات خلصت. الزبون يلغي الطلب ويعمل طلب جديد.',
    'No tries left. The customer cancels and requests again.',
  ],
  REQUEST_EXPIRED: [
    'الطلب ده خلص وقته. الزبون يعمل سكان تاني.',
    'This request timed out. The customer scans again.',
  ],
  REQUEST_ALREADY_DECIDED: [
    'الطلب ده اتقفل خلاص. شوف نتيجته في السجل.',
    'This request is already closed. See its result in the history.',
  ],
  REQUEST_CONTEXT_MISMATCH: [
    'الطلب ده لزبون أو فرع تاني. امسح الكود من جديد.',
    'This request is for another customer or branch. Scan again.',
  ],
  REQUEST_NOT_EXPIRED: [
    'الطلب لسه شغال. استنى لحد ما يخلص وقته.',
    'The request is still open. Wait for it to time out.',
  ],
  SELF_APPROVAL_FORBIDDEN: [
    'مينفعش توافق على طلب انت عامله. خلّي مدير تاني يوافق.',
    'You cannot approve your own request. Ask another manager.',
  ],
  CORRECTION_FINAL: ['التصحيح ده اتقفل خلاص.', 'This correction is already closed.'],
  CORRECTION_REQUIRES_REVIEW: [
    'الكارت اتغير بعد التصحيح ده، فلازم مدير يراجعه.',
    'The card changed after this correction, so a manager needs to review it.',
  ],
  ALREADY_REVERSED: ['الختم ده اتلغى قبل كده.', 'This stamp was already taken back.'],
  REVOKE_WINDOW_CLOSED: [
    'عدّى وقت إلغاء الختم ده. اطلب من المدير.',
    'It is too late to take this stamp back. Ask a manager.',
  ],
  REWARD_ALREADY_REDEEMED: [
    'الختم ده اتحسب في هدية الزبون أخدها خلاص، فمينفعش يتلغي.',
    'This stamp counted toward a reward the customer already received, so it cannot be revoked.',
  ],
  CUSTOMER_BLOCKED: [
    'العميل ده محظور في المحل. فك الحظر من قائمة السبام الأول.',
    'This customer is blocked at this shop. Unblock them from the Spam list first.',
  ],
  STAMP_UNAVAILABLE: [
    'مش متاح تاخد ختم من هنا دلوقتي. كلّم الكاشير.',
    'A stamp is not available here right now. Please ask the cashier.',
  ],
  BALANCE_TOO_LOW: [
    'الكارت مافيهوش أختام كفاية للإلغاء. ممكن تصفّر الكارت بدل كده.',
    'The card has too few stamps to take this back. Reset the card instead.',
  ],
  CARD_RESET_SINCE: [
    'الكارت اتصفّر بعد الختم ده، فمفيش حاجة تتلغي.',
    'The card was reset after this stamp, so there is nothing to undo.',
  ],
  NOT_AUTOMATIC_STAMP: [
    'الختم ده إداه كاشير. اعمل طلب تصحيح بدل الإلغاء.',
    'A cashier gave this stamp. Request a correction instead.',
  ],
  REASON_REQUIRED: [
    'اكتب السبب في جملة قصيرة (4 حروف على الأقل).',
    'Write the reason in a short sentence (4+ characters).',
  ],
  CHALLENGE_ACTIVE: [
    'فيه صرف مفتوح للهدية دي من جهاز تاني. استنى 3 دقايق وجرّب.',
    'This reward is being redeemed on another device. Wait 3 minutes.',
  ],
  CHALLENGE_EXPIRED: [
    'طلب صرف الهدية خلص وقته. ابدأ من جديد.',
    'The redemption timed out. Start again.',
  ],
  CHALLENGE_FINAL: [
    'صرف الهدية اتقفل خلاص. حدّث الشاشة.',
    'This redemption is closed. Refresh the screen.',
  ],
  HOLDER_NOT_CONFIRMED: [
    'الزبون لسه ماأكدش من موبايله. استنى ثانية.',
    'The customer has not confirmed on their phone yet.',
  ],
  REWARD_UNAVAILABLE: ['الهدية دي مش متاحة للصرف دلوقتي.', 'This reward cannot be redeemed now.'],
  REWARD_NOT_AVAILABLE: ['الهدية دي مش متاحة للصرف دلوقتي.', 'This reward cannot be redeemed now.'],
  REWARD_ALREADY_USED: ['الهدية دي اتصرفت قبل كده.', 'This reward was already used.'],
  REWARD_BRANCH_UNAUTHORIZED: [
    'الهدية دي مش بتتصرف في الفرع ده.',
    'This reward is not redeemed at this branch.',
  ],
  REWARD_EXPIRED: ['الهدية دي خلصت صلاحيتها.', 'This reward has expired.'],
  CUSTOMER_SEARCH_LIMIT: [
    'وصلت لحد البحث في الساعة. اطلب من المدير يساعد الزبون.',
    'You hit the hourly search limit. Ask a manager to help.',
  ],
  CUSTOMER_RECOVERY_LIMIT: [
    'الزبون ده وصل لحد الاسترجاع النهارده. جرّب بكرة.',
    'This customer reached today’s recovery limit. Try tomorrow.',
  ],
  CASHIER_RECOVERY_DISABLED: [
    'استرجاع الكروت بيعمله صاحب المحل أو المدير.',
    'The owner or a manager restores cards.',
  ],
  PAIRING_CODE_INVALID: [
    'الكود أو الرقم مش مطابقين، أو الكود خلص. اتأكد إن الرقم هو اللي الزبون كتبه، أو خلّيه يطلب كود جديد.',
    'The code or the number does not match, or the code ended. Check it is the number the customer typed, or ask for a new code.',
  ],
  CUSTOMER_HAS_CARD_HERE: [
    'العميل ده عنده كارت هنا أصلًا. دوّر برقمه في الفرع اللي اتسجّل فيه ورجّعله الكارت.',
    'This customer already has a card here. Search their number at the branch where they joined and restore it.',
  ],
  PAIRING_NOT_PENDING: [
    'الطلب ده اتقرر أو خلص وقته.',
    'This request was already decided or expired.',
  ],
  PAIRING_SELF_APPROVAL: [
    'مينفعش توافق على طلب انت عامله. اطلب من حد تاني في الإدارة.',
    'You cannot approve your own request. Ask another manager.',
  ],
  CASHIER_REQUIRED: [
    'المحل ده بيحتاج موافقة الكاشير على كل ختم.',
    'This shop needs the cashier to approve every stamp.',
  ],
  WHATSAPP_PHONE_REQUIRED: ['ضيف رقم واتساب للمحل الأول.', 'Add the shop’s WhatsApp number first.'],
  WHATSAPP_CONSENT_REQUIRED: [
    'الزبون ماوافقش على رسايل واتساب. يقدر يفعّلها من إعدادات كارته.',
    'The customer has not allowed WhatsApp messages. They can turn them on in card settings.',
  ],
  INVALID_PHONE: [
    'الرقم مش مكتوب صح. اكتبه بالكود الدولي، زي +201001234567.',
    'Write the number with its country code, like +201001234567.',
  ],
  CUSTOMER_PRIVACY_DELETED: [
    'بيانات زبون اتمسحت بطلبه. اطلب ملف تصدير جديد.',
    'A customer’s data was deleted at their request. Request a new export.',
  ],
  EXPORT_SCOPE_CHANGED: [
    'صلاحيات الفروع اتغيرت. اطلب ملف تصدير جديد.',
    'Branch access changed. Request a new export.',
  ],
  PLACEMENT_TRANSITION_INVALID: [
    'الخطوة دي مش مناسبة لحالة الاستاند دلوقتي. حدّث الصفحة.',
    'That step does not fit this stand’s status. Refresh the page.',
  ],
  DEVICE_EVIDENCE_REQUIRED: [
    'اكتب الموبايل اللي جرّبت عليه قبل ما تأكد.',
    'Write which phone you tested on before confirming.',
  ],
  LIVE_CAPACITY: [
    'التحديث اللحظي مشغول، والشاشة هتتحدّث لوحدها كل كام ثانية.',
    'Live updates are busy; the screen refreshes on its own.',
  ],
  LIVE_UNAVAILABLE: [
    'التحديث اللحظي واقف، والشاشة هتتحدّث لوحدها كل كام ثانية.',
    'Live updates are off; the screen refreshes on its own.',
  ],
  LIVE_STREAM_LIMIT: [
    'الصفحة دي مفتوحة في أماكن كتير. اقفل التابات الزيادة.',
    'This page is open in too many places. Close extra tabs.',
  ],
  PUSH_NOT_ENABLED: ['الإشعارات مش متاحة دلوقتي.', 'Notifications are not available right now.'],
  PUSH_NOT_DELIVERED: [
    'الإشعار ماوصلش للجهاز. جرّب تفعّل الإشعارات تاني.',
    'The notification did not reach this device. Try turning notifications on again.',
  ],
  LOGO_NOT_FOUND: ['اللوجو مش موجود. ارفعه تاني.', 'The logo is missing. Upload it again.'],
  ASSET_TOO_LARGE: [
    'الصورة أكبر من 2 ميجا. صغّرها وارفعها تاني.',
    'The image is over 2 MB. Make it smaller and upload again.',
  ],
  UNSAFE_FILE: ['اختار صورة PNG أو JPG أو WebP.', 'Choose a PNG, JPG or WebP image.'],
  INVALID_STORAGE_KEY: [
    'الملف ده مش متاح. اطلبه من جديد.',
    'This file is unavailable. Request it again.',
  ],
  UNSAFE_STORAGE_PATH: [
    'الملف ده مش متاح. اطلبه من جديد.',
    'This file is unavailable. Request it again.',
  ],
  WALLET_UNAVAILABLE: [
    'إضافة الكارت للـ Wallet مش متاحة دلوقتي. الكارت شغال من الرابط عادي.',
    'Adding to Wallet is unavailable right now. Your card still works from its link.',
  ],
  JOB_NOT_RETRYABLE: ['المهمة دي مينفعش تتعاد.', 'This job cannot be retried.'],
  PROVIDER_RECONCILIATION_REQUIRED: [
    'المهمة دي محتاجة مراجعة يدوية قبل الإعادة.',
    'This job needs a manual check before retrying.',
  ],
  PAYMENT_REFERENCE_USED: [
    'رقم التحويل ده متسجل قبل كده. راجع سجل الدفعات.',
    'This payment reference is already recorded. Check the payment history.',
  ],
  PAYMENT_ALREADY_VOID: [
    'الدفعة دي اتلغت قبل كده. حدّث السجل.',
    'This payment was already voided. Refresh the history.',
  ],
  WORK_ACCOUNT_REVIEW_REQUIRED: [
    'الحساب ده مربوط بفريق محل كمان. أدمن Perks لازم يفصله الأول.',
    'This account is also on a shop team. A Perks admin needs to separate it first.',
  ],

  // ---- the customer's own card
  CUSTOMER_DEVICE_REQUIRED: [
    'كارتك بيتفتح من كود المحل أو رابط الواتساب. الإيميل والباسورد للفريق بس.',
    'Your card opens from the shop code or your WhatsApp link. Email and password are for the team.',
  ],
  CUSTOMER_PHONE_EXISTS: [
    'الرقم ده عليه كروت على موبايل تاني. رجّعها من «رجّع كروتك».',
    'This number has cards on another phone. Bring them back from “Restore my cards”.',
  ],
  CUSTOMER_DEVICE_REVOKED: [
    'كارتك مش على الموبايل ده. افتحه من الـWallet، أو اطلب من الكاشير في أي محل Perks يرجعهولك.',
    'Your card is not on this phone. Open it from your Wallet, or ask the cashier at any Perks shop to restore it.',
  ],
  CUSTOMER_REGISTRATION_LIMIT: [
    'محاولات كتير. جرّب بعد ساعة أو اطلب من الكاشير يساعدك.',
    'Too many tries. Try in an hour or ask the cashier.',
  ],
  DEVICE_SCOPE_RECOVERY_REQUIRED: [
    'الموبايل ده مربوط بكروت محلات معيّنة. عشان تفتح كل كروتك، افتح أي كارت من الـWallet.',
    'This phone is linked to some shops’ cards. To open all your cards, open any card from your Wallet.',
  ],
  WALLET_LINK_INVALID: [
    'لينك الكارت ده قديم أو اتستخدم على موبايل تاني. افتح الكارت من الـWallet بعد ما يتحدّث، أو رجّع كروتك.',
    'This card link is old or was used on another phone. Open the card from Wallet once it updates, or restore your cards.',
  ],
  WHATSAPP_PROOF_EXPIRED: [
    'الكود ده انتهى. اطلب رسالة جديدة من هنا.',
    'This code expired. Request a new message here.',
  ],
  WHATSAPP_RECOVERY_UNAVAILABLE: [
    'واتساب مقدرش يرجّع كروتك. افتح أي كارت من الـWallet أو اطلب مساعدة الكاشير.',
    'WhatsApp couldn’t restore your cards. Open a card from Wallet or ask the cashier for help.',
  ],
  WHATSAPP_PHONE_IN_USE: [
    'الرقم ده مربوط بحساب تاني. تواصل مع دعم Perks من نفس الرقم.',
    'This number is linked to another account. Contact Perks support from that same number.',
  ],
  RECOVERY_LINK_INVALID: [
    'الرابط ده اتستخدم أو خلص. اطلب من الكاشير رابط جديد.',
    'This link was used or expired. Ask the cashier for a new one.',
  ],
  DEVICE_ALREADY_BOUND: [
    'فيه كارت تاني على الموبايل ده. اخرج منه الأول أو افتح الرابط من متصفح تاني.',
    'Another card is on this phone. Sign out of it or use another browser.',
  ],
  REQUEST_DAILY_LIMIT: [
    'خدت أختام النهارده خلاص. ارجعلنا بكرة 👋',
    'You have collected today’s stamps. See you tomorrow 👋',
  ],
  COLLECTION_LIMIT: [
    'الختم ده اتحسب خلاص. ارجعلنا الزيارة الجاية.',
    'This stamp is already counted. See you next visit.',
  ],
  REQUEST_ALREADY_PENDING: [
    'طلب الختم وصل للكاشير. استنى ثانية يوافق.',
    'Your stamp request reached the cashier. One moment.',
  ],
  MEMBERSHIP_DISABLED: ['الكارت ده موقوف. اسأل المحل.', 'This card is paused. Ask the shop.'],
  PRIVACY_CHANGED: [
    'الشروط والخصوصية اتحدّثت. راجعها ووافق عليها وكمّل.',
    'The terms changed. Review and accept them to continue.',
  ],
  TERMS_CHANGED: [
    'الشروط اتحدّثت. راجعها ووافق عليها وكمّل.',
    'The terms changed. Review and accept them to continue.',
  ],
  PHONE_UPDATE_FROM_PREFERENCES: [
    'غيّر رقمك من إعدادات كارتك.',
    'Change your number from your card settings.',
  ],
  PLACEMENT_REVOKED: [
    'الكود ده اتغير. اطلب الكود الجديد من المحل.',
    'This code was replaced. Ask the shop for the new one.',
  ],
  PLACEMENT_UNAVAILABLE: [
    'الكود ده مش شغال دلوقتي. اسأل المحل.',
    'This code is not working now. Ask the shop.',
  ],
};

/**
 * Customers get shop-neutral wording: nothing about plans, payments or "Perks admin".
 * Their cards and rewards keep working whatever happens on the shop's side.
 */
const customerMessages: Record<string, Line> = {
  SUBSCRIPTION_INACTIVE: [
    'المحل موقّف جمع الأختام مؤقتًا. أختامك وهداياك محفوظة زي ما هي.',
    'The shop has paused stamps for now. Your stamps and rewards are safe.',
  ],
  EARNING_PAUSED: [
    'المحل موقّف جمع الأختام مؤقتًا. أختامك وهداياك محفوظة زي ما هي.',
    'The shop has paused stamps for now. Your stamps and rewards are safe.',
  ],
  MERCHANT_PAUSED: [
    'المحل مش بيستقبل أختام دلوقتي. أختامك وهداياك محفوظة.',
    'The shop is not taking stamps right now. Your stamps and rewards are safe.',
  ],
  PROGRAM_INACTIVE: [
    'الكارت ده مش بياخد أختام جديدة دلوقتي. أختامك محفوظة.',
    'This card is not taking new stamps now. Your stamps are safe.',
  ],
  NOT_FOUND: [
    'مش لاقيين الكارت ده. افتحه تاني من كود المحل.',
    'We could not find this card. Open it again from the shop code.',
  ],
  FORBIDDEN: [
    'الخطوة دي مش متاحة من كارتك. اسأل الكاشير.',
    'This is not available from your card. Ask the cashier.',
  ],
  UNAUTHENTICATED: [
    'افتح كارتك تاني من كود المحل أو رابط الواتساب.',
    'Open your card again from the shop code or your WhatsApp link.',
  ],
  ENTITLEMENTS_NOT_CONFIGURED: [
    'المحل لسه بيجهّز الكروت. جرّب بعد شوية.',
    'The shop is still setting up cards. Try again soon.',
  ],
  SUBSCRIPTION_GRACE: ['جرّب تاني بعد شوية.', 'Try again in a little while.'],
  PLAN_LIMIT_REACHED: ['جرّب تاني بعد شوية.', 'Try again in a little while.'],
  BRANCH_LOCKED: [
    'الفرع ده مش بيستقبل أختام دلوقتي. أختامك محفوظة.',
    'This branch is not taking stamps right now. Your stamps are safe.',
  ],
  FEATURE_NOT_IN_PLAN: ['الخطوة دي مش متاحة دلوقتي.', 'This is not available right now.'],
};

const LIMIT_WORDS: Record<string, [ar: string, en: string]> = {
  max_branches: ['الفروع', 'branch'],
  max_staff: ['الموظفين', 'staff'],
  max_active_programs: ['البرامج', 'program'],
};
const ADDON_WORDS: Record<string, [string, string]> = {
  extra_branch: ['فرع زيادة', 'an extra branch'],
  extra_staff: ['موظف زيادة', 'an extra staff seat'],
};
const FEATURE_WORDS: Record<string, [string, string]> = {
  customer_segments: ['تقسيم الزباين', 'Customer segments'],
  data_export_csv: ['تصدير بيانات الزباين', 'Customer export'],
  custom_card_template: ['الكارت بتصميم خاص', 'A custom card design'],
};
const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  growth: 'Growth',
  pro: 'Pro',
  scale: 'Scale',
  enterprise: 'Enterprise',
};
const money = (n: number) => Math.round(n).toLocaleString('en-US');

/** "وصلت لحد باقتك" built from the server's real numbers and options. */
export function planLimitText(details: ErrorDetails, lang: Lang): string {
  const ar = lang === 'ar';
  const words = LIMIT_WORDS[details.entitlement || ''];
  const used = details.used ?? 0,
    limit = details.limit ?? 0;
  const head =
    details.entitlement === 'manual_messages_per_month'
      ? ar
        ? `خلصت رسايل الشهر ده (${used} من ${limit}). الرسايل بتتجدد أول الشهر الجاي.`
        : `This month’s messages are used up (${used} of ${limit}). They renew on the 1st.`
      : words
        ? ar
          ? `وصلت لحد باقتك في ${words[0]} (${used} من ${limit}).`
          : `You reached your plan’s ${words[1]} limit (${used} of ${limit}).`
        : ar
          ? 'وصلت لحد باقتك.'
          : 'You reached your plan limit.';
  const ways: string[] = [];
  for (const o of details.options || []) {
    const price = o.price === undefined ? '' : money(o.price);
    if (o.type === 'addon' && o.key && ADDON_WORDS[o.key])
      ways.push(
        ar
          ? `تضيف ${ADDON_WORDS[o.key]![0]}${price ? ` بـ ${price} جنيه في الشهر` : ''}`
          : `add ${ADDON_WORDS[o.key]![1]}${price ? ` for ${price} EGP/month` : ''}`,
      );
    else if (o.type === 'upgrade' && o.plan)
      ways.push(
        ar
          ? `تطلّع ${PLAN_NAMES[o.plan] || o.plan}${price ? ` بـ ${price}` : ''}`
          : `move to ${PLAN_NAMES[o.plan] || o.plan}${price ? ` for ${price} EGP` : ''}`,
      );
    else if (o.type === 'contact')
      ways.push(ar ? 'تكلّمنا على باقة Enterprise' : 'talk to us about Enterprise');
  }
  if (!ways.length) return head;
  return (
    head + ' ' + (ar ? 'تقدر ' + ways.join('، أو ') + '.' : 'You can ' + ways.join(', or ') + '.')
  );
}

export function featureText(details: ErrorDetails, lang: Lang): string {
  const ar = lang === 'ar';
  const name = FEATURE_WORDS[details.entitlement || '']?.[ar ? 0 : 1];
  const up = (details.options || []).find((o) => o.type === 'upgrade' && o.plan);
  const planName = up?.plan ? PLAN_NAMES[up.plan] || up.plan : null;
  if (ar)
    return (
      (name ? `${name} مش ضمن باقتك.` : 'الخاصية دي مش ضمن باقتك.') +
      (planName
        ? ` متاحة من باقة ${planName}${up?.price !== undefined ? ` بـ ${money(up.price)}` : ''}.`
        : '')
    );
  return (
    (name ? `${name} is not in your plan.` : 'This feature is not in your plan.') +
    (planName
      ? ` It comes with ${planName}${up?.price !== undefined ? ` for ${money(up.price)} EGP` : ''}.`
      : '')
  );
}

/** A short reference only for problems we cannot explain, so support can find them. */
export function shortReference(requestId?: string) {
  return requestId ? requestId.replace(/-/g, '').slice(0, 8).toUpperCase() : '';
}

export function messageFor(
  code: string,
  lang: Lang,
  audience: Audience,
  details?: ErrorDetails,
  requestId?: string,
): string {
  const i = lang === 'ar' ? 0 : 1;
  if (audience === 'customer' && customerMessages[code]) return customerMessages[code]![i];
  if (code === 'PLAN_LIMIT_REACHED') return planLimitText(details || {}, lang);
  if (code === 'FEATURE_NOT_IN_PLAN') return featureText(details || {}, lang);
  const known = messages[code];
  if (known) {
    if (code === 'INTERNAL_ERROR' && requestId)
      return (
        known[i] + (lang === 'ar' ? ' رقم المشكلة: ' : ' Reference: ') + shortReference(requestId)
      );
    return known[i];
  }
  const fallback = messages.REQUEST_FAILED![i];
  return requestId
    ? fallback + (lang === 'ar' ? ' رقم المشكلة: ' : ' Reference: ') + shortReference(requestId)
    : fallback;
}

/** Every code the web knows a sentence for (used by tests). */
export const knownErrorCodes = new Set([
  ...Object.keys(messages),
  'PLAN_LIMIT_REACHED',
  'FEATURE_NOT_IN_PLAN',
]);
