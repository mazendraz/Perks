
const T = {
  ar: { demo: 'نسخة عرض', reset: 'إعادة ضبط بيانات التجربة', title: 'افتح أي تجربة في المنصة', sub: 'كل الواجهات بتقرأ وتكتب من نفس البيانات التجريبية. افتح الكاشير في تاب والعميل في تاب تاني عشان تشوف الختم والطلبات بتنعكس فورًا.', journeys: 'رحلات مقترحة للعرض', sim: 'محاكاة الظروف', network: 'الشبكة (تأثيرها على عمليات الكاشير والعميل)', camera: 'إذن الكاميرا', simNote: '«الرد ضاع» بيسجّل العملية فعلًا لكن الواجهة متستلمش الرد، عشان نجرب حالة «بنتأكد من نتيجة العملية». بيرجع طبيعي بعد محاولة واحدة.', ds: 'نظام التصميم', handoff: 'تقرير التسليم', resetQ: 'نرجّع بيانات التجربة لأولها؟', resetImpact: 'كل الأختام والطلبات والتجار والمسودات اللي اتعملت هتتمسح وترجع البيانات الأصلية. ده بيأثر على كل الواجهات المفتوحة.', cancel: 'إلغاء', done: 'رجعت البيانات لأولها', ok: 'طبيعي', offline: 'مفيش اتصال', lost: 'الرد ضاع بعد النجاح', granted: 'مسموح', denied: 'مرفوض' },
  en: { demo: 'Demo build', reset: 'Reset demo data', title: 'Open any experience on the platform', sub: 'All four interfaces read and write the same demo data. Open the cashier in one tab and the customer in another to see stamps and requests sync live.', journeys: 'Suggested demo journeys', sim: 'Simulated conditions', network: 'Network (affects cashier and customer actions)', camera: 'Camera permission', simNote: '“Response lost” commits the operation but drops the reply, so you can see the “Confirming the result” state. It reverts to normal after one attempt.', ds: 'Design system', handoff: 'Delivery report', resetQ: 'Reset demo data to its original state?', resetImpact: 'All stamps, requests, merchants and drafts created during the demo will be erased and the seed data restored. This affects every open interface.', cancel: 'Cancel', done: 'Demo data restored', ok: 'Normal', offline: 'Offline', lost: 'Response lost after success', granted: 'Allowed', denied: 'Denied' }
};
const APPS = l => {
  const a = l === 'ar';
  return [
    { k: 'admin', color: '#2B55CF', title: a ? 'إدارة المنصة' : 'Platform Super Admin', desc: a ? 'التجار والتجهيز والتشغيل والدعم والفوترة والتكاملات.' : 'Merchants, provisioning, operations, support, billing, integrations.', entries: [
      { label: a ? 'هالة — مدير المنصة' : 'Hala — Platform admin', hint: a ? 'نظرة عامة' : 'Overview', url: 'Nuqta%20-%20Super%20Admin.html' },
      { label: a ? 'إنشاء تاجر جديد' : 'Provision a merchant', hint: a ? 'Wizard + مسودة محفوظة' : 'Wizard + saved draft', url: 'Nuqta%20-%20Super%20Admin.html?view=provisioning' },
      { label: a ? 'عملية فشل فيها الـWallet' : 'Transaction with failed wallet job', hint: 'Operations → JOB-9001', url: 'Nuqta%20-%20Super%20Admin.html?view=operations' } ] },
    { k: 'merchant', color: '#6F3F22', title: a ? 'لوحة التاجر' : 'Merchant Dashboard', desc: a ? 'العملاء والبرامج والفروع والفريق والتسويق والهوية والمواد.' : 'Customers, programs, branches, team, marketing, brand & materials.', entries: [
      { label: a ? 'كريم — مالك بن وحكاية' : 'Karim — Bunn & Hekaya owner', hint: a ? 'كافيه، فرعين' : 'Café, 2 branches', url: 'Nuqta%20-%20Merchant%20Dashboard.html?m=m_cafe' },
      { label: a ? 'نادية — مالكة صالون لمسة' : 'Nadia — Lamsa Salon owner', hint: a ? 'تجربة مجانية، هوية مختلفة' : 'Trial, different identity', url: 'Nuqta%20-%20Merchant%20Dashboard.html?m=m_salon' },
      { label: a ? 'مركز المواد QR/NFC' : 'QR/NFC material center', hint: a ? 'بن وحكاية' : 'Bunn & Hekaya', url: 'Nuqta%20-%20Merchant%20Dashboard.html?m=m_cafe&view=brand' } ] },
    { k: 'cashier', color: '#1F7A4D', title: a ? 'بورتال الكاشير' : 'Cashier Portal', desc: a ? 'مسح الكارت، طلبات الختم، الاستبدال. واجهة موبايل سريعة.' : 'Scan cards, approve requests, redeem. Fast mobile UI.', entries: [
      { label: a ? 'يوسف — فرع الزمالك' : 'Youssef — Zamalek', hint: a ? 'حد أقصى 3 أختام' : 'Max 3 stamps', url: 'Nuqta%20-%20Cashier%20Portal.html?staff=s_youssef&branch=b_zam' },
      { label: a ? 'مي على جهاز الزمالك' : 'Mai on the Zamalek device', hint: a ? 'فرع غير مصرح' : 'Unauthorized branch', url: 'Nuqta%20-%20Cashier%20Portal.html?staff=s_mai&branch=b_zam' },
      { label: a ? 'عمر — حساب موقوف' : 'Omar — disabled account', hint: a ? 'موظف موقوف' : 'Disabled staff', url: 'Nuqta%20-%20Cashier%20Portal.html?staff=s_omar&branch=b_zam' } ] },
    { k: 'customer', color: '#5E2750', title: a ? 'بورتال العميل' : 'Customer Portal', desc: a ? 'تسجيل من QR أو NFC، الكارت، المكافآت، طلب ختم.' : 'Join via QR or NFC, card, rewards, stamp requests.', entries: [
      { label: a ? 'سارة — كروتي' : 'Sara — my cards', hint: a ? 'عضوة عند تاجرين، رصيد 4/5' : 'Member of 2 merchants, 4/5', url: 'Nuqta%20-%20Customer%20Portal.html?c=c1' },
      { label: a ? 'عميل جديد عبر QR الكافيه' : 'New customer via café QR', hint: a ? 'كود OTP التجريبي 123456' : 'Demo OTP 123456', url: 'Nuqta%20-%20Customer%20Portal.html?m=m_cafe&src=qr&b=b_zam&new=1' },
      { label: a ? 'تاجر موقوف' : 'Suspended merchant', hint: a ? 'فرن الحارة' : 'Hara Bakery', url: 'Nuqta%20-%20Customer%20Portal.html?m=m_bakery&src=nfc&new=1' } ] }
  ];
};
const JOURNEYS = l => l === 'ar' ? [
  { title: 'ختم من البداية للنهاية', steps: 'كاشير يوسف ← امسح كارت ← سارة ← إيصال جديد ← تأكيد. سارة توصل 5/5 وتتفتح مكافأة، وتقرير التاجر يتحدث.' },
  { title: 'العميل يطلب ختم', steps: 'سارة ← كارت بن وحكاية ← اطلب ختم ← الزمالك. الكاشير يشوف الطلب بكود المطابقة ويعتمده.' },
  { title: 'استبدال مكافأة', steps: 'الكاشير ← سارة ← استبدال ← مستني تأكيد حامل الكارت. من تاب العميل اضغط «أيوه، أنا» ثم أكمل من الكاشير.' },
  { title: 'إنشاء تاجر', steps: 'إدارة المنصة ← التجهيز ← كمّل مسودة «مخبز ورد» أو ابدأ جديد ← تفعيل ← أعد محاولة Google Wallet.' },
  { title: 'تغيير الهوية', steps: 'لوحة التاجر ← الهوية والمواد ← غيّر اللون ← افتح كارت العميل والستاند.' }
] : [
  { title: 'Stamp end to end', steps: 'Cashier Youssef → Scan card → Sara → new receipt → confirm. Sara reaches 5/5, a reward unlocks, merchant reports update.' },
  { title: 'Customer requests a stamp', steps: 'Sara → Bunn & Hekaya card → Request stamp → Zamalek. The cashier sees it with a match code and approves.' },
  { title: 'Redeem a reward', steps: 'Cashier → Sara → Redeem → waiting for cardholder. In the customer tab tap “Yes, it’s me”, then complete on the cashier.' },
  { title: 'Provision a merchant', steps: 'Super Admin → Provisioning → resume “Ward Bakery” draft or start fresh → Activate → retry Google Wallet.' },
  { title: 'Change identity', steps: 'Merchant → Brand & materials → change color → open the customer card and QR stand.' }
];
class Component extends DCLogic {
  state = { confirmReset: false, toast: '' };
  componentDidMount() { const go = () => { this.un = NQ.subscribe(() => this.forceUpdate()); this.forceUpdate(); }; if (window.NQ) go(); else window.addEventListener('nq-ready', go, { once: true }); }
  componentWillUnmount() { this.un && this.un(); }
  flash(m) { this.setState({ toast: m }); clearTimeout(this._t); this._t = setTimeout(() => this.setState({ toast: '' }), 2600); }
  renderVals() {
    const NQ = window.NQ; const lang = NQ ? NQ.state.session.lang : 'ar'; const t = T[lang];
    const s = NQ ? NQ.state.session : {};
    const pill = (on) => ({ bg: on ? '#16181D' : '#fff', fg: on ? '#fff' : '#16181D', border: on ? '#16181D' : '#D9D7D0', on });
    return {
      t, lang, dir: lang === 'ar' ? 'rtl' : 'ltr', arrow: lang === 'ar' ? '←' : '→',
      platform: NQ ? NQ.L(NQ.CONFIG.platformName) : '',
      isAr: lang === 'ar', isEn: lang === 'en',
      arBg: lang === 'ar' ? '#fff' : 'transparent', enBg: lang === 'en' ? '#fff' : 'transparent',
      arShadow: lang === 'ar' ? '0 1px 2px rgba(0,0,0,.08)' : 'none', enShadow: lang === 'en' ? '0 1px 2px rgba(0,0,0,.08)' : 'none',
      setAr: () => NQ.setLang('ar'), setEn: () => NQ.setLang('en'),
      apps: APPS(lang).map(a => ({ ...a, entries: a.entries.map(e => ({ ...e, go: () => { location.href = e.url; } })) })),
      journeys: JOURNEYS(lang),
      netOpts: ['ok', 'offline', 'lost'].map(k => ({ label: t[k], ...pill(s.network === k), go: () => NQ.setSession({ network: k }) })),
      camOpts: ['granted', 'denied'].map(k => ({ label: t[k], ...pill(s.camera === k), go: () => NQ.setSession({ camera: k }) })),
      confirmReset: this.state.confirmReset, toast: this.state.toast,
      askReset: () => this.setState({ confirmReset: true }), cancelReset: () => this.setState({ confirmReset: false }), stop: e => e.stopPropagation(),
      doReset: () => { NQ.reset(); this.setState({ confirmReset: false }); this.flash(t.done); }
    };
  }
}
