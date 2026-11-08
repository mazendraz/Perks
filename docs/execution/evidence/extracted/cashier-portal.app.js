
const T = {
  ar: { home: 'الرئيسية', otherLang: 'EN', lock: 'قفل', disabledTitle: 'حسابك موقوف', disabledBody: 'مينفعش تسجل أختام أو استبدال من الحساب ده. كلّم مدير الفرع يرجّع الوصول أو يدخل بحسابه.', lockedTitle: 'الوردية مقفولة', pinDemo: 'نسخة عرض: الرقم السري', unlock: 'افتح الوردية', pinWrong: 'الرقم السري غلط', scan: 'امسح كارت', scanSub: 'QR من موبايل العميل', cantOpen: 'العميل مش قادر يفتح الكارت', queue: 'طلبات الفرع', viewAll: 'عرض الكل', noQueue: 'مفيش طلبات مستنية دلوقتي.', corrections: 'طلبات التصحيح', recent: 'آخر العمليات', fix: 'تصحيح', demoTools: 'أدوات العرض التجريبي', camDeniedTitle: 'الكاميرا مقفولة', camDeniedBody: 'المتصفح رفض إذن الكاميرا. افتح إعدادات الموقع واسمح بالكاميرا، أو اكتب الكود اللي تحت الـQR في موبايل العميل.', viewfinder: 'منطقة المسح', simCam: 'محاكاة كاميرا — التوصيل الحقيقي في المرحلة الجاية', simRead: 'محاكاة قراءة:', manual: 'اكتب كود الكارت', read: 'قراءة', lookupSub: 'دوّر ببريد العميل أو رقمه. البيانات بتظهر مخفية جزئيًا.', lookupPh: 'البريد أو الموبايل', lookupNone: 'مفيش عميل مطابق في التاجر ده.', manualId: 'اتعرّف يدويًا — اتأكد من العميل قبل أي استبدال.', addStamp: 'إضافة ختم', receipt: 'رقم الإيصال', qty: 'الكمية', review: 'مراجعة', confirmTitle: 'راجع قبل التأكيد', customer: 'العميل', branch: 'الفرع', balance: 'الرصيد', attempt: 'مرجع المحاولة', confirm: 'تأكيد الختم', edit: 'تعديل', retrySame: 'حاول تاني بنفس المرجع', startOver: 'ابدأ من الأول', nextCustomer: 'عميل جديد', resendDemo: 'محاكاة: ابعت نفس الطلب تاني', matchAsk: 'اسأل العميل عن رقم المطابقة', reject: 'رفض', approve: 'اعتماد', pickReward: 'اختار مكافأة', startRedeem: 'ابدأ الاستبدال', holderCode: 'الرقم ده لازم يظهر على موبايل العميل', simHolder: 'محاكاة: العميل أكد من موبايله', completeRedeem: 'تأكيد الاستبدال', cancelRedeem: 'إلغاء الاستبدال', reqCorrection: 'طلب تصحيح', reason: 'السبب (مطلوب)', corrSent: 'اتبعت الطلب. محتاج اعتماد مدير قبل ما الرصيد يتغير.', mgrPin: 'PIN المدير', mgrApprove: 'اعتماد', mgrHint: 'نسخة عرض: PIN المالك كريم 1111. أو اعتمده من لوحة التاجر.', sendCorrection: 'ابعت للمدير', rejectWhy: 'سبب الرفض', rejectImpact: 'العميل هيشوف السبب على موبايله، ومفيش أختام هتتضاف.', launcher: 'فتح Demo Launcher', demoNote: 'جرّب: إيصال مستخدم R-4100 · كمية أكبر من حد الموظف · «الرد ضاع» ثم تأكيد · بدّل لعمر (موقوف) أو مي (فرع تاني).', receiptReq: 'اكتب رقم الإيصال عشان نربط الختم بعملية شراء.' },
  en: { home: 'Home', otherLang: 'ع', lock: 'Lock', disabledTitle: 'Your account is disabled', disabledBody: 'This account can’t record stamps or redemptions. Ask your branch manager to restore access or sign in with their account.', lockedTitle: 'Shift locked', pinDemo: 'Demo build: PIN is', unlock: 'Unlock shift', pinWrong: 'Wrong PIN', scan: 'Scan card', scanSub: 'QR on the customer’s phone', cantOpen: 'Customer can’t open their card', queue: 'Branch requests', viewAll: 'View all', noQueue: 'No pending requests right now.', corrections: 'Correction requests', recent: 'Recent activity', fix: 'Fix', demoTools: 'Demo tools', camDeniedTitle: 'Camera blocked', camDeniedBody: 'The browser denied camera access. Allow the camera in site settings, or type the code shown under the customer’s QR.', viewfinder: 'Scan area', simCam: 'Simulated camera — real camera connects next phase', simRead: 'Simulate a read:', manual: 'Type card code', read: 'Read', lookupSub: 'Search by the customer’s email or phone. Results are partially masked.', lookupPh: 'Email or phone', lookupNone: 'No matching customer for this merchant.', manualId: 'Identified manually — verify the customer before any redemption.', addStamp: 'Add stamp', receipt: 'Receipt number', qty: 'Quantity', review: 'Review', confirmTitle: 'Review before confirming', customer: 'Customer', branch: 'Branch', balance: 'Balance', attempt: 'Attempt ref', confirm: 'Confirm stamp', edit: 'Edit', retrySame: 'Retry with the same ref', startOver: 'Start over', nextCustomer: 'Next customer', resendDemo: 'Demo: send the same request again', matchAsk: 'Ask the customer for their match code', reject: 'Reject', approve: 'Approve', pickReward: 'Choose a reward', startRedeem: 'Start redemption', holderCode: 'This number must appear on the customer’s phone', simHolder: 'Demo: customer confirmed on phone', completeRedeem: 'Confirm redemption', cancelRedeem: 'Cancel redemption', reqCorrection: 'Request a correction', reason: 'Reason (required)', corrSent: 'Sent. A manager must approve before the balance changes.', mgrPin: 'Manager PIN', mgrApprove: 'Approve', mgrHint: 'Demo build: owner Karim’s PIN is 1111. Or approve from the merchant dashboard.', sendCorrection: 'Send to manager', rejectWhy: 'Reason for rejecting', rejectImpact: 'The customer sees this reason on their phone. No stamps will be added.', launcher: 'Open Demo Launcher', demoNote: 'Try: used receipt R-4100 · quantity above staff limit · “Response lost” then confirm · switch to Omar (disabled) or Mai (other branch).', receiptReq: 'Enter the receipt number to link the stamp to a purchase.' }
};
const ERR = (a, code, x) => ({
  invalid: [a ? 'الكود مش كارت ولاء' : 'Not a loyalty card', a ? 'الكود ده مش تبع المنصة. اطلب من العميل يفتح الكارت ويعرض «اعرض الكود».' : 'This code isn’t from the platform. Ask the customer to open their card and tap “Show my code”.'],
  expired: [a ? 'الكود منتهي' : 'Code expired', a ? 'الكود بيتجدد كل دقيقة ونص. اطلب من العميل يضغط «جدّد الكود» وامسح تاني.' : 'Codes refresh every 90 seconds. Ask the customer to tap “Refresh code” and scan again.'],
  other_merchant: [a ? 'كارت لتاجر تاني' : 'Card from another merchant', (a ? 'الكارت ده تبع ' : 'This card belongs to ') + (x.other || '') + (a ? '. اطلب من العميل يفتح كارت التاجر ده أو يسجل من QR الفرع.' : '. Ask the customer to open this merchant’s card or join from the branch QR.')],
  branch_unauthorized: [a ? 'فرع غير مصرح' : 'Branch not authorized', a ? 'حسابك مش مضاف للفرع ده، فالعملية متسجلتش. اطلب من المدير يضيفك أو يسجلها بنفسه.' : 'Your account isn’t assigned to this branch, so nothing was recorded. Ask a manager to add you or record it themselves.'],
  staff_disabled: [a ? 'الحساب موقوف' : 'Account disabled', a ? 'العملية متسجلتش. الحساب ده اتوقف.' : 'Nothing was recorded. This account is disabled.'],
  qty_over_limit: [a ? 'الكمية فوق الحد' : 'Quantity above limit', (a ? 'أقصى كمية مسموحة لك في العملية الواحدة ' : 'The maximum you can add per transaction is ') + (x.limit || '') + '.'],
  receipt_used: [a ? 'الإيصال مستخدم' : 'Receipt already used', a ? 'رقم الإيصال ده اتسجل عليه ختم قبل كده. لو العميل اشترى تاني، استخدم رقم الإيصال الجديد.' : 'This receipt already earned a stamp. If the customer bought again, use the new receipt number.'],
  receipt_required: [a ? 'الإيصال مطلوب' : 'Receipt required', ''],
  offline: [a ? 'مفيش اتصال' : 'No connection', a ? 'العملية متبعتتش. لما الاتصال يرجع حاول تاني بنفس المرجع ومش هيتكرر الختم.' : 'The request didn’t go through. Retry with the same ref once you’re back online — it won’t double-stamp.'],
  reward_expired: [a ? 'المكافأة منتهية' : 'Reward expired', a ? 'المكافأة دي عدت ميعادها ومينفعش تتستبدل.' : 'This reward is past its expiry and can’t be redeemed.'],
  reward_redeemed: [a ? 'اتستبدلت قبل كده' : 'Already redeemed', a ? 'المكافأة دي اتستبدلت قبل كده.' : 'This reward has already been redeemed.'],
  request_expired: [a ? 'الطلب انتهى' : 'Request expired', a ? 'عدّى وقت الطلب. اطلب من العميل يبعت طلب جديد أو امسح كارته.' : 'The request timed out. Ask the customer to send a new one or scan their card.'],
  request_approved: [a ? 'اتعتمد قبل كده' : 'Already approved', a ? 'زميل تاني اعتمد الطلب ده.' : 'A colleague already approved this request.'],
  request_rejected: [a ? 'اترفض قبل كده' : 'Already rejected', ''],
  request_cancelled: [a ? 'العميل لغى الطلب' : 'Customer cancelled', ''],
  holder_not_confirmed: [a ? 'مستني تأكيد العميل' : 'Waiting for cardholder', ''],
  merchant_suspended: [a ? 'البرنامج موقوف' : 'Program suspended', ''],
  program_inactive: [a ? 'البرنامج مش نشط' : 'Program not active', a ? 'البرنامج ده انتهى أو لسه مسودة.' : 'This program has ended or is still a draft.']
}[code] || [code, '']);
class Component extends DCLogic {
  state = { screen: 'home', msid: null, manualId: false, receipt: '', qty: 1, attemptId: null, result: null, err: null, lastAction: null, reqId: null, rewardId: null, manual: '', lookupQ: '', pin: '', pinErr: '', demoOpen: false, rejectOpen: false, corr: null, toast: '', checking: false };
  componentDidMount() {
    const go = () => { this.un = NQ.subscribe(() => this.forceUpdate()); const q = new URLSearchParams(location.search); const p = {}; if (q.get('staff')) p.staffId = q.get('staff'); if (q.get('branch')) p.branchId = q.get('branch'); if (Object.keys(p).length) NQ.setCashier(p); this.forceUpdate(); };
    if (window.NQ) go(); else window.addEventListener('nq-ready', go, { once: true });
    this.iv = setInterval(() => this.forceUpdate(), 1000);
  }
  componentWillUnmount() { this.un && this.un(); clearInterval(this.iv); }
  flash(m) { this.setState({ toast: m }); clearTimeout(this._t); this._t = setTimeout(() => this.setState({ toast: '' }), 2800); }
  go(screen, extra) { this.setState({ screen, ...(extra || {}) }); window.scrollTo(0, 0); }
  async run(fn, kind) {
    const a = NQ.state.session.lang === 'ar';
    this.go('pending', { checking: false, lastAction: kind });
    try {
      const r = await fn();
      if (r.ok) this.go(kind === 'redeem' ? 'receipt' : 'receipt', { result: { ...r, kind } });
      else this.go('error', { err: { code: r.code, limit: r.limit, other: r.merchantId ? NQ.L(NQ.merchant(r.merchantId).name) : '' } });
    } catch (e) {
      if (e.code === 'lost') {
        this.setState({ checking: true });
        const r = await NQ.checkAttempt(this.state.attemptId).catch(() => ({ ok: false, code: 'offline' }));
        if (r.ok) this.go('receipt', { result: { ...r, kind }, checking: false }); else this.go('error', { err: { code: r.code }, checking: false });
      } else this.go('error', { err: { code: 'offline', retry: true } });
    }
  }
  renderVals() {
    const NQ = window.NQ, st = this.state;
    if (!NQ) return { t: T.ar, dir: 'rtl', lang: 'ar', s: { home: true }, brand: {}, mem: {}, rev: {}, err: {}, rc: {}, rqd: {}, rdm: {}, formErr: {} };
    const S = NQ.state, lang = S.session.lang, a = lang === 'ar', t = T[lang], L = o => NQ.L(o, lang);
    const cs = S.session.cashier; const staff = NQ.staffById(cs.staffId); const branch = NQ.branch(cs.branchId); const merchant = NQ.merchant(branch.merchantId); const brand = merchant.colors;
    const offline = S.session.network === 'offline';
    let screen = st.screen;
    if (staff.status !== 'active') screen = 'blocked'; else if (cs.locked) screen = 'locked';
    const s = { [screen]: true };
    const roleName = { owner: a ? 'مالك' : 'Owner', manager: a ? 'مدير' : 'Manager', cashier: a ? 'كاشير' : 'Cashier' };
    const ms = st.msid ? NQ.membership(st.msid) : null; const cust = ms ? NQ.customer(ms.customerId) : null; const prog = ms ? NQ.program(ms.programId) : null;
    const staffLimit = staff.role === 'owner' ? (prog ? prog.maxPerTx : 3) : staff.maxQty || 99;
    const progMax = prog ? prog.maxPerTx : 3;
    const req = st.reqId ? NQ.state.requests.find(r => r.id === st.reqId) : null;
    const reqMs = req ? NQ.membership(req.membershipId) : null; const reqProg = reqMs ? NQ.program(reqMs.programId) : null;
    const effProg = prog || reqProg; const effMax = effProg ? effProg.maxPerTx : 3; const effLimit = Math.min(effMax, staff.role === 'owner' ? effMax : staff.maxQty || 99);
    const pill = on => ({ bg: on ? '#16181D' : '#fff', fg: on ? '#fff' : '#16181D', border: on ? '#16181D' : '#D9D7D0', on });
    const chipC = k => ({ pending: ['#FDF1DC', '#7A4300'], approved: ['#E6F4EC', '#1E6B43'], rejected: ['#FCE9E7', '#A12A20'], expired: ['#F1F0EC', '#5A606C'], cancelled: ['#F1F0EC', '#5A606C'], available: ['#E6F4EC', '#1E6B43'], redeemed: ['#E8EEFC', '#244BB5'] }[k] || ['#F1F0EC', '#5A606C']);
    const stLbl = { pending: a ? 'مستني' : 'Pending', approved: a ? 'اتعتمد' : 'Approved', rejected: a ? 'اترفض' : 'Rejected', expired: a ? 'منتهي' : 'Expired', cancelled: a ? 'اتلغى' : 'Cancelled', available: a ? 'متاحة' : 'Available', redeemed: a ? 'اتستبدلت' : 'Redeemed' };
    const ago = ts => NQ.fmtRel(ts, lang);
    const left = r => { const sec = Math.max(0, Math.round((r.expiresAt - Date.now()) / 1000)); return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0'); };
    const v = {
      t, lang, dir: a ? 'rtl' : 'ltr', s, brand, backArrow: a ? '→' : '←', toast: st.toast,
      mName: L(merchant.name), bName: L(branch.name), staffName: L(staff.name), staffRole: roleName[staff.role] || staff.role,
      canBack: screen !== 'home' && screen !== 'blocked' && screen !== 'locked',
      goHome: () => { if (st.rewardId && screen === 'redeemWait') NQ.cancelRedemption(st.rewardId); this.go('home', { msid: null, reqId: null, rewardId: null, receipt: '', qty: 1, err: null, manualId: false }); },
      toggleLang: () => NQ.setLang(a ? 'en' : 'ar'),
      lock: () => NQ.setCashier({ locked: true }),
      netBanner: offline ? (a ? 'مفيش اتصال — العمليات مش هتتبعت لحد ما يرجع.' : 'Offline — operations won’t be sent until you reconnect.') : '',
      pin: st.pin, pinErr: st.pinErr, pinBorder: st.pinErr ? '#B42318' : '#D9D7D0', onPin: e => this.setState({ pin: e.target.value.replace(/\D/g, '').slice(0, 4), pinErr: '' }),
      stop: e => e.stopPropagation()
    };
    const unlock = () => { if (st.pin === '0000' || st.pin === staff.pin) { NQ.setCashier({ locked: false }); this.setState({ pin: '' }); } else this.setState({ pinErr: t.pinWrong }); };
    v.unlock = unlock; v.pinKey = e => { if (e.key === 'Enter') unlock(); };
    // home
    const allReq = NQ.requestsOf(merchant.id, branch.id);
    const pend = allReq.filter(r => r.status === 'pending');
    v.pendingCount = pend.length; v.qBadgeBg = pend.length ? '#FDF1DC' : '#F1F0EC'; v.qBadgeFg = pend.length ? '#7A4300' : '#5A606C';
    const reqRow = r => { const c = NQ.customer(r.customerId); const c2 = chipC(r.status); const sec = (r.expiresAt - Date.now()) / 1000; return { code: r.matchCode, alias: L(c.alias), age: (a ? 'اتبعت ' : 'Sent ') + ago(r.createdAt), left: r.status === 'pending' ? left(r) : '', leftColor: sec < 120 ? '#B42318' : '#6B7180', chip: stLbl[r.status], chipBg: c2[0], chipFg: c2[1], opacity: r.status === 'pending' ? 1 : .6, open: () => this.go('reqDetail', { reqId: r.id, receipt: '', qty: 1, formErr: {} }) }; };
    v.queuePreview = pend.slice(0, 3).map(reqRow); v.noQueue = !pend.length;
    v.queueAll = allReq.slice(0, 12).map(reqRow); v.noQueueAll = !allReq.length;
    v.branchWarn = staff.role !== 'owner' && !staff.branches.includes(branch.id) ? (a ? `حسابك (${L(staff.name)}) مش مضاف لفرع ${L(branch.name)}. أي عملية هترجع «فرع غير مصرح».` : `Your account (${L(staff.name)}) isn’t assigned to ${L(branch.name)}. Any operation will return “branch not authorized”.`) : '';
    v.recent = NQ.txOfMerchant(merchant.id).filter(x => x.branchId === branch.id).slice(0, 6).map(x => ({ id: x.id, alias: L(NQ.customer(x.customerId).alias), type: x.type === 'stamp' ? (a ? 'ختم' : 'Stamp') : x.type === 'redeem' ? (a ? 'استبدال' : 'Redeem') : (a ? 'تصحيح' : 'Correction'), time: NQ.fmtTime(x.at, lang) + ' · ' + NQ.fmtDate(x.at, lang).replace(/\s?\d{4}$/, ''), delta: x.type === 'redeem' ? '★' : (x.qty > 0 ? '+' : '') + x.qty, color: x.type === 'redeem' ? brand.primary : x.qty < 0 ? '#B42318' : '#1E7F4F', correct: () => this.setState({ corr: { txId: x.id, delta: 1, reason: '', err: '', submitted: null, pin: '' } }) }));
    v.myCorrections = S.corrections.filter(c => c.merchantId === merchant.id && c.requestedBy === staff.id).slice(0, 3).map(c => { const cc = chipC(c.status); return { text: `${L(NQ.customer(c.customerId).alias)} · ${c.delta > 0 ? '+' : ''}${c.delta} · ${L(c.reason)}`, status: stLbl[c.status], bg: cc[0], fg: cc[1] }; });
    v.openScanner = () => this.go('scanner', { manual: '' }); v.openQueue = () => this.go('queue'); v.openLookup = () => this.go('lookup', { lookupQ: '' });
    v.toggleDemo = () => this.setState({ demoOpen: !st.demoOpen }); v.demoOpen = st.demoOpen;
    // scanner
    v.camDenied = S.session.camera === 'denied'; v.camOk = !v.camDenied;
    const scanTok = tok => { const r = NQ.resolveScan(tok, merchant.id); if (r.ok) this.go('member', { msid: r.membership.id, manualId: false }); else this.go('error', { err: { code: r.code, other: r.merchantId ? L(NQ.merchant(r.merchantId).name) : '' } }); };
    const members = NQ.membersOf(merchant.id);
    const m1 = members.find(m => m.customerId === 'c1') || members[0]; const m2 = members.find(m => m.customerId === 'c2') || members[1];
    const foreign = S.memberships.find(m => m.merchantId !== merchant.id && S.merchants.find(x => x.id === m.merchantId).status !== 'suspended');
    v.scanOpts = [
      m1 && { label: L(NQ.customer(m1.customerId).alias), hint: (a ? 'كارت صالح · ' : 'Valid · ') + m1.balance + '/' + NQ.program(m1.programId).threshold, go: () => scanTok(NQ.issueQr(m1.id).token) },
      m2 && { label: L(NQ.customer(m2.customerId).alias), hint: a ? 'كارت جديد' : 'New card', go: () => scanTok(NQ.issueQr(m2.id).token) },
      m1 && { label: a ? 'QR منتهي' : 'Expired QR', hint: a ? 'لقطة شاشة قديمة' : 'Old screenshot', go: () => scanTok('NQ.' + m1.id + '.' + (Date.now() - 60000)) },
      foreign && { label: a ? 'كارت تاجر تاني' : 'Other merchant’s card', hint: L(NQ.merchant(foreign.merchantId).name), go: () => scanTok('NQ.' + foreign.id + '.' + (Date.now() + 60000)) },
      { label: a ? 'كود غير صالح' : 'Invalid code', hint: a ? 'QR مش تبعنا' : 'Foreign QR', go: () => scanTok('https://example.com/menu') }
    ].filter(Boolean);
    v.manual = st.manual; v.onManual = e => this.setState({ manual: e.target.value });
    v.manualSubmit = e => { e.preventDefault(); const q = st.manual.trim(); const m = members.find(x => x.qr && x.qr.token.endsWith(q) && q.length >= 4); scanTok(m ? m.qr.token : q); };
    // lookup
    v.lookupQ = st.lookupQ; v.onLookup = e => this.setState({ lookupQ: e.target.value });
    const lq = st.lookupQ.trim().toLowerCase();
    v.lookupRes = lq.length >= 3 ? NQ.customersOf(merchant.id, { q: lq }).slice(0, 5).map(r => ({ alias: L(r.c.alias), email: NQ.maskEmail(r.c.email), pick: () => this.go('member', { msid: r.m.id, manualId: true }) })) : [];
    v.lookupEmpty = lq.length >= 3 && !v.lookupRes.length;
    // member
    if (ms) {
      const rws = NQ.rewardsOfMembership(ms.id); const av = rws.filter(r => r.status === 'available');
      v.mem = { alias: L(cust.alias), program: L(prog.name), last: ms.lastActivity ? (a ? 'آخر نشاط ' : 'Last active ') + ago(ms.lastActivity) : (a ? 'لسه مفيش نشاط' : 'No activity yet'), dots: Array.from({ length: prog.threshold }, (_, i) => i < ms.balance ? brand.primary : '#E4E3DE'), balanceText: a ? `${ms.balance} من ${prog.threshold} — فاضل ${prog.threshold - ms.balance}` : `${ms.balance} of ${prog.threshold} — ${prog.threshold - ms.balance} to go`, rewardsText: av.length ? (a ? `${av.length} مكافأة متاحة: ${L(av[0].title)}` : `${av.length} reward(s) ready: ${L(av[0].title)}`) : '', manual: st.manualId };
      v.redeemLabel = (a ? 'استبدال مكافأة' : 'Redeem a reward') + (av.length ? ` (${av.length})` : '');
      v.goStamp = () => this.go('stamp', { receipt: '', qty: 1, formErr: {} });
      v.goRedeem = () => this.go('redeemPick', { rewardId: null });
      v.rewardOpts = rws.slice().sort((x, y) => (x.status === 'available' ? -1 : 1) - (y.status === 'available' ? -1 : 1)).map(r => { const c = chipC(r.status); const on = st.rewardId === r.id; return { title: L(r.title), chip: stLbl[r.status], chipBg: c[0], chipFg: c[1], meta: r.status === 'available' ? (a ? 'صالحة لحد ' : 'Valid until ') + NQ.fmtDate(r.expiresAt, lang) : r.status === 'expired' ? (a ? 'انتهت ' : 'Expired ') + NQ.fmtDate(r.expiresAt, lang) : (a ? 'اتستبدلت ' : 'Redeemed ') + NQ.fmtDate(r.redeemedAt, lang), border: on ? brand.primary : '#E4E3DE', opacity: r.status === 'available' ? 1 : .6, pick: () => r.status === 'available' ? this.setState({ rewardId: r.id }) : this.go('error', { err: { code: 'reward_' + r.status } }) }; });
    } else v.mem = {};
    v.pickedReward = st.rewardId && screen === 'redeemPick' ? { terms: (a ? 'بعد ما تبدأ، العميل لازم يأكد من موبايله إنه صاحب الكارت. ' : 'Once started, the customer must confirm on their phone that they hold the card. ') + L((NQ.program(NQ.reward(st.rewardId).programId) || {}).redeemTerms) } : null;
    v.startRedeem = async () => { try { const r = await NQ.startRedemption(st.rewardId, staff.id, branch.id); if (r.ok) this.go('redeemWait'); else this.go('error', { err: { code: r.code } }); } catch (e) { this.go('error', { err: { code: 'offline' } }); } };
    // stamp form
    v.receipt = st.receipt; v.qty = st.qty; v.formErr = st.formErr || {};
    v.receiptInvalid = !!(st.formErr || {}).receipt; v.receiptBorder = v.receiptInvalid ? '#B42318' : '#D9D7D0';
    v.onReceipt = e => this.setState({ receipt: e.target.value.toUpperCase(), formErr: {} });
    v.qtyDown = () => this.setState({ qty: Math.max(1, st.qty - 1) });
    v.qtyUp = () => this.setState({ qty: Math.min(effMax, st.qty + 1) });
    const over = st.qty > effLimit;
    v.qtyHint = over ? (a ? `فوق حدك (${effLimit}). قلل الكمية أو اطلب من المدير.` : `Above your limit (${effLimit}). Reduce or ask a manager.`) : (a ? `الحد الأقصى لك ${effLimit} في العملية · ختم واحد = زيارة واحدة` : `Your max is ${effLimit} per transaction · one transaction = one visit`);
    v.qtyHintColor = over ? '#B42318' : '#6B7180';
    v.goReview = () => { if (!st.receipt.trim()) return this.setState({ formErr: { receipt: t.receiptReq } }); if (over) return; this.go('review', { attemptId: 'AT-' + NQ.code(6) }); };
    if (ms && prog) { const nb = ms.balance + st.qty; v.rev = { alias: L(cust.alias), qty: st.qty, receipt: st.receipt, balance: `${ms.balance} ${a ? '←' : '→'} ${nb >= prog.threshold ? nb - prog.threshold : nb}`, unlock: nb >= prog.threshold ? (a ? `هتتفتح مكافأة: ${L(prog.reward)}` : `Unlocks a reward: ${L(prog.reward)}`) : '' }; } else v.rev = {};
    v.attemptId = st.attemptId;
    const doStamp = () => this.run(() => NQ.addStamps({ merchantId: merchant.id, branchId: branch.id, staffId: staff.id, membershipId: st.msid, qty: st.qty, receipt: st.receipt, attemptId: st.attemptId, source: 'scan' }), 'stamp');
    v.confirmStamp = doStamp; v.editStamp = () => this.go(st.reqId ? 'reqDetail' : 'stamp');
    v.pendingTitle = st.checking ? (a ? 'بنتأكد من نتيجة العملية' : 'Confirming the result') : (a ? 'بنسجل العملية…' : 'Recording…');
    v.pendingBody = st.checking ? (a ? 'الرد اتأخر. بنسأل السيرفر بنفس مرجع المحاولة — متضغطش تاني ومتسجلش من جديد.' : 'The reply was delayed. We’re checking with the same attempt ref — don’t resubmit.') : (a ? 'متقفلش الصفحة.' : 'Keep this screen open.');
    // error
    if (st.err) { const e = ERR(a, st.err.code, st.err); v.err = { title: e[0], body: e[1], ref: ['offline'].includes(st.err.code) ? st.attemptId : '', retry: st.err.code === 'offline', fix: ['qty_over_limit', 'receipt_used', 'receipt_required'].includes(st.err.code) }; } else v.err = {};
    v.retry = () => st.lastAction === 'approve' ? v.approve() : doStamp();
    v.newCustomer = () => this.go('scanner', { msid: null, reqId: null, rewardId: null, receipt: '', qty: 1, err: null, result: null, manual: '', manualId: false });
    // receipt
    const r = st.result;
    if (r && r.kind !== 'redeem' && r.kind !== 'reject') {
      const m = NQ.membership(r.tx.membershipId), p = NQ.program(m.programId);
      v.rc = { icon: r.replay ? '=' : '✓', iconBg: r.replay ? '#FDF1DC' : '#E6F4EC', iconFg: r.replay ? '#7A4300' : '#1E7F4F', title: r.replay ? (a ? 'طلب مكرر' : 'Duplicate request') : (a ? `+${r.tx.qty} ختم` : `+${r.tx.qty} stamp${r.tx.qty > 1 ? 's' : ''}`), sub: `${L(NQ.customer(m.customerId).alias)} · ${a ? 'الرصيد' : 'Balance'} ${m.balance}/${p.threshold}`,
        note: r.replay ? (a ? 'العملية دي اتسجلت قبل كده بنفس المرجع. مفيش ختم إضافي.' : 'This was already recorded with the same ref. No extra stamp added.') : r.recovered ? (a ? 'اتأكدنا: العملية اتسجلت مرة واحدة بس.' : 'Confirmed: recorded exactly once.') : r.tx.walletSync === 'failed' ? (a ? 'تحديث Apple Wallet اتأخر — الكارت على الويب محدث. فريق المنصة متابع.' : 'Apple Wallet update delayed — the web card is current. Platform team notified.') : '',
        noteBg: r.replay || r.recovered ? '#FDF1DC' : '#F1F0EC', noteFg: r.replay || r.recovered ? '#7A4300' : '#2D313A',
        reward: (r.rewards || []).length ? (a ? `اتفتحت مكافأة: ${L(p.reward)}` : `Reward unlocked: ${L(p.reward)}`) : '',
        rows: [{ k: a ? 'العملية' : 'Transaction', v: r.tx.id }, { k: a ? 'الإيصال' : 'Receipt', v: r.tx.receipt }, { k: a ? 'المرجع' : 'Ref', v: r.tx.attemptId }, { k: a ? 'الوقت' : 'Time', v: NQ.fmtTime(r.tx.at, lang) }], canRetry: !r.replay };
    } else if (r && r.kind === 'redeem') {
      v.rc = { icon: '★', iconBg: brand.surface, iconFg: brand.primary, title: a ? 'اتستبدلت' : 'Redeemed', sub: L(r.reward.title) + ' · ' + L(NQ.customer(r.reward.customerId).alias), note: a ? 'قدّم المكافأة للعميل.' : 'Hand the reward to the customer.', noteBg: '#E6F4EC', noteFg: '#1E6B43', reward: '', rows: [{ k: a ? 'العملية' : 'Transaction', v: r.tx.id }, { k: a ? 'المكافأة' : 'Reward', v: r.reward.id }, { k: a ? 'الوقت' : 'Time', v: NQ.fmtTime(r.tx.at, lang) }], canRetry: false };
    } else if (r && r.kind === 'reject') {
      v.rc = { icon: '×', iconBg: '#FCE9E7', iconFg: '#B42318', title: a ? 'اترفض الطلب' : 'Request rejected', sub: r.reason, note: a ? 'العميل شاف السبب على موبايله.' : 'The customer sees the reason on their phone.', noteBg: '#F1F0EC', noteFg: '#2D313A', reward: '', rows: [{ k: a ? 'الطلب' : 'Request', v: r.id }], canRetry: false };
    } else v.rc = { rows: [] };
    // request detail
    if (req) {
      const c = NQ.customer(req.customerId); const cc = chipC(req.status);
      v.rqd = { code: req.matchCode, codeColor: req.status === 'pending' ? '#16181D' : '#9AA0AC', alias: L(c.alias), meta: `${a ? 'الرصيد' : 'Balance'} ${reqMs.balance}/${reqProg.threshold} · ${a ? 'اتبعت' : 'sent'} ${ago(req.createdAt)}`, left: req.status === 'pending' ? (a ? 'باقي ' : 'Expires in ') + left(req) : stLbl[req.status], leftColor: req.status === 'pending' ? ((req.expiresAt - Date.now()) < 120000 ? '#B42318' : '#5A606C') : '#5A606C', pending: req.status === 'pending', closed: req.status !== 'pending', chipBg: cc[0], chipFg: cc[1], closedText: req.status === 'expired' ? ERR(a, 'request_expired')[1] : req.status === 'approved' ? (a ? `اتعتمد ${ago(req.decidedAt)} — ${req.txId}` : `Approved ${ago(req.decidedAt)} — ${req.txId}`) : req.status === 'rejected' ? (a ? 'اترفض: ' : 'Rejected: ') + (req.reason || '') : stLbl[req.status] };
      v.approve = () => { if (!st.receipt.trim()) return this.setState({ formErr: { receipt: t.receiptReq } }); if (st.qty > effLimit) return; const att = st.attemptId && st.lastAction === 'approve' && screen === 'error' ? st.attemptId : 'AT-' + NQ.code(6); this.setState({ attemptId: att }); this.state.attemptId = att; this.run(() => NQ.approveRequest(req.id, { staffId: staff.id, qty: st.qty, receipt: st.receipt, attemptId: att }), 'approve'); };
      v.openReject = () => this.setState({ rejectOpen: true });
      v.rejectReasons = (a ? ['مفيش إيصال مطابق', 'العميل مش موجود عند الكاشير', 'طلب مكرر', 'ختم اتسجل بالفعل بمسح الكارت'] : ['No matching receipt', 'Customer isn’t at the counter', 'Duplicate request', 'Already stamped by scanning']).map(x => ({ label: x, go: async () => { this.setState({ rejectOpen: false }); try { const rr = await NQ.rejectRequest(req.id, x, staff.id); if (rr.ok) this.go('receipt', { result: { kind: 'reject', reason: x, id: req.id } }); else this.go('error', { err: { code: rr.code } }); } catch (e) { this.go('error', { err: { code: 'offline' } }); } } }));
    } else { v.rqd = {}; v.rejectReasons = []; }
    v.rejectOpen = st.rejectOpen; v.closeReject = () => this.setState({ rejectOpen: false });
    // redeem wait
    if (st.rewardId && screen === 'redeemWait') {
      const rw = NQ.reward(st.rewardId); const rd = rw.redemption || {};
      const ready = rd.status === 'holder_confirmed';
      v.rdm = { code: rd.code, title: L(rw.title) + ' · ' + L(NQ.customer(rw.customerId).alias), status: rd.status === 'holder_declined' ? (a ? 'العميل رفض — متكملش الاستبدال' : 'Customer declined — do not complete') : ready ? (a ? 'العميل أكد ✓' : 'Customer confirmed ✓') : (a ? 'مستني تأكيد حامل الكارت…' : 'Waiting for the cardholder…'), stBg: rd.status === 'holder_declined' ? '#FCE9E7' : ready ? '#E6F4EC' : '#FDF1DC', stFg: rd.status === 'holder_declined' ? '#A12A20' : ready ? '#1E6B43' : '#7A4300', awaiting: rd.status === 'awaiting_holder', notReady: !ready, btnBg: ready ? brand.primary : '#B9B7B0' };
    } else v.rdm = {};
    v.simHolder = () => NQ.holderConfirm(st.rewardId);
    v.completeRedeem = () => this.run(() => NQ.completeRedemption(st.rewardId), 'redeem');
    v.cancelRedeem = () => { NQ.cancelRedemption(st.rewardId); this.go('member', { rewardId: null }); this.flash(a ? 'اتلغى الاستبدال. المكافأة لسه متاحة.' : 'Redemption cancelled. The reward is still available.'); };
    // correction sheet
    if (st.corr) {
      const c = st.corr; const tx = NQ.tx(c.txId); const set = p => this.setState({ corr: { ...st.corr, ...p } });
      const sub = c.submitted && S.corrections.find(x => x.id === c.submitted);
      v.corr = { desc: `${tx.id} · ${L(NQ.customer(tx.customerId).alias)} · ${tx.type === 'stamp' ? '+' + tx.qty : tx.type}`, reason: c.reason, err: c.err, pin: c.pin, submitted: !!c.submitted, canSubmit: !c.submitted,
        deltas: [-1, 1, 2].map(d => ({ label: (d > 0 ? '+' : '') + d, on: c.delta === d, border: c.delta === d ? brand.primary : '#E4E3DE', pick: () => set({ delta: d }) })),
        onReason: e => set({ reason: e.target.value, err: '' }), onPin: e => set({ pin: e.target.value.replace(/\D/g, '').slice(0, 4) }),
        submit: async () => { if (c.reason.trim().length < 4) return set({ err: a ? 'اكتب سبب واضح للتصحيح.' : 'Give a clear reason for the correction.' }); const rr = await NQ.requestCorrection({ txId: tx.id, merchantId: merchant.id, customerId: tx.customerId, membershipId: tx.membershipId, requestedBy: staff.id, delta: c.delta, reason: NQ.bi(c.reason, c.reason) }); set({ submitted: rr.correction.id }); },
        approve: () => { const mgr = NQ.staffOf(merchant.id).find(x => x.pin && x.pin === c.pin && ['owner', 'manager'].includes(x.role)); if (!mgr) return set({ err: t.pinWrong }); NQ.decideCorrection(c.submitted, true, mgr.id); this.setState({ corr: null }); this.flash(a ? 'اتعتمد التصحيح واتحدث رصيد العميل.' : 'Correction approved; balance updated.'); } };
      if (sub && sub.status !== 'pending') { setTimeout(() => this.setState({ corr: null }), 0); }
    } else v.corr = null;
    v.closeCorr = () => this.setState({ corr: null });
    // demo tools
    const staffOpts = NQ.staffOf(merchant.id).filter(x => x.status !== 'invited');
    v.demoGroups = [
      { label: a ? 'الموظف على الجهاز' : 'Staff on device', opts: staffOpts.map(x => ({ label: L(x.name) + (x.status === 'disabled' ? (a ? ' (موقوف)' : ' (disabled)') : ''), ...pill(x.id === staff.id), go: () => { NQ.setCashier({ staffId: x.id, locked: false }); this.go('home'); } })) },
      { label: a ? 'الفرع' : 'Branch', opts: NQ.branchesOf(merchant.id).map(b => ({ label: L(b.name), ...pill(b.id === branch.id), go: () => NQ.setCashier({ branchId: b.id }) })) },
      { label: a ? 'تاجر الجهاز' : 'Device merchant', opts: ['b_zam', 'b_helio'].map(bid => { const m = NQ.merchant(NQ.branch(bid).merchantId); const sid = bid === 'b_zam' ? 's_youssef' : 's_laila'; return { label: L(m.name), ...pill(m.id === merchant.id), go: () => { NQ.setCashier({ branchId: bid, staffId: sid }); this.go('home'); } }; }) },
      { label: a ? 'الشبكة' : 'Network', opts: ['ok', 'offline', 'lost'].map(k => ({ label: { ok: a ? 'طبيعي' : 'Normal', offline: a ? 'مفيش اتصال' : 'Offline', lost: a ? 'الرد ضاع' : 'Response lost' }[k], ...pill(S.session.network === k), go: () => NQ.setSession({ network: k }) })) },
      { label: a ? 'الكاميرا' : 'Camera', opts: ['granted', 'denied'].map(k => ({ label: k === 'granted' ? (a ? 'مسموح' : 'Allowed') : (a ? 'مرفوض' : 'Denied'), ...pill(S.session.camera === k), go: () => NQ.setSession({ camera: k }) })) }
    ];
    return v;
  }
}
