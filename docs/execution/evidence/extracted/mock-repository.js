/* Nuqta demo — Mock Repository + Services.
   Every UI reads/writes through window.NQ. Swap these functions for real API calls later. */
(function () {
  'use strict';
  const CONFIG = { platformName: { ar: 'نقطة', en: 'Nuqta' }, currency: { ar: 'ج.م', en: 'EGP' }, storageKey: 'nuqta-demo-v2', otpDemo: '123456' };
  const D = 864e5, MIN = 6e4, H = 36e5;
  let state = null; const subs = new Set();
  const rnd = n => Math.floor(Math.random() * n);
  const code = n => Array.from({ length: n }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[rnd(32)]).join('');
  const digits = n => Array.from({ length: n }, () => rnd(10)).join('');
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const bi = (ar, en) => ({ ar, en });

  function seed() {
    const t = Date.now();
    const merchants = [
      { id: 'm_cafe', name: bi('بن وحكاية', 'Bunn & Hekaya'), category: 'cafe', initials: bi('ب', 'B'), colors: { primary: '#6F3F22', accent: '#E2A85B', surface: '#FBF5EE' }, template: 'classic', status: 'active', plan: 'growth', renewsAt: t + 18 * D, createdAt: t - 210 * D, lastActivity: t - 40 * MIN, contact: { name: 'كريم عزت', email: 'karim@bunn.example', phone: '+20 100 555 0142' }, city: bi('القاهرة', 'Cairo'), wallet: { apple: 'action_required', google: 'ready' }, channels: { email: 'ready', sms: 'testing', whatsapp: 'pending' }, offer: bi('اجمع 5 أختام واشرب السادس علينا', 'Collect 5 stamps, your next drink is on us'), terms: bi('ختم واحد لكل مشروب. المكافأة صالحة 30 يوم من فتحها. لا تُستبدل نقدًا.', 'One stamp per drink. Rewards are valid 30 days after unlocking. No cash value.'), tasks: [] },
      { id: 'm_salon', name: bi('صالون لمسة', 'Lamsa Salon'), category: 'salon', initials: bi('ل', 'L'), colors: { primary: '#5E2750', accent: '#E7A9C8', surface: '#FBF4F8' }, template: 'minimal', status: 'trial', plan: 'starter', trialEndsAt: t + 9 * D, createdAt: t - 21 * D, lastActivity: t - 3 * H, contact: { name: 'نادية فوزي', email: 'nadia@lamsa.example', phone: '+20 122 555 0199' }, city: bi('القاهرة', 'Cairo'), wallet: { apple: 'pending', google: 'pending' }, channels: { email: 'ready', sms: 'disabled', whatsapp: 'disabled' }, offer: bi('كل 6 زيارات، السشوار السابع هدية', 'Every 6 visits, your 7th blow-dry is a gift'), terms: bi('زيارة واحدة تُحتسب في اليوم. المكافأة صالحة 45 يوم.', 'One visit counted per day. Rewards are valid for 45 days.'), tasks: [] },
      { id: 'm_bakery', name: bi('فرن الحارة', 'Hara Bakery'), category: 'bakery', initials: bi('ف', 'H'), colors: { primary: '#9A4A1F', accent: '#F0C27B', surface: '#FCF6EE' }, template: 'bold', status: 'suspended', suspendReason: bi('فشل تحصيل الاشتراك 3 مرات', 'Subscription payment failed 3 times'), plan: 'starter', createdAt: t - 300 * D, lastActivity: t - 26 * D, contact: { name: 'حسن رجب', email: 'hassan@hara.example', phone: '+20 111 555 0101' }, city: bi('الإسكندرية', 'Alexandria'), wallet: { apple: 'disabled', google: 'disabled' }, channels: { email: 'ready', sms: 'disabled', whatsapp: 'disabled' }, offer: bi('10 أختام = علبة معمول', '10 stamps = a box of maamoul'), terms: bi('', ''), tasks: [] },
      { id: 'm_gym', name: bi('نادي خطوة', 'Khatwa Fitness'), category: 'gym', initials: bi('خ', 'K'), colors: { primary: '#1F5E4A', accent: '#9FD8B8', surface: '#F2F8F5' }, template: 'classic', status: 'active', plan: 'pro', renewsAt: t + 4 * D, createdAt: t - 400 * D, lastActivity: t - 2 * H, contact: { name: 'مروان نجيب', email: 'marwan@khatwa.example', phone: '+20 109 555 0177' }, city: bi('الجيزة', 'Giza'), wallet: { apple: 'ready', google: 'ready' }, channels: { email: 'ready', sms: 'ready', whatsapp: 'ready' }, offer: bi('12 حصة = حصة خاصة مجانية', '12 classes = a free private session'), terms: bi('', ''), tasks: [] },
      { id: 'm_books', name: bi('مكتبة سطور للكتب والقرطاسية والهدايا', 'Sotour Books, Stationery & Gifts'), category: 'retail', initials: bi('س', 'S'), colors: { primary: '#23466B', accent: '#F2B84B', surface: '#F3F6FA' }, template: 'minimal', status: 'trial', plan: 'growth', trialEndsAt: t + 2 * D, createdAt: t - 12 * D, lastActivity: t - 5 * D, contact: { name: 'رنا سمير', email: 'rana@sotour.example', phone: '+20 127 555 0133' }, city: bi('المنصورة', 'Mansoura'), wallet: { apple: 'pending', google: 'testing' }, channels: { email: 'ready', sms: 'disabled', whatsapp: 'disabled' }, offer: bi('8 أختام = خصم 100 جنيه', '8 stamps = EGP 100 off'), terms: bi('', ''), tasks: [] }
    ];
    const branches = [
      { id: 'b_zam', merchantId: 'm_cafe', name: bi('الزمالك', 'Zamalek'), address: bi('26 شارع البرازيل، الزمالك', '26 Brazil St, Zamalek'), hours: '8:00–24:00', status: 'active' },
      { id: 'b_maadi', merchantId: 'm_cafe', name: bi('المعادي', 'Maadi'), address: bi('شارع 9، المعادي', 'Road 9, Maadi'), hours: '7:00–23:00', status: 'active' },
      { id: 'b_helio', merchantId: 'm_salon', name: bi('مصر الجديدة', 'Heliopolis'), address: bi('12 شارع بغداد، الكوربة', '12 Baghdad St, Korba'), hours: '11:00–22:00', status: 'active' },
      { id: 'b_hara', merchantId: 'm_bakery', name: bi('سيدي جابر', 'Sidi Gaber'), address: bi('', ''), hours: '6:00–22:00', status: 'active' },
      { id: 'b_gym1', merchantId: 'm_gym', name: bi('الشيخ زايد', 'Sheikh Zayed'), address: bi('', ''), hours: '6:00–24:00', status: 'active' },
      { id: 'b_gym2', merchantId: 'm_gym', name: bi('الدقي', 'Dokki'), address: bi('', ''), hours: '6:00–24:00', status: 'active' },
      { id: 'b_gym3', merchantId: 'm_gym', name: bi('التجمع', 'New Cairo'), address: bi('', ''), hours: '6:00–24:00', status: 'active' },
      { id: 'b_books', merchantId: 'm_books', name: bi('توريل', 'Toriel'), address: bi('', ''), hours: '10:00–23:00', status: 'active' }
    ];
    const programs = [
      { id: 'p_cafe', merchantId: 'm_cafe', name: bi('قهوتك السادسة علينا', 'Your 6th coffee is on us'), type: 'stamp', threshold: 5, maxPerTx: 3, branches: ['b_zam', 'b_maadi'], reward: bi('أي مشروب ساخن مجانًا', 'Any hot drink, free'), rewardValidityDays: 30, startsAt: t - 200 * D, endsAt: null, status: 'active', version: 2, redeemTerms: bi('مكافأة واحدة لكل زيارة. لازم تأكيد حامل الكارت.', 'One reward per visit. Cardholder confirmation required.') },
      { id: 'p_cafe_sweets', merchantId: 'm_cafe', name: bi('نادي الحلويات', 'Dessert club'), type: 'visit', threshold: 8, maxPerTx: 1, branches: ['b_maadi'], reward: bi('قطعة تشيز كيك', 'A slice of cheesecake'), rewardValidityDays: 21, startsAt: null, endsAt: null, status: 'draft', version: 1, redeemTerms: bi('', '') },
      { id: 'p_salon', merchantId: 'm_salon', name: bi('زيارات لمسة', 'Lamsa visits'), type: 'visit', threshold: 6, maxPerTx: 1, branches: ['b_helio'], reward: bi('سشوار مجاني', 'Free blow-dry'), rewardValidityDays: 45, startsAt: t - 20 * D, endsAt: null, status: 'active', version: 1, redeemTerms: bi('بالحجز المسبق.', 'By appointment.') },
      { id: 'p_salon_summer', merchantId: 'm_salon', name: bi('عرض الصيف', 'Summer offer'), type: 'stamp', threshold: 4, maxPerTx: 1, branches: ['b_helio'], reward: bi('ماسك شعر مجاني', 'Free hair mask'), rewardValidityDays: 14, startsAt: t - 120 * D, endsAt: t - 10 * D, status: 'ended', version: 1, redeemTerms: bi('', '') },
      { id: 'p_bakery', merchantId: 'm_bakery', name: bi('علبة المعمول', 'Maamoul box'), type: 'stamp', threshold: 10, maxPerTx: 2, branches: ['b_hara'], reward: bi('علبة معمول', 'Box of maamoul'), rewardValidityDays: 30, status: 'active', version: 1, redeemTerms: bi('', '') },
      { id: 'p_gym', merchantId: 'm_gym', name: bi('12 حصة', '12 classes'), type: 'visit', threshold: 12, maxPerTx: 1, branches: ['b_gym1', 'b_gym2', 'b_gym3'], reward: bi('حصة خاصة', 'Private session'), rewardValidityDays: 60, status: 'active', version: 3, redeemTerms: bi('', '') },
      { id: 'p_books', merchantId: 'm_books', name: bi('قارئ سطور', 'Sotour reader'), type: 'stamp', threshold: 8, maxPerTx: 2, branches: ['b_books'], reward: bi('خصم 100 جنيه', 'EGP 100 off'), rewardValidityDays: 30, status: 'active', version: 1, redeemTerms: bi('', '') }
    ];
    const staff = [
      { id: 's_admin', merchantId: null, name: bi('هالة منصور', 'Hala Mansour'), email: 'hala@nuqta.example', role: 'platform_admin', branches: [], maxQty: null, status: 'active' },
      { id: 's_support', merchantId: null, name: bi('زياد عمرو', 'Ziad Amr'), email: 'ziad@nuqta.example', role: 'platform_support', branches: [], maxQty: null, status: 'active' },
      { id: 's_karim', merchantId: 'm_cafe', name: bi('كريم عزت', 'Karim Ezzat'), email: 'karim@bunn.example', role: 'owner', branches: ['b_zam', 'b_maadi'], maxQty: 5, status: 'active', pin: '1111' },
      { id: 's_youssef', merchantId: 'm_cafe', name: bi('يوسف طه', 'Youssef Taha'), email: 'youssef@bunn.example', role: 'cashier', branches: ['b_zam'], maxQty: 3, status: 'active' },
      { id: 's_mai', merchantId: 'm_cafe', name: bi('مي رأفت', 'Mai Raafat'), email: 'mai@bunn.example', role: 'cashier', branches: ['b_maadi'], maxQty: 2, status: 'active' },
      { id: 's_omar', merchantId: 'm_cafe', name: bi('عمر صلاح', 'Omar Salah'), email: 'omar@bunn.example', role: 'cashier', branches: ['b_zam'], maxQty: 2, status: 'disabled' },
      { id: 's_inv1', merchantId: 'm_cafe', name: bi('دعوة معلقة', 'Pending invite'), email: 'nour@bunn.example', role: 'manager', branches: ['b_maadi'], maxQty: 3, status: 'invited', invitedAt: t - 2 * D },
      { id: 's_nadia', merchantId: 'm_salon', name: bi('نادية فوزي', 'Nadia Fawzy'), email: 'nadia@lamsa.example', role: 'owner', branches: ['b_helio'], maxQty: 2, status: 'active', pin: '2222' },
      { id: 's_laila', merchantId: 'm_salon', name: bi('ليلى جمال', 'Laila Gamal'), email: 'laila@lamsa.example', role: 'cashier', branches: ['b_helio'], maxQty: 1, status: 'active' }
    ];
    const names = [['سارة محمود', 'Sara Mahmoud'], ['أحمد علي', 'Ahmed Ali'], ['منى حسن', 'Mona Hassan'], ['يوسف كمال', 'Youssef Kamal'], ['ليلى عادل', 'Laila Adel'], ['عمر شريف', 'Omar Sherif'], ['نور الهدى إبراهيم عبد الرحمن', 'Nour El-Hoda Ibrahim Abdelrahman'], ['كريم سامي', 'Karim Samy'], ['هبة طارق', 'Heba Tarek'], ['مصطفى فؤاد', 'Mostafa Fouad'], ['دينا وليد', 'Dina Walid'], ['تامر نبيل', 'Tamer Nabil'], ['ياسمين خالد', 'Yasmin Khaled'], ['محمود رضا', 'Mahmoud Reda']];
    const lastDays = [0, null, 35, 2, 9, 16, 72, 1, 5, 100, 20, 45, 3, 61];
    const customers = names.map((n, i) => ({
      id: 'c' + (i + 1), name: bi(n[0], n[1]), alias: bi(n[0].split(' ')[0] + ' ' + n[0].split(' ')[1][0] + '.', n[1].split(' ')[0] + ' ' + n[1].split(' ')[1][0] + '.'),
      email: n[1].split(' ')[0].toLowerCase() + '.' + n[1].split(' ')[1].toLowerCase().replace(/[^a-z]/g, '') + '@example.com',
      phone: '+20 10' + (10 + i) + ' 555 0' + (100 + i * 7), createdAt: t - (lastDays[i] == null ? 1 : lastDays[i] + 20 + i * 3) * D
    }));
    const memberships = [], consents = {};
    customers.forEach((c, i) => {
      const last = lastDays[i] == null ? null : t - lastDays[i] * D - (i === 0 ? 3 * H : 0);
      memberships.push({ id: 'ms_cafe_' + c.id, customerId: c.id, merchantId: 'm_cafe', programId: 'p_cafe', balance: i === 0 ? 4 : i === 1 ? 0 : (i * 3) % 5, joinedAt: c.createdAt, lastActivity: last, source: ['qr', 'nfc', 'link'][i % 3] });
      consents[c.id + ':m_cafe'] = { terms: true, email: i % 3 !== 1, sms: i % 2 === 0, whatsapp: i % 4 === 0 };
    });
    [['c1', 2, t - 4 * D], ['c5', 3, t - 12 * D], ['c9', 1, t - 40 * D], ['c11', 5, t - 1 * D]].forEach(([cid, bal, last]) => {
      memberships.push({ id: 'ms_salon_' + cid, customerId: cid, merchantId: 'm_salon', programId: 'p_salon', balance: bal, joinedAt: t - 20 * D, lastActivity: last, source: 'qr' });
      consents[cid + ':m_salon'] = { terms: true, email: cid !== 'c9', sms: false, whatsapp: false };
    });
    memberships.push({ id: 'ms_salon_summer_c1', customerId: 'c1', merchantId: 'm_salon', programId: 'p_salon_summer', balance: 3, joinedAt: t - 90 * D, lastActivity: t - 15 * D, source: 'link' });
    memberships.push({ id: 'ms_bakery_c1', customerId: 'c1', merchantId: 'm_bakery', programId: 'p_bakery', balance: 6, joinedAt: t - 200 * D, lastActivity: t - 26 * D, source: 'nfc' });
    consents['c1:m_bakery'] = { terms: true, email: false, sms: false, whatsapp: false };
    const rewards = [
      { id: 'RW-501', membershipId: 'ms_cafe_c1', customerId: 'c1', merchantId: 'm_cafe', programId: 'p_cafe', title: bi('أي مشروب ساخن مجانًا', 'Any hot drink, free'), status: 'available', earnedAt: t - 6 * D, expiresAt: t + 24 * D, redemption: null },
      { id: 'RW-488', membershipId: 'ms_cafe_c1', customerId: 'c1', merchantId: 'm_cafe', programId: 'p_cafe', title: bi('أي مشروب ساخن مجانًا', 'Any hot drink, free'), status: 'expired', earnedAt: t - 52 * D, expiresAt: t - 22 * D, redemption: null },
      { id: 'RW-460', membershipId: 'ms_cafe_c1', customerId: 'c1', merchantId: 'm_cafe', programId: 'p_cafe', title: bi('أي مشروب ساخن مجانًا', 'Any hot drink, free'), status: 'redeemed', earnedAt: t - 80 * D, expiresAt: t - 50 * D, redeemedAt: t - 70 * D, redemption: null },
      { id: 'RW-512', membershipId: 'ms_salon_c1', customerId: 'c1', merchantId: 'm_salon', programId: 'p_salon', title: bi('سشوار مجاني', 'Free blow-dry'), status: 'available', earnedAt: t - 10 * D, expiresAt: t + 35 * D, redemption: null },
      { id: 'RW-517', membershipId: 'ms_salon_c1', customerId: 'c1', merchantId: 'm_salon', programId: 'p_salon', title: bi('سشوار مجاني', 'Free blow-dry'), status: 'available', earnedAt: t - 4 * D, expiresAt: t + 41 * D, redemption: null },
      { id: 'RW-470', membershipId: 'ms_cafe_c4', customerId: 'c4', merchantId: 'm_cafe', programId: 'p_cafe', title: bi('أي مشروب ساخن مجانًا', 'Any hot drink, free'), status: 'available', earnedAt: t - 3 * D, expiresAt: t + 27 * D, redemption: null },
      { id: 'RW-455', membershipId: 'ms_cafe_c8', customerId: 'c8', merchantId: 'm_cafe', programId: 'p_cafe', title: bi('أي مشروب ساخن مجانًا', 'Any hot drink, free'), status: 'redeemed', earnedAt: t - 12 * D, expiresAt: t + 18 * D, redeemedAt: t - 2 * D, redemption: null }
    ];
    // ledger
    let raw = [];
    customers.forEach((c, i) => {
      if (lastDays[i] == null) return;
      [0, 6, 13, 27, 41].forEach((off, k) => {
        const d = lastDays[i] + off + (i % 3);
        if (d > 95 || (k > 2 && i % 2)) return;
        const br = (i + k) % 3 === 0 ? 'b_maadi' : 'b_zam';
        raw.push({ type: 'stamp', merchantId: 'm_cafe', branchId: br, staffId: br === 'b_zam' ? 's_youssef' : 's_mai', customerId: c.id, membershipId: 'ms_cafe_' + c.id, programId: 'p_cafe', qty: (i + k) % 5 === 0 ? 2 : 1, at: t - (k === 0 ? lastDays[i] * D + (i === 0 ? 3 * H : 2 * H) : d * D + (i * 37 % 600) * MIN), visit: true, source: (i + k) % 4 === 0 ? 'request' : 'scan' });
      });
    });
    ['c1', 'c5', 'c9', 'c11'].forEach((cid, i) => [0, 9, 17].forEach((off, k) => raw.push({ type: 'stamp', merchantId: 'm_salon', branchId: 'b_helio', staffId: 's_laila', customerId: cid, membershipId: 'ms_salon_' + cid, programId: 'p_salon', qty: 1, at: t - ((i + 1) * 3 + off) * D, visit: true, source: 'scan' })));
    raw.push({ type: 'redeem', merchantId: 'm_cafe', branchId: 'b_zam', staffId: 's_youssef', customerId: 'c8', membershipId: 'ms_cafe_c8', programId: 'p_cafe', qty: 1, rewardId: 'RW-455', at: t - 2 * D, visit: false, source: 'scan' });
    raw.sort((a, b) => a.at - b.at);
    const transactions = raw.map((x, i) => Object.assign(x, { id: 'TX-' + (10000 + i), receipt: x.type === 'stamp' ? 'R-' + (4100 + i * 7) : '', status: 'completed', attemptId: 'AT-' + (70000 + i), walletSync: 'ok', message: 'none' }));
    const c1last = transactions.filter(x => x.customerId === 'c1' && x.merchantId === 'm_cafe').pop();
    c1last.walletSync = 'failed';
    const requests = [
      { id: 'SR-301', customerId: 'c1', membershipId: 'ms_cafe_c1', merchantId: 'm_cafe', branchId: 'b_zam', matchCode: '47', status: 'pending', createdAt: t - 2 * MIN, expiresAt: t + 6 * H },
      { id: 'SR-302', customerId: 'c13', membershipId: 'ms_cafe_c13', merchantId: 'm_cafe', branchId: 'b_zam', matchCode: '82', status: 'pending', createdAt: t - 6 * MIN, expiresAt: t + 6 * H },
      { id: 'SR-298', customerId: 'c4', membershipId: 'ms_cafe_c4', merchantId: 'm_cafe', branchId: 'b_zam', matchCode: '15', status: 'expired', createdAt: t - 40 * MIN, expiresAt: t - 30 * MIN }
    ];
    const jobs = [
      { id: 'JOB-9001', type: 'wallet_update', provider: 'apple', merchantId: 'm_cafe', txId: c1last.id, status: 'failed', attempts: [{ at: c1last.at + 4000, result: 'error', msg: 'Pass update push rejected — signing certificate needs renewal' }, { at: c1last.at + 64000, result: 'error', msg: 'Pass update push rejected — signing certificate needs renewal' }] },
      { id: 'JOB-9002', type: 'message', provider: 'email', merchantId: 'm_cafe', txId: c1last.id, status: 'succeeded', attempts: [{ at: c1last.at + 3000, result: 'ok', msg: '250 accepted' }] },
      { id: 'JOB-9003', type: 'wallet_class', provider: 'google', merchantId: 'm_salon', status: 'pending', attempts: [{ at: t - 2 * H, result: 'waiting', msg: 'Issuer review in progress' }] },
      { id: 'JOB-9004', type: 'invoice_charge', provider: 'payments', merchantId: 'm_bakery', status: 'failed', attempts: [{ at: t - 30 * D, result: 'error', msg: 'card_declined' }, { at: t - 27 * D, result: 'error', msg: 'card_declined' }, { at: t - 24 * D, result: 'error', msg: 'card_declined' }] }
    ];
    const tickets = [
      { id: 'T-120', merchantId: 'm_cafe', subject: bi('عميلة مش شايفة آخر ختم على Apple Wallet', 'Customer does not see the latest stamp in Apple Wallet'), status: 'open', priority: 'high', txId: c1last.id, createdAt: t - 3 * H, assignee: 's_support', messages: [{ by: 'merchant', at: t - 3 * H, text: bi('سارة بتقول الكارت في الموبايل لسه على 3 أختام.', 'Sara says the wallet card still shows 3 stamps.') }] },
      { id: 'T-118', merchantId: 'm_salon', subject: bi('محتاجين نغيّر لون الكارت', 'We need to change the card color'), status: 'pending', priority: 'normal', createdAt: t - 2 * D, assignee: null, messages: [{ by: 'merchant', at: t - 2 * D, text: bi('اللون الحالي غامق على الطباعة.', 'The current color prints too dark.') }] },
      { id: 'T-110', merchantId: 'm_bakery', subject: bi('مشكلة في تجديد الاشتراك', 'Subscription renewal problem'), status: 'closed', priority: 'normal', createdAt: t - 25 * D, assignee: 's_admin', messages: [] }
    ];
    const plans = [
      { id: 'starter', name: bi('أساسي', 'Starter'), price: 450, limits: { branches: 1, staff: 3, customers: 500, messages: 200, programs: 1 } },
      { id: 'growth', name: bi('نمو', 'Growth'), price: 950, limits: { branches: 3, staff: 10, customers: 3000, messages: 1500, programs: 3 } },
      { id: 'pro', name: bi('احترافي', 'Pro'), price: 1900, limits: { branches: 10, staff: 40, customers: null, messages: 6000, programs: 10 } }
    ];
    const invoices = [
      { id: 'INV-2611-014', merchantId: 'm_cafe', amount: 950, status: 'paid', date: t - 12 * D },
      { id: 'INV-2610-014', merchantId: 'm_cafe', amount: 950, status: 'paid', date: t - 42 * D },
      { id: 'INV-2611-021', merchantId: 'm_gym', amount: 1900, status: 'open', date: t - 1 * D },
      { id: 'INV-2610-009', merchantId: 'm_bakery', amount: 450, status: 'failed', date: t - 30 * D },
      { id: 'INV-2610-021', merchantId: 'm_gym', amount: 1900, status: 'paid', date: t - 31 * D }
    ];
    const integrations = [
      { id: 'apple_wallet', name: bi('Apple Wallet', 'Apple Wallet'), status: 'action_required', lastSuccess: t - 26 * H, lastError: t - 20 * MIN, errorMsg: 'Pass Type ID certificate expires soon', certExpiresAt: t + 12 * D, action: bi('جدّد شهادة Pass Type ID وارفعها', 'Renew and upload the Pass Type ID certificate') },
      { id: 'google_wallet', name: bi('Google Wallet', 'Google Wallet'), status: 'ready', lastSuccess: t - 8 * MIN, lastError: t - 9 * D, errorMsg: 'Rate limited (429)', certExpiresAt: null, action: null },
      { id: 'email', name: bi('مزوّد البريد', 'Email provider'), status: 'ready', lastSuccess: t - 3 * MIN, lastError: null, certExpiresAt: null, action: null },
      { id: 'sms', name: bi('مزوّد SMS', 'SMS provider'), status: 'testing', lastSuccess: t - 2 * H, lastError: t - 5 * H, errorMsg: 'Sender ID not approved for 2 merchants', certExpiresAt: null, action: bi('اعتماد Sender ID للتجار', 'Approve merchant sender IDs') },
      { id: 'whatsapp', name: bi('WhatsApp Business', 'WhatsApp Business'), status: 'pending', lastSuccess: null, lastError: null, certExpiresAt: null, action: bi('في انتظار اعتماد قوالب الرسائل', 'Waiting for template approval') },
      { id: 'payments', name: bi('بوابة الدفع', 'Payment gateway'), status: 'ready', lastSuccess: t - 1 * D, lastError: t - 24 * D, errorMsg: 'card_declined', certExpiresAt: null, action: null },
      { id: 'webhooks', name: bi('Webhooks للتاجر', 'Merchant webhooks'), status: 'disabled', lastSuccess: null, lastError: null, certExpiresAt: null, action: null }
    ];
    const materials = [
      { id: 'MAT-101', merchantId: 'm_cafe', branchId: 'b_zam', kind: 'stand', placement: bi('ستاند الكاشير', 'Counter stand'), code: 'q-zam-counter', status: 'installed', nfc: true, nfcVerified: true, verifiedBy: 's_youssef', revoked: false },
      { id: 'MAT-102', merchantId: 'm_cafe', branchId: 'b_zam', kind: 'sticker', placement: bi('استيكر الباب', 'Door sticker'), code: 'q-zam-door', status: 'installed', nfc: false, nfcVerified: false, revoked: false },
      { id: 'MAT-103', merchantId: 'm_cafe', branchId: 'b_zam', kind: 'table', placement: bi('ترابيزات الدور التاني', 'Upstairs tables'), code: 'q-zam-tables', status: 'shipped', nfc: true, nfcVerified: false, revoked: false },
      { id: 'MAT-104', merchantId: 'm_cafe', branchId: 'b_maadi', kind: 'stand', placement: bi('ستاند الكاشير', 'Counter stand'), code: 'q-maadi-counter', status: 'production', nfc: true, nfcVerified: false, revoked: false },
      { id: 'MAT-201', merchantId: 'm_salon', branchId: 'b_helio', kind: 'stand', placement: bi('الاستقبال', 'Reception'), code: 'q-helio-desk', status: 'shipped', nfc: true, nfcVerified: false, revoked: false }
    ];
    const campaigns = [
      { id: 'CMP-31', merchantId: 'm_cafe', name: bi('وحشتنا — 30 يوم', 'We miss you — 30 days'), segment: 'inactive30', channel: 'email', status: 'sent', audience: 6, reachable: 4, delivered: 4, opened: 2, returned: 1, cost: 0, at: t - 9 * D },
      { id: 'CMP-32', merchantId: 'm_cafe', name: bi('قربت توصل لمكافأتك', 'Almost at your reward'), segment: 'near_reward', channel: 'sms', status: 'scheduled', audience: 3, reachable: 2, delivered: 0, opened: 0, returned: 0, cost: 0.9, at: t + 2 * D }
    ];
    const corrections = [
      { id: 'CR-12', txId: transactions.filter(x => x.merchantId === 'm_cafe' && x.customerId === 'c3').pop().id, merchantId: 'm_cafe', customerId: 'c3', membershipId: 'ms_cafe_c3', requestedBy: 's_youssef', delta: 1, reason: bi('العميل اشترى مشروبين واتسجل واحد', 'Customer bought two drinks, only one recorded'), status: 'pending', at: t - 50 * MIN }
    ];
    const audit = [
      { id: 'AU-1', at: t - 26 * D, actor: 's_admin', action: 'merchant.suspend', merchantId: 'm_bakery', detail: bi('تعليق بسبب فشل الدفع', 'Suspended after failed payments') },
      { id: 'AU-2', at: t - 3 * D, actor: 's_karim', action: 'branding.update', merchantId: 'm_cafe', detail: bi('تحديث اللون الثانوي', 'Updated accent color') },
      { id: 'AU-3', at: t - 2 * D, actor: 's_karim', action: 'staff.invite', merchantId: 'm_cafe', detail: bi('دعوة nour@bunn.example كمدير فرع', 'Invited nour@bunn.example as manager') },
      { id: 'AU-4', at: t - 20 * MIN, actor: 'system', action: 'wallet.job_failed', merchantId: 'm_cafe', detail: bi('فشل تحديث Apple Wallet', 'Apple Wallet update failed') }
    ];
    const drafts = [
      { id: 'DR-7', updatedAt: t - 5 * H, step: 4, data: { name: 'مخبز ورد', nameEn: 'Ward Bakery', category: 'bakery', email: 'hello@ward.example', phone: '+20 100 000 2233', city: 'القاهرة', primary: '#8C2F39', accent: '#F4C095', template: 'classic', programName: '', threshold: 8, maxPerTx: 2, reward: '', branches: [{ name: 'التجمع الخامس', address: '' }], staff: [{ email: 'owner@ward.example', role: 'owner' }], qr: ['merchant', 'branch'], nfc: true, channels: { email: true, sms: false, whatsapp: false }, plan: 'starter' } }
    ];
    return {
      merchants, branches, programs, staff, customers, memberships, consents, rewards, transactions, requests, jobs, tickets, plans, invoices, integrations, materials, campaigns, corrections, audit, drafts,
      session: { lang: 'ar', network: 'ok', camera: 'granted', cashier: { staffId: 's_youssef', branchId: 'b_zam', locked: false }, customerId: 'c1', merchantId: 'm_cafe', adminId: 's_admin' },
      seededAt: t
    };
  }

  // ---------- persistence ----------
  function load() {
    try { const raw = localStorage.getItem(CONFIG.storageKey); state = raw ? JSON.parse(raw) : seed(); } catch (e) { state = seed(); }
    if (!state.session) state = seed();
    save(true);
  }
  function save(silent) { try { localStorage.setItem(CONFIG.storageKey, JSON.stringify(state)); } catch (e) {} if (!silent) emit(); }
  function emit() { subs.forEach(f => { try { f(state); } catch (e) { console.error(e); } }); }
  window.addEventListener('storage', e => { if (e.key === CONFIG.storageKey && e.newValue) { state = JSON.parse(e.newValue); emit(); } });

  // ---------- helpers ----------
  const lang = () => state.session.lang;
  const L = (o, l) => o == null ? '' : typeof o === 'string' ? o : (o[l || lang()] || o.ar || o.en || '');
  const locale = l => (l || lang()) === 'ar' ? 'ar-EG-u-nu-latn' : 'en-GB';
  const fmtNum = (n, l) => n == null ? '—' : new Intl.NumberFormat(locale(l)).format(n);
  const fmtMoney = (n, l) => fmtNum(n, l) + ' ' + L(CONFIG.currency, l);
  const fmtDate = (ts, l, withTime) => ts ? new Intl.DateTimeFormat(locale(l), withTime ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short', year: 'numeric' }).format(ts) : '—';
  const fmtTime = (ts, l) => ts ? new Intl.DateTimeFormat(locale(l), { hour: '2-digit', minute: '2-digit' }).format(ts) : '—';
  function fmtRel(ts, l) {
    if (!ts) return '—';
    const rtf = new Intl.RelativeTimeFormat((l || lang()) === 'ar' ? 'ar-EG-u-nu-latn' : 'en', { numeric: 'auto' });
    const s = (ts - Date.now()) / 1000, a = Math.abs(s);
    if (a < 60) return rtf.format(Math.round(s), 'second');
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    return rtf.format(Math.round(s / 86400), 'day');
  }
  const maskEmail = e => e ? e.replace(/^(.)(.*)(@.*)$/, (m, a, b, c) => a + '•••' + c) : '';
  const maskPhone = p => p ? p.slice(0, 6) + ' ••• ' + p.slice(-3) : '';
  const byId = (k, id) => state[k].find(x => x.id === id);
  const daysSince = ts => ts ? Math.floor((Date.now() - ts) / D) : null;
  function auditLog(actor, action, merchantId, detail) { state.audit.unshift({ id: 'AU-' + code(5), at: Date.now(), actor, action, merchantId, detail }); }
  function tick() {
    const t = Date.now(); let ch = false;
    state.requests.forEach(r => { if (r.status === 'pending' && r.expiresAt < t) { r.status = 'expired'; ch = true; } });
    state.rewards.forEach(r => { if (r.status === 'available' && r.expiresAt < t) { r.status = 'expired'; ch = true; } });
    if (ch) save();
  }
  const fail = (code, extra) => Object.assign({ ok: false, code }, extra || {});
  async function net(ms) {
    await delay(ms || 650);
    if (state.session.network === 'offline') { const e = new Error('offline'); e.code = 'offline'; throw e; }
  }
  const nextTxId = () => 'TX-' + (10000 + state.transactions.length + rnd(3) + 1 + Math.floor((Date.now() % 1000) / 10) * 0) ;

  // ---------- queries ----------
  const Q = {
    merchant: id => byId('merchants', id), branch: id => byId('branches', id), program: id => byId('programs', id), staffById: id => byId('staff', id), customer: id => byId('customers', id), membership: id => byId('memberships', id), reward: id => byId('rewards', id), tx: id => byId('transactions', id), plan: id => byId('plans', id),
    branchesOf: mid => state.branches.filter(b => b.merchantId === mid),
    programsOf: mid => state.programs.filter(p => p.merchantId === mid),
    staffOf: mid => state.staff.filter(s => s.merchantId === mid),
    membersOf: mid => state.memberships.filter(m => m.merchantId === mid),
    membershipsOfCustomer: cid => state.memberships.filter(m => m.customerId === cid),
    rewardsOfMembership: msid => state.rewards.filter(r => r.membershipId === msid),
    txOfMerchant: mid => state.transactions.filter(x => x.merchantId === mid).sort((a, b) => b.at - a.at),
    txOfMembership: msid => state.transactions.filter(x => x.membershipId === msid).sort((a, b) => b.at - a.at),
    consent: (cid, mid) => state.consents[cid + ':' + mid] || { terms: false, email: false, sms: false, whatsapp: false },
    requestsOf: (mid, bid) => state.requests.filter(r => r.merchantId === mid && (!bid || r.branchId === bid)).sort((a, b) => b.createdAt - a.createdAt),
    metrics(mid, opts) {
      const o = Object.assign({ days: 30, branchId: 'all' }, opts || {}), t = Date.now(), from = t - o.days * D;
      const mem = state.memberships.filter(m => m.merchantId === mid);
      const txs = state.transactions.filter(x => x.merchantId === mid && x.status === 'completed' && (o.branchId === 'all' || x.branchId === o.branchId));
      const inR = txs.filter(x => x.at >= from);
      const stampTx = inR.filter(x => x.type === 'stamp');
      const rw = state.rewards.filter(r => r.merchantId === mid);
      const branches = Q.branchesOf(mid).map(b => { const bt = stampTx.filter(x => x.branchId === b.id); return { id: b.id, name: b.name, visits: bt.filter(x => x.visit).length, stamps: bt.reduce((s, x) => s + x.qty, 0), redeems: inR.filter(x => x.type === 'redeem' && x.branchId === b.id).length }; });
      const trend = [];
      for (let w = 7; w >= 0; w--) {
        const ws = t - (w + 1) * 7 * D, we = t - w * 7 * D;
        const inWeek = txs.filter(x => x.type === 'stamp' && x.visit && x.at >= ws && x.at < we);
        const ids = [...new Set(inWeek.map(x => x.customerId))];
        const returning = ids.filter(id => txs.some(x => x.customerId === id && x.type === 'stamp' && x.at < ws)).length;
        trend.push({ w, visits: inWeek.length, returning, unique: ids.length, start: ws });
      }
      return {
        registered: mem.length,
        active: mem.filter(m => m.lastActivity && t - m.lastActivity <= 30 * D).length,
        inactive: mem.filter(m => m.lastActivity && t - m.lastActivity > 30 * D).length,
        noActivity: mem.filter(m => !m.lastActivity).length,
        newSignups: mem.filter(m => m.joinedAt >= from).length,
        visits: stampTx.filter(x => x.visit).length,
        stamps: stampTx.reduce((s, x) => s + x.qty, 0),
        rewardsOpen: rw.filter(r => r.status === 'available').length,
        rewardsRedeemed: inR.filter(x => x.type === 'redeem').length,
        branches, trend, updatedAt: t
      };
    },
    platformMetrics() {
      const m = state.merchants;
      return {
        active: m.filter(x => x.status === 'active').length, trial: m.filter(x => x.status === 'trial').length, suspended: m.filter(x => x.status === 'suspended').length,
        branches: state.branches.length, staff: state.staff.filter(s => s.merchantId).length,
        customers: state.customers.length, memberships: state.memberships.length,
        stamps30: state.transactions.filter(x => x.type === 'stamp' && x.at > Date.now() - 30 * D).reduce((s, x) => s + x.qty, 0),
        redeems30: state.transactions.filter(x => x.type === 'redeem' && x.at > Date.now() - 30 * D).length,
        mrr: m.filter(x => x.status === 'active').reduce((s, x) => s + (byId('plans', x.plan) || { price: 0 }).price, 0),
        failedJobs: state.jobs.filter(j => j.status === 'failed').length,
        integrationIssues: state.integrations.filter(i => i.status === 'action_required').length
      };
    },
    customersOf(mid, opts) {
      const o = opts || {}; const q = (o.q || '').trim().toLowerCase();
      return Q.membersOf(mid).map(m => { const c = byId('customers', m.customerId); return { m, c, idle: daysSince(m.lastActivity) }; })
        .filter(r => !q || (L(r.c.name, 'ar') + ' ' + L(r.c.name, 'en') + ' ' + r.c.email + ' ' + r.c.phone).toLowerCase().includes(q))
        .filter(r => !o.idle || (o.idle === 'none' ? r.idle == null : r.idle != null && r.idle >= o.idle))
        .sort((a, b) => (b.m.lastActivity || 0) - (a.m.lastActivity || 0));
    },
    audience(mid, segment, channel) {
      const rows = Q.customersOf(mid).filter(r => {
        if (segment === 'all') return true;
        if (segment === 'near_reward') { const p = byId('programs', r.m.programId); return p && p.threshold - r.m.balance <= 1; }
        if (segment === 'has_reward') return state.rewards.some(x => x.membershipId === r.m.id && x.status === 'available');
        if (segment === 'new') return r.m.joinedAt > Date.now() - 14 * D;
        const n = +String(segment).replace('inactive', ''); return r.idle != null && r.idle >= n;
      });
      return { total: rows.length, reachable: rows.filter(r => Q.consent(r.c.id, mid)[channel]).length };
    },
    resolveScan(token, merchantId) {
      if (!token || !/^NQ\./.test(token)) return fail('invalid');
      const [, msid, exp] = token.split('.');
      const m = byId('memberships', msid); if (!m) return fail('invalid');
      if (+exp < Date.now()) return fail('expired');
      if (m.merchantId !== merchantId) return fail('other_merchant', { merchantId: m.merchantId });
      return { ok: true, membership: m };
    },
    findTx(q) { q = (q || '').trim().toUpperCase(); return state.transactions.find(x => x.id === q || x.receipt.toUpperCase() === q || x.attemptId === q); }
  };

  // ---------- commands ----------
  const C = {
    setLang(l) { state.session.lang = l; document.documentElement.lang = l; document.documentElement.dir = l === 'ar' ? 'rtl' : 'ltr'; save(); },
    setSession(patch) { Object.assign(state.session, patch); save(); },
    setCashier(patch) { Object.assign(state.session.cashier, patch); save(); },
    reset() { state = seed(); save(); },
    issueQr(msid) { const m = byId('memberships', msid); m.qr = { token: 'NQ.' + msid + '.' + (Date.now() + 90000), issuedAt: Date.now(), expiresAt: Date.now() + 90000 }; save(); return m.qr; },

    async addStamps(p) {
      await net(700);
      const dup = state.transactions.find(x => x.attemptId === p.attemptId);
      if (dup) return { ok: true, tx: dup, replay: true, balance: byId('memberships', dup.membershipId).balance, rewards: [] };
      const s = byId('staff', p.staffId); if (!s || s.status !== 'active') return fail('staff_disabled');
      if (s.role !== 'owner' && !s.branches.includes(p.branchId)) return fail('branch_unauthorized');
      const m = byId('memberships', p.membershipId); if (!m || m.merchantId !== p.merchantId) return fail('other_merchant');
      const merchant = byId('merchants', p.merchantId); if (merchant.status === 'suspended') return fail('merchant_suspended');
      const prog = byId('programs', m.programId); if (!prog || prog.status !== 'active') return fail('program_inactive');
      const limit = Math.min(prog.maxPerTx, s.maxQty || 99);
      if (!(p.qty >= 1 && p.qty <= limit)) return fail('qty_over_limit', { limit });
      const rec = (p.receipt || '').trim();
      if (!rec) return fail('receipt_required');
      if (state.transactions.some(x => x.merchantId === p.merchantId && x.type === 'stamp' && x.receipt.toLowerCase() === rec.toLowerCase())) return fail('receipt_used');
      let bal = m.balance + p.qty; const created = [];
      while (bal >= prog.threshold) {
        bal -= prog.threshold;
        const r = { id: 'RW-' + (520 + state.rewards.length), membershipId: m.id, customerId: m.customerId, merchantId: m.merchantId, programId: prog.id, title: prog.reward, status: 'available', earnedAt: Date.now(), expiresAt: Date.now() + prog.rewardValidityDays * D, redemption: null };
        state.rewards.push(r); created.push(r);
      }
      m.balance = bal; m.lastActivity = Date.now();
      const tx = { id: 'TX-' + (10000 + state.transactions.length), type: 'stamp', merchantId: p.merchantId, branchId: p.branchId, staffId: p.staffId, customerId: m.customerId, membershipId: m.id, programId: prog.id, qty: p.qty, receipt: rec, status: 'completed', attemptId: p.attemptId, at: Date.now(), visit: true, source: p.source || 'scan', requestId: p.requestId || null, walletSync: merchant.wallet.google === 'ready' ? 'ok' : 'pending', message: created.length ? 'queued' : 'none', rewardsCreated: created.map(r => r.id) };
      state.transactions.push(tx);
      if (merchant.wallet.apple === 'action_required') { state.jobs.unshift({ id: 'JOB-' + (9005 + state.jobs.length), type: 'wallet_update', provider: 'apple', merchantId: p.merchantId, txId: tx.id, status: 'failed', attempts: [{ at: Date.now(), result: 'error', msg: 'Pass update push rejected — signing certificate needs renewal' }] }); tx.walletSync = 'failed'; }
      if (p.requestId) { const r = byId('requests', p.requestId); if (r) { r.status = 'approved'; r.txId = tx.id; r.decidedAt = Date.now(); r.qty = p.qty; } }
      const lost = state.session.network === 'lost';
      if (lost) state.session.network = 'ok';
      save();
      if (lost) { const e = new Error('lost'); e.code = 'lost'; e.attemptId = p.attemptId; throw e; }
      return { ok: true, tx, balance: bal, rewards: created };
    },
    async checkAttempt(attemptId) { await net(1200); const tx = state.transactions.find(x => x.attemptId === attemptId); return tx ? { ok: true, tx, balance: byId('memberships', tx.membershipId).balance, rewards: (tx.rewardsCreated || []).map(id => byId('rewards', id)), recovered: true } : { ok: false, code: 'not_found' }; },

    async requestStamp(msid, branchId) {
      await net(600);
      const m = byId('memberships', msid); const merchant = byId('merchants', m.merchantId);
      if (merchant.status === 'suspended') return fail('merchant_suspended');
      const existing = state.requests.find(r => r.membershipId === msid && r.status === 'pending');
      if (existing) return { ok: true, request: existing, duplicate: true };
      const r = { id: 'SR-' + (300 + state.requests.length + 1), customerId: m.customerId, membershipId: msid, merchantId: m.merchantId, branchId, matchCode: String(10 + rnd(89)), status: 'pending', createdAt: Date.now(), expiresAt: Date.now() + 10 * MIN };
      state.requests.unshift(r); save(); return { ok: true, request: r };
    },
    cancelRequest(id) { const r = byId('requests', id); if (r && r.status === 'pending') { r.status = 'cancelled'; save(); } },
    async rejectRequest(id, reason, staffId) { await net(500); const r = byId('requests', id); if (r.status !== 'pending') return fail('request_' + r.status); r.status = 'rejected'; r.reason = reason; r.decidedAt = Date.now(); r.staffId = staffId; save(); return { ok: true }; },
    async approveRequest(id, p) {
      const r = byId('requests', id);
      if (r.status === 'expired' || r.expiresAt < Date.now()) { r.status = 'expired'; save(); return fail('request_expired'); }
      if (r.status !== 'pending') return fail('request_' + r.status);
      return C.addStamps(Object.assign({}, p, { membershipId: r.membershipId, merchantId: r.merchantId, branchId: r.branchId, requestId: id, source: 'request' }));
    },

    async startRedemption(rewardId, staffId, branchId) {
      await net(600); const r = byId('rewards', rewardId);
      if (r.status === 'available' && r.expiresAt < Date.now()) { r.status = 'expired'; save(); }
      if (r.status === 'expired') return fail('reward_expired');
      if (r.status === 'redeemed') return fail('reward_redeemed');
      r.redemption = { status: 'awaiting_holder', code: digits(4), staffId, branchId, startedAt: Date.now() }; save(); return { ok: true, reward: r };
    },
    holderConfirm(rewardId) { const r = byId('rewards', rewardId); if (r && r.redemption) { r.redemption.status = 'holder_confirmed'; r.redemption.confirmedAt = Date.now(); save(); } },
    holderDecline(rewardId) { const r = byId('rewards', rewardId); if (r && r.redemption) { r.redemption.status = 'holder_declined'; save(); } },
    cancelRedemption(rewardId) { const r = byId('rewards', rewardId); if (r) { r.redemption = null; save(); } },
    async completeRedemption(rewardId) {
      await net(700); const r = byId('rewards', rewardId);
      if (r.status === 'redeemed') return fail('reward_redeemed');
      if (!r.redemption || r.redemption.status !== 'holder_confirmed') return fail('holder_not_confirmed');
      r.status = 'redeemed'; r.redeemedAt = Date.now();
      const m = byId('memberships', r.membershipId); m.lastActivity = Date.now();
      const tx = { id: 'TX-' + (10000 + state.transactions.length), type: 'redeem', merchantId: r.merchantId, branchId: r.redemption.branchId, staffId: r.redemption.staffId, customerId: r.customerId, membershipId: r.membershipId, programId: r.programId, qty: 1, receipt: '', rewardId: r.id, status: 'completed', attemptId: 'AT-' + code(6), at: Date.now(), visit: false, source: 'scan', walletSync: 'ok', message: 'none' };
      state.transactions.push(tx); r.txId = tx.id; save(); return { ok: true, tx, reward: r };
    },

    async requestCorrection(p) { await net(500); const c = Object.assign({ id: 'CR-' + (12 + state.corrections.length), status: 'pending', at: Date.now() }, p); state.corrections.unshift(c); save(); return { ok: true, correction: c }; },
    decideCorrection(id, approve, approverId) {
      const c = byId('corrections', id); c.status = approve ? 'approved' : 'rejected'; c.decidedBy = approverId; c.decidedAt = Date.now();
      if (approve) { const m = byId('memberships', c.membershipId); m.balance = Math.max(0, m.balance + c.delta);
        state.transactions.push({ id: 'TX-' + (10000 + state.transactions.length), type: 'correction', merchantId: c.merchantId, branchId: (byId('transactions', c.txId) || {}).branchId, staffId: approverId, customerId: c.customerId, membershipId: c.membershipId, programId: m.programId, qty: c.delta, receipt: '', status: 'completed', attemptId: 'AT-' + code(6), at: Date.now(), visit: false, source: 'correction', walletSync: 'ok', message: 'none', correctionId: id }); }
      auditLog(approverId, approve ? 'correction.approve' : 'correction.reject', c.merchantId, c.reason); save();
    },

    async register(p) {
      await net(800);
      const email = p.email.trim().toLowerCase();
      let c = state.customers.find(x => x.email === email); let returning = !!c;
      if (!c) { const nm = email.split('@')[0]; c = { id: 'c' + (state.customers.length + 1), name: bi(nm, nm), alias: bi(nm.slice(0, 12), nm.slice(0, 12)), email, phone: '', createdAt: Date.now() }; state.customers.push(c); }
      let m = state.memberships.find(x => x.customerId === c.id && x.programId === p.programId);
      if (m) { state.session.customerId = c.id; save(); return { ok: true, customer: c, membership: m, returning: true }; }
      m = { id: 'ms_' + code(6), customerId: c.id, merchantId: p.merchantId, programId: p.programId, balance: 0, joinedAt: Date.now(), lastActivity: null, source: p.source || 'link' };
      state.memberships.push(m);
      state.consents[c.id + ':' + p.merchantId] = Object.assign({ terms: true, email: false, sms: false, whatsapp: false }, p.consents || {});
      state.session.customerId = c.id; save(); return { ok: true, customer: c, membership: m, returning };
    },
    setConsent(cid, mid, channel, val) { const k = cid + ':' + mid; state.consents[k] = Object.assign({}, Q.consent(cid, mid), { [channel]: val, updatedAt: Date.now() }); save(); },

    updateMerchant(mid, patch, actor) { Object.assign(byId('merchants', mid), patch); auditLog(actor || 'system', 'merchant.update', mid, bi('تحديث: ' + Object.keys(patch).join(', '), 'Updated: ' + Object.keys(patch).join(', '))); save(); },
    setMerchantStatus(mid, status, reason, actor) { const m = byId('merchants', mid); m.status = status; m.suspendReason = status === 'suspended' ? bi(reason, reason) : null; auditLog(actor, 'merchant.' + (status === 'suspended' ? 'suspend' : 'restore'), mid, bi(reason, reason)); save(); },

    saveDraft(d) { d.updatedAt = Date.now(); const i = state.drafts.findIndex(x => x.id === d.id); if (i >= 0) state.drafts[i] = d; else state.drafts.unshift(d); save(); return d; },
    deleteDraft(id) { state.drafts = state.drafts.filter(d => d.id !== id); save(); },
    async activateMerchant(d) {
      await delay(900);
      const x = d.data, id = 'm_' + code(5).toLowerCase(), t = Date.now();
      const merchant = { id, name: bi(x.name, x.nameEn || x.name), category: x.category, initials: bi(x.name.trim()[0], (x.nameEn || x.name).trim()[0].toUpperCase()), colors: { primary: x.primary, accent: x.accent, surface: '#FAFAF8' }, template: x.template, status: x.plan === 'trial' ? 'trial' : 'active', plan: x.plan === 'trial' ? 'starter' : x.plan, trialEndsAt: x.plan === 'trial' ? t + 14 * D : null, renewsAt: t + 30 * D, createdAt: t, lastActivity: t, contact: { name: x.contactName || '', email: x.email, phone: x.phone }, city: bi(x.city || '', x.city || ''), wallet: { apple: 'pending', google: 'failed' }, channels: { email: x.channels.email ? 'ready' : 'disabled', sms: x.channels.sms ? 'action_required' : 'disabled', whatsapp: x.channels.whatsapp ? 'pending' : 'disabled' }, offer: bi(x.offer || x.reward, x.offer || x.reward), terms: bi(x.terms || '', x.terms || '') };
      merchant.tasks = [
        { key: 'web_card', status: 'done', owner: 'system' },
        { key: 'qr', status: 'done', owner: 'system' },
        { key: 'owner_invite', status: 'done', owner: 'system' },
        { key: 'apple_wallet', status: 'pending', owner: 'platform' },
        { key: 'google_wallet', status: 'failed', owner: 'platform', error: 'Issuer class rejected: logo under 660px' },
        x.nfc ? { key: 'nfc', status: 'pending', owner: 'ops' } : null,
        x.channels.sms ? { key: 'sms_sender', status: 'action_required', owner: 'merchant' } : null
      ].filter(Boolean);
      state.merchants.unshift(merchant);
      x.branches.forEach((b, i) => state.branches.push({ id: id + '_b' + i, merchantId: id, name: bi(b.name, b.name), address: bi(b.address || '', b.address || ''), hours: '', status: 'active' }));
      const brIds = state.branches.filter(b => b.merchantId === id).map(b => b.id);
      state.programs.push({ id: id + '_p', merchantId: id, name: bi(x.programName, x.programName), type: x.programType || 'stamp', threshold: +x.threshold, maxPerTx: +x.maxPerTx, branches: brIds, reward: bi(x.reward, x.reward), rewardValidityDays: +x.validity || 30, startsAt: t, endsAt: null, status: 'active', version: 1, redeemTerms: bi('', '') });
      x.staff.forEach((s, i) => state.staff.push({ id: id + '_s' + i, merchantId: id, name: bi(s.email.split('@')[0], s.email.split('@')[0]), email: s.email, role: s.role, branches: brIds, maxQty: +x.maxPerTx, status: 'invited', invitedAt: t }));
      if (x.nfc || x.qr.length) brIds.forEach((bid, i) => state.materials.push({ id: 'MAT-' + (300 + state.materials.length), merchantId: id, branchId: bid, kind: 'stand', placement: bi('ستاند الكاشير', 'Counter stand'), code: 'q-' + id + '-' + i, status: 'production', nfc: !!x.nfc, nfcVerified: false, revoked: false }));
      state.drafts = state.drafts.filter(z => z.id !== d.id);
      auditLog(state.session.adminId, 'merchant.activate', id, bi('تفعيل التاجر', 'Merchant activated'));
      save(); return { ok: true, merchant };
    },
    async retryTask(mid, key) {
      const m = byId('merchants', mid); const tk = m.tasks.find(x => x.key === key); tk.status = 'running'; save();
      await delay(1400);
      tk.status = 'done'; tk.error = null;
      if (key === 'google_wallet') m.wallet.google = 'ready';
      if (key === 'apple_wallet') m.wallet.apple = 'ready';
      auditLog(state.session.adminId, 'task.retry', mid, bi('إعادة محاولة: ' + key, 'Retried: ' + key)); save(); return { ok: true };
    },
    async retryJob(id) {
      const j = byId('jobs', id); j.status = 'running'; save(); await delay(1200);
      const appleBroken = j.provider === 'apple' && state.integrations.find(i => i.id === 'apple_wallet').status === 'action_required';
      j.attempts.push({ at: Date.now(), result: appleBroken ? 'error' : 'ok', msg: appleBroken ? 'Pass update push rejected — signing certificate needs renewal' : 'Delivered' });
      j.status = appleBroken ? 'failed' : 'succeeded';
      if (!appleBroken && j.txId) { const tx = byId('transactions', j.txId); if (tx) tx.walletSync = 'ok'; }
      auditLog(state.session.adminId, 'job.retry', j.merchantId, bi('إعادة محاولة ' + id, 'Retried ' + id)); save(); return { ok: !appleBroken };
    },
    setIntegration(id, patch) { Object.assign(byId('integrations', id), patch); auditLog(state.session.adminId, 'integration.update', null, bi(id, id)); save(); },
    setMerchantWallet(mid, provider, status) { byId('merchants', mid).wallet[provider] = status; save(); },

    inviteStaff(p) { state.staff.push(Object.assign({ id: 's_' + code(5).toLowerCase(), status: 'invited', invitedAt: Date.now(), name: bi(p.email.split('@')[0], p.email.split('@')[0]) }, p)); auditLog(state.session.merchantId === p.merchantId ? 'owner' : 'system', 'staff.invite', p.merchantId, bi(p.email, p.email)); save(); },
    updateStaff(id, patch) { const s = byId('staff', id); Object.assign(s, patch); auditLog('owner', 'staff.update', s.merchantId, bi(L(s.name, 'ar') + ': ' + Object.keys(patch).join(', '), L(s.name, 'en') + ': ' + Object.keys(patch).join(', '))); save(); },

    saveProgram(p) { const i = state.programs.findIndex(x => x.id === p.id); if (i >= 0) state.programs[i] = p; else state.programs.push(p); save(); return p; },
    publishProgram(id) { const p = byId('programs', id); p.version = (p.version || 0) + (p.status === 'draft' && p.version === 1 && !p.publishedOnce ? 0 : 1); p.status = 'active'; p.publishedOnce = true; p.startsAt = p.startsAt || Date.now(); auditLog('owner', 'program.publish', p.merchantId, p.name); save(); },
    endProgram(id) { const p = byId('programs', id); p.status = 'ended'; p.endsAt = Date.now(); save(); },

    createCampaign(c) { const a = Q.audience(c.merchantId, c.segment, c.channel); const x = Object.assign({ id: 'CMP-' + (31 + state.campaigns.length), audience: a.total, reachable: a.reachable, delivered: 0, opened: 0, returned: 0 }, c); if (c.status === 'sent') { x.delivered = Math.max(0, a.reachable - (a.reachable > 3 ? 1 : 0)); x.opened = Math.floor(x.delivered / 2); } state.campaigns.unshift(x); save(); return x; },

    verifyNfc(id, staffId) { const m = byId('materials', id); m.nfcVerified = true; m.verifiedBy = staffId; m.verifiedAt = Date.now(); save(); },
    advanceMaterial(id) { const m = byId('materials', id); m.status = { production: 'shipped', shipped: 'installed' }[m.status] || m.status; save(); },
    revokeMaterial(id, replace) { const m = byId('materials', id); m.revoked = true; m.status = 'revoked'; if (replace) state.materials.push(Object.assign({}, m, { id: 'MAT-' + (300 + state.materials.length), code: m.code.replace(/(-r\d+)?$/, '-r' + (2 + rnd(8))), status: 'production', revoked: false, nfcVerified: false, replaces: m.id })); save(); },
    addMaterial(p) { state.materials.push(Object.assign({ id: 'MAT-' + (300 + state.materials.length), status: 'production', nfcVerified: false, revoked: false, code: 'q-' + p.branchId + '-' + code(3).toLowerCase() }, p)); save(); },

    replyTicket(id, text, by) { const tk = byId('tickets', id); tk.messages.push({ by, at: Date.now(), text: bi(text, text) }); if (tk.status === 'open' && by === 'platform') tk.status = 'pending'; save(); },
    setTicket(id, patch) { Object.assign(byId('tickets', id), patch); save(); },
    createTicket(p) { state.tickets.unshift(Object.assign({ id: 'T-' + (121 + state.tickets.length), status: 'open', priority: 'normal', createdAt: Date.now(), messages: [] }, p)); save(); },
    async chargeInvoice(id) { await delay(1000); const inv = byId('invoices', id); inv.status = 'paid'; inv.paidAt = Date.now(); save(); return { ok: true }; },
    setPlan(mid, plan) { const m = byId('merchants', mid); m.plan = plan; auditLog(state.session.adminId, 'subscription.change', mid, bi(plan, plan)); save(); }
  };

  load();
  setInterval(tick, 5000); tick();
  document.documentElement.lang = state.session.lang; document.documentElement.dir = state.session.lang === 'ar' ? 'rtl' : 'ltr';
  window.NQ = Object.assign({ CONFIG, D, MIN, H, get state() { return state; }, subscribe(f) { subs.add(f); return () => subs.delete(f); }, save: () => save(), L, fmtNum, fmtMoney, fmtDate, fmtTime, fmtRel, maskEmail, maskPhone, daysSince, code, digits, bi }, Q, C);
  window.dispatchEvent(new Event('nq-ready'));
})();
