import {
  publicPlanCatalog,
  annualPaidMonths,
  setupFeePerBranch,
  enterpriseBranchThreshold,
  type PublicPlan,
  type PublicPlanKey,
} from '../../../../packages/contracts/src/plan-catalog.js';
import { recommendPlan, annualPrice } from '../../../../packages/domain/src/plan-recommendation.js';

/* ------------------------------------------------------------------ helpers */

function one<T extends Element>(selector: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error('Landing markup is missing ' + selector);
  return el;
}
function all<T extends Element>(selector: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll<T>(selector));
}
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const money = (n: number) => Math.round(n).toLocaleString('en-US');
const deviceLanguage = navigator.languages?.[0] ?? navigator.language;
const currency = priceCurrencyFor(deviceLanguage);
const prefersReducedMotion = () => {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};
function graphemes(text: string): string[] {
  try {
    const seg = new Intl.Segmenter('ar', { granularity: 'grapheme' });
    return Array.from(seg.segment(text), (s) => s.segment);
  } catch {
    return Array.from(text);
  }
}
function storageGet(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Private mode: the choice lasts for this visit only. */
  }
}

/* --------------------------------------------------------------- the lines */

import {
  LINES,
  CLIP_SECONDS,
  PLAN_LINE,
  VOICE,
  priceCurrencyFor,
  supportPhoneFor,
  type LineKey,
} from './lines.js';

/* ------------------------------------------------------------------- state */

const state = {
  active: 0,
  stamps: 2,
  pending: false,
  theme: 0,
  branches: 2,
  staff: 4,
  annual: false,
  planTouched: false,
  soundOn: storageGet('perks-landing-sound') !== 'off',
  soundBlocked: false,
};
const STAMP_GOAL = 6;
const MAX_STAFF = 60;

function lineFor(stop: number): LineKey {
  switch (stop) {
    case 0:
      return 'hero';
    case 1:
      return 'problem';
    case 2:
      if (state.stamps >= STAMP_GOAL) return 'demoDone';
      if (state.pending) return 'demoWait';
      return state.stamps > 2 ? 'demoProgress' : 'demoStart';
    case 3:
      return 'cards';
    case 4:
      return 'owner';
    case 5: {
      if (!state.planTouched) return 'plansAsk';
      const r = recommendPlan(publicPlanCatalog, state.branches, state.staff);
      return r.kind === 'enterprise' ? 'planEnterprise' : PLAN_LINE[r.quote.plan.key];
    }
    default:
      return 'close';
  }
}

/* ------------------------------------------------------------ the guide UI */

interface Guide {
  stop: number;
  mascot: HTMLButtonElement;
  row: number;
  typed: HTMLElement;
  full: HTMLElement;
  ghost: HTMLElement;
  line: LineKey | null;
  glyphs: string[];
  shown: number;
}

const guides: Guide[] = all<HTMLElement>('[data-guide]').map((root) => {
  const stop = Number(root.dataset.guide);
  const mascot = one<HTMLButtonElement>('[data-mascot]', root);
  const typed = one<HTMLElement>('[data-typed]', root);
  const full = one<HTMLElement>('[data-full]', root);
  const ghost = el('span', 'ghost');
  ghost.setAttribute('aria-hidden', 'true');
  typed.before(ghost);
  return {
    stop,
    mascot,
    row: Number(mascot.dataset.row),
    typed,
    full,
    ghost,
    line: null,
    glyphs: [],
    shown: 0,
  };
});
document.documentElement.classList.add('js');

const SPRITE_COLS = 8;
const SPRITE_ROWS = 10;
function setFrame(g: Guide, col: number, row = g.row) {
  g.mascot.style.backgroundPosition =
    ((col / (SPRITE_COLS - 1)) * 100).toFixed(3) +
    '% ' +
    ((row / (SPRITE_ROWS - 1)) * 100).toFixed(3) +
    '%';
}

/** Puts the stop's current line in its bubble; restarts typing when asked or when the line changed. */
function syncLine(g: Guide, restart: boolean) {
  const key = lineFor(g.stop);
  const changed = key !== g.line;
  if (!changed && !restart) return false;
  const text = LINES[key].text;
  g.line = key;
  g.glyphs = graphemes(text);
  g.full.textContent = text;
  g.ghost.textContent = text;
  const animate = g.stop === state.active && !prefersReducedMotion();
  g.shown = animate ? 0 : g.glyphs.length;
  g.typed.textContent = animate ? '' : text;
  g.typed.classList.toggle('typing', animate);
  return true;
}

/* ------------------------------------------------------------------- voice */

let audio: HTMLAudioElement | null = null;
// The guide waits until two seconds after the page is ready, then speaks his first line.
let introPending = true;
let clipStartedAt = 0;
let clipSeconds = 0;
const heroSound = one<HTMLButtonElement>('[data-hero-sound]');
const soundToggle = one<HTMLButtonElement>('[data-sound-toggle]');

function renderSoundUi() {
  soundToggle.hidden = false;
  soundToggle.setAttribute('aria-pressed', String(state.soundOn));
  one('[data-sound-label]', soundToggle).textContent = state.soundOn ? 'اقفل الصوت' : 'شغّل الصوت';
  one<SVGPathElement>('[data-sound-wave]', soundToggle).toggleAttribute('hidden', !state.soundOn);
  one<SVGPathElement>('[data-sound-mute]', soundToggle).toggleAttribute('hidden', state.soundOn);
  heroSound.hidden = !(state.soundOn && state.soundBlocked);
}

function speak(stop: number) {
  clipSeconds = 0;
  if (!state.soundOn) return;
  const g = guides.find((x) => x.stop === stop);
  if (!g?.line) return;
  if (!audio) {
    try {
      audio = new Audio();
      audio.preload = 'auto';
      audio.addEventListener('ended', () => {
        clipSeconds = 0;
        // A short breath between sentences.
        window.setTimeout(flushPending, 350);
      });
    } catch {
      return;
    }
  }
  const player = audio;
  try {
    player.pause();
    const clip = LINES[g.line].clip;
    player.src = VOICE + clip + '.m4a';
    player.currentTime = 0;
    const playing = player.play();
    clipStartedAt = performance.now();
    clipSeconds = CLIP_SECONDS[clip] ?? 0;
    player.onloadedmetadata = () => {
      if (Number.isFinite(player.duration)) clipSeconds = player.duration;
    };
    playing
      .then(() => {
        if (state.soundBlocked) {
          state.soundBlocked = false;
          renderSoundUi();
        }
      })
      .catch((err: unknown) => {
        clipSeconds = 0;
        if (err instanceof DOMException && err.name === 'NotAllowedError' && !state.soundBlocked) {
          state.soundBlocked = true;
          renderSoundUi();
        }
      });
  } catch {
    clipSeconds = 0;
  }
}
/* A demo step changes what the guide should say. He never cuts himself off: if he is still
   talking (or still typing), the newest line waits and he says it when he finishes. */
let pendingStop: number | null = null;
function busy(stop: number) {
  const g = guides.find((x) => x.stop === stop);
  const talking = !!audio && !audio.paused && !audio.ended && clipSeconds > 0;
  return talking || (!!g && g.shown < g.glyphs.length);
}
function sayUpdate(stop: number) {
  const g = guides.find((x) => x.stop === stop);
  if (!g) return;
  if (state.active === stop && busy(stop)) {
    pendingStop = stop;
    return;
  }
  if (syncLine(g, false) && state.active === stop) speak(stop);
}
function flushPending() {
  if (pendingStop === null) return;
  const stop = pendingStop;
  if (stop !== state.active) {
    // The visitor moved on; the line is updated quietly for when they come back.
    pendingStop = null;
    const g = guides.find((x) => x.stop === stop);
    if (g) syncLine(g, false);
    return;
  }
  if (busy(stop)) return;
  pendingStop = null;
  sayUpdate(stop);
}

function stopVoice() {
  try {
    audio?.pause();
  } catch {
    /* nothing to stop */
  }
  clipSeconds = 0;
}

/** Re-says the active stop's line from the start (typing and voice together). */
function replay(stop: number) {
  introPending = false;
  state.active = stop;
  const g = guides.find((x) => x.stop === stop);
  if (!g) return;
  syncLine(g, true);
  speak(stop);
}

// Browsers only allow sound after the visitor touches the page: the first touch replays the line aloud.
function unlock() {
  if (state.soundOn && state.soundBlocked) replay(state.active);
}
document.addEventListener('pointerdown', unlock, true);
document.addEventListener('touchend', unlock, true);

heroSound.addEventListener('click', () => replay(state.active));
soundToggle.addEventListener('click', () => {
  state.soundOn = !state.soundOn;
  storageSet('perks-landing-sound', state.soundOn ? 'on' : 'off');
  if (state.soundOn) {
    state.soundBlocked = false;
    replay(state.active);
  } else {
    state.soundBlocked = false;
    stopVoice();
  }
  renderSoundUi();
});

/* ----------------------------------------------------------------- the tick */

const TICK_MS = 70;
let tick = 0;
function frameTick() {
  tick++;
  const reduce = prefersReducedMotion();
  for (const g of guides) {
    let col = 0;
    if (g.stop === state.active && g.shown < g.glyphs.length && !introPending) {
      const fallbackPerTick = 2;
      if (state.soundOn && clipSeconds > 0) {
        const progress = Math.min(1, (performance.now() - clipStartedAt) / (clipSeconds * 1000));
        g.shown = Math.max(g.shown, Math.ceil(progress * g.glyphs.length));
      } else g.shown = Math.min(g.glyphs.length, g.shown + fallbackPerTick);
      g.typed.textContent = g.glyphs.slice(0, g.shown).join('');
      const talking = g.shown < g.glyphs.length;
      g.typed.classList.toggle('typing', talking);
      if (!talking && pendingStop === g.stop) window.setTimeout(flushPending, 350);
      if (talking && !reduce) col = 1 + (Math.floor(tick / 2) % 6);
    } else if (!reduce && (tick + g.stop * 9) % 46 < 2) col = 7;
    setFrame(g, col);
  }
}

/* ------------------------------------------------------- which stop is on */

function setActive(stop: number) {
  if (stop === state.active) return;
  state.active = stop;
  replay(stop);
}
const sections = all<HTMLElement>('[data-stop]');
const visibility = new Map<HTMLElement, number>();
if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        visibility.set(e.target as HTMLElement, e.isIntersecting ? e.intersectionRatio : 0);
      let best: HTMLElement | null = null;
      let bestRatio = 0;
      for (const [section, ratio] of visibility)
        if (ratio > bestRatio) {
          best = section;
          bestRatio = ratio;
        }
      if (best && bestRatio > 0) setActive(Number(best.dataset.stop));
    },
    { threshold: [0, 0.2, 0.4, 0.6, 0.8, 1] },
  );
  sections.forEach((s) => io.observe(s));
}
for (const g of guides) g.mascot.addEventListener('click', () => replay(g.stop));

/* ------------------------------------------------------------ stamp demo */

const stampEls = all<HTMLElement>('.stamp', one('[data-stamps]'));
const scanBtn = one<HTMLButtonElement>('[data-scan]');
const resetBtn = one<HTMLButtonElement>('[data-reset]');
const pendingEl = one<HTMLElement>('[data-pending]');
const giftEl = one<HTMLElement>('[data-gift]');
let scanTimer = 0;

function renderStamps(newIndex = -1) {
  stampEls.forEach((s, i) => {
    s.classList.toggle('on', i < state.stamps);
    s.classList.toggle('new', i === newIndex);
  });
  const done = state.stamps >= STAMP_GOAL;
  one('[data-stamp-count]').textContent = state.stamps + '/' + STAMP_GOAL;
  one('[data-stamp-line]').textContent = done
    ? 'الكارت كمل!'
    : 'فاضلك ' + (STAMP_GOAL - state.stamps) + ' على قهوة مجانية';
  giftEl.hidden = !done;
  pendingEl.hidden = !state.pending;
  scanBtn.hidden = done || state.pending;
  resetBtn.hidden = !done;
  sayUpdate(2);
}
scanBtn.addEventListener('click', () => {
  if (state.pending || state.stamps >= STAMP_GOAL) return;
  state.active = 2;
  state.pending = true;
  renderStamps();
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(
    () => {
      state.pending = false;
      state.stamps += 1;
      renderStamps(state.stamps - 1);
      (state.stamps >= STAMP_GOAL ? resetBtn : scanBtn).focus({ preventScroll: true });
    },
    prefersReducedMotion() ? 150 : 900,
  );
});
resetBtn.addEventListener('click', () => {
  state.stamps = 0;
  renderStamps();
  scanBtn.focus({ preventScroll: true });
});

/* ---------------------------------------------------------- card themes */

const THEMES = [
  {
    label: 'كافيه',
    name: 'قهوة ركن',
    type: 'كافيه',
    initial: 'ق',
    reward: 'الكوباية العاشرة علينا',
    bg: '#3B2A20',
    fg: '#F5EBDD',
    acc: '#E9C46A',
    shape: '50%',
  },
  {
    label: 'صالون حلاقة',
    name: 'صالون الأستاذ',
    type: 'حلاق رجالي',
    initial: 'ص',
    reward: 'الحلاقة العاشرة ببلاش',
    bg: '#0F3D3E',
    fg: '#E8F3EF',
    acc: '#F2A65A',
    shape: '6px',
  },
  {
    label: 'مغسلة عربيات',
    name: 'لمعة',
    type: 'غسيل عربيات',
    initial: 'ل',
    reward: 'غسلة كاملة هدية',
    bg: '#12355B',
    fg: '#EAF2FB',
    acc: '#7FD1FF',
    shape: '50% 50% 50% 0',
  },
  {
    label: 'Workspace',
    name: 'مساحة',
    type: 'مساحة شغل',
    initial: 'م',
    reward: 'يوم شغل مجاني',
    bg: '#F5F5F1',
    fg: '#181B38',
    acc: '#181B38',
    shape: '4px',
  },
] as const;
const themeBox = one<HTMLElement>('[data-themes]');
const themeCard = one<HTMLElement>('[data-theme-card]');
const themeButtons = THEMES.map((t, i) => {
  const b = el('button', 'btn chip', t.label);
  b.type = 'button';
  b.addEventListener('click', () => {
    state.theme = i;
    renderTheme();
  });
  themeBox.append(b);
  return b;
});
themeBox.hidden = false;
function renderTheme() {
  const t = THEMES[state.theme] ?? THEMES[0];
  themeCard.style.setProperty('--card-bg', t.bg);
  themeCard.style.setProperty('--card-fg', t.fg);
  themeCard.style.setProperty('--card-acc', t.acc);
  themeCard.style.setProperty('--card-shape', t.shape);
  one('[data-theme-name]', themeCard).textContent = t.name;
  one('[data-theme-type]', themeCard).textContent = t.type;
  one('[data-theme-initial]', themeCard).textContent = t.initial;
  one('[data-theme-reward]', themeCard).textContent = t.reward;
  themeButtons.forEach((b, i) => b.setAttribute('aria-pressed', String(i === state.theme)));
  themeCard.classList.remove('swap');
  void themeCard.offsetWidth;
  themeCard.classList.add('swap');
}

/* ----------------------------------------------------------------- plans */

const devicePhone = supportPhoneFor(deviceLanguage);
function whatsapp(text: string) {
  return 'https://wa.me/' + devicePhone + '?text=' + encodeURIComponent(text);
}
function branchesLabel(n: number) {
  return n > enterpriseBranchThreshold ? 'أكتر من ' + enterpriseBranchThreshold : String(n);
}
function planLines(p: PublicPlan): string[] {
  return [
    p.includedBranches === 1 ? 'فرع واحد' : p.includedBranches + ' فروع',
    p.includedStaff === null ? 'موظفين من غير حد' : p.includedStaff + ' موظفين',
    p.activePrograms === 1 ? 'برنامج ولاء واحد شغال' : p.activePrograms + ' برامج ولاء شغالين',
    p.manualMessagesPerMonth + ' رسايل منك للزباين في الشهر',
    p.key === 'starter'
      ? 'تذكير لما الهدية تقرب'
      : p.key === 'scale'
        ? 'تحليلات متقدمة وكارت بتصميم خاص'
        : 'كل التذكيرات وتقسيم الزباين',
  ];
}
const TAGS: Record<PublicPlanKey, string> = {
  starter: 'محل واحد',
  growth: 'الأكتر طلبًا',
  pro: 'كذا فرع',
  scale: 'سلسلة',
};

/** Plans an owner can sign up for and pay on the site (monthly); kept in step with migration 067. */
const SELF_SERVE_PLANS = new Set<string>(['starter', 'growth', 'pro']);
const plansBox = one<HTMLElement>('[data-plans]');
const planCards = publicPlanCatalog.map((p) => {
  const card = el('article', 'plan');
  const badge = el('span', 'plan-badge', 'أنسب باقة ليك');
  badge.hidden = true;
  const head = el('div', 'plan-head');
  head.append(el('strong', 'latin', p.name), el('span', 'plan-tag', TAGS[p.key]));
  const priceRow = el('div', 'plan-price');
  const amount = el('span', 'latin plan-amount');
  const per = el('span', 'plan-per');
  priceRow.append(amount, document.createTextNode(' '), per);
  const sub = el('p', 'plan-sub');
  const list = el('ul', 'plan-lines');
  for (const line of planLines(p)) list.append(el('li', undefined, line));
  const detail = el('p', 'plan-detail');
  detail.hidden = true;
  const cta = el('a', 'btn navy wide', 'عايز ' + p.name);
  // Under a self-service CTA, WhatsApp stays one tap away for owners who would rather talk first.
  const alt = el('a', 'plan-alt', 'أو كلّمنا على واتساب');
  alt.target = '_blank';
  alt.rel = 'noopener noreferrer';
  const foot = el('div', 'plan-foot');
  foot.append(detail, cta, alt);
  card.append(badge, head, priceRow, sub, list, foot);
  plansBox.append(card);
  return { plan: p, card, badge, amount, per, sub, detail, cta, alt };
});

const COMPARE: [string, (p: PublicPlan) => string][] = [
  ['الفروع', (p) => String(p.includedBranches)],
  ['الموظفين', (p) => (p.includedStaff === null ? 'من غير حد' : String(p.includedStaff))],
  ['برامج الولاء الشغالة', (p) => String(p.activePrograms)],
  ['رسايل منك للزباين في الشهر', (p) => String(p.manualMessagesPerMonth)],
  [
    'فرع زيادة',
    (p) => (p.extraBranchPrice === null ? 'طلّع الباقة' : money(p.extraBranchPrice) + ' / شهر'),
  ],
  ['موظف زيادة', (p) => (p.extraStaffPrice === null ? '—' : money(p.extraStaffPrice) + ' / شهر')],
  ['Apple وGoogle Wallet وكارت ويب', () => '✓'],
  ['QR وNFC ولوجو وألوان محلك', () => '✓'],
  ['التذكيرات', (p) => (p.key === 'starter' ? 'لما الهدية تقرب' : 'كلها')],
  ['تقسيم الزباين', (p) => (p.key === 'starter' ? '—' : '✓')],
  ['التحليلات', (p) => (p.key === 'starter' ? 'أساسية' : p.key === 'scale' ? 'متقدمة' : 'بالفرع')],
  ['كارت بتصميم خاص', (p) => (p.key === 'scale' ? '✓' : '—')],
  ['تصدير بيانات الزباين CSV', () => '✓'],
  [
    'الدعم',
    (p) => ({ starter: 'عادي', growth: 'أولوية', pro: 'أولوية', scale: 'مسؤول حساب' })[p.key],
  ],
];
const compareBody = one<HTMLElement>('[data-compare]');
for (const [label, value] of COMPARE) {
  const tr = el('tr');
  const th = el('th', undefined, label);
  th.scope = 'row';
  tr.append(th);
  for (const p of publicPlanCatalog) tr.append(el('td', undefined, value(p)));
  compareBody.append(tr);
}
one<HTMLElement>('[data-compare-box]').hidden = false;
one<HTMLElement>('[data-fine]').textContent =
  'الأسعار ب' +
  currency.name +
  ' ومن غير ضريبة القيمة المضافة. رسوم تجهيز ' +
  money(setupFeePerBranch) +
  ' ' +
  currency.unit +
  ' للفرع في الاشتراك الشهري، ومجانًا في السنوي. لو سجّلت محلك بنفسك من الموقع، أول دفعة هي الاشتراك الشهري بس من غير رسوم تجهيز. Starter مفيهاش فرع زيادة: لو محتاج فرع تاني طلّع على Growth.';

function renderPlans() {
  one('[data-br]').textContent = branchesLabel(state.branches);
  one('[data-st]').textContent = String(state.staff);
  for (const b of all<HTMLButtonElement>('[data-bill]'))
    b.setAttribute('aria-pressed', String((b.dataset.bill === 'annual') === state.annual));
  const r = recommendPlan(publicPlanCatalog, state.branches, state.staff);
  const billing = state.annual ? 'سنوي' : 'شهري';
  for (const c of planCards) {
    const p = c.plan;
    const isRec = r.kind === 'plan' && r.quote.plan.key === p.key;
    c.card.classList.toggle('rec', isRec);
    c.badge.hidden = !isRec;
    c.amount.textContent = money(
      state.annual ? annualPrice(p.monthlyPrice, annualPaidMonths) : p.monthlyPrice,
    );
    c.per.textContent = currency.unit + (state.annual ? ' / سنة' : ' / شهر');
    c.sub.textContent = state.annual
      ? 'يعني ' +
        money((p.monthlyPrice * annualPaidMonths) / 12) +
        ' ' +
        currency.unit +
        ' في الشهر'
      : '';
    c.cta.className = 'btn wide ' + (isRec ? 'lime' : 'navy');
    const chat = whatsapp(
      'أهلًا Perks، عايز باقة ' +
        p.name +
        '. عندي ' +
        branchesLabel(state.branches) +
        ' فروع و' +
        state.staff +
        ' موظفين، والدفع ' +
        billing +
        '.',
    );
    // Sign-up on the site takes the base monthly Starter, Growth and Pro plans. A quote with extra
    // branches or staff on top, annual billing and Scale are a chat, so the price shown is the
    // price charged.
    const extras =
      isRec && r.kind === 'plan' && (r.quote.extraBranches > 0 || r.quote.extraStaff > 0);
    const selfServe = !state.annual && !extras && SELF_SERVE_PLANS.has(p.key);
    c.cta.textContent = selfServe ? 'ابدأ بـ ' + p.name : 'عايز ' + p.name;
    c.cta.href = selfServe ? '/onboarding/signup?plan=' + p.key : chat;
    if (selfServe) {
      c.cta.removeAttribute('target');
      c.cta.removeAttribute('rel');
    } else {
      c.cta.target = '_blank';
      c.cta.rel = 'noopener noreferrer';
    }
    c.alt.href = chat;
    c.alt.hidden = !selfServe;
    c.detail.hidden = !isRec;
    if (isRec && r.kind === 'plan') {
      const q = r.quote;
      const bits: string[] = [];
      if (q.extraBranches)
        bits.push(q.extraBranches === 1 ? 'فرع زيادة' : q.extraBranches + ' فروع زيادة');
      if (q.extraStaff)
        bits.push(q.extraStaff === 1 ? 'موظف زيادة' : q.extraStaff + ' موظفين زيادة');
      const total = state.annual ? annualPrice(q.monthlyTotal, annualPaidMonths) : q.monthlyTotal;
      c.detail.textContent = bits.length
        ? p.name +
          ' + ' +
          bits.join(' و') +
          ' = ' +
          money(total) +
          ' ' +
          currency.unit +
          (state.annual ? ' في السنة' : ' في الشهر')
        : 'مظبوطة على ' +
          (state.branches === 1 ? 'فرع واحد' : state.branches + ' فروع') +
          ' و' +
          state.staff +
          ' موظفين';
    }
  }
  sayUpdate(5);
  for (const link of all<HTMLAnchorElement>('[data-wa]')) {
    const kind = link.dataset.wa;
    link.href = whatsapp(
      kind === 'enterprise'
        ? 'أهلًا Perks، عندي أكتر من ' + enterpriseBranchThreshold + ' فروع وعايز باقة Enterprise.'
        : kind === 'close'
          ? 'أهلًا Perks، عايز أجرّب 14 يوم. اسم المحل: ___ ونوعه: ___ وعندي ' +
            branchesLabel(state.branches) +
            ' فروع.'
          : 'أهلًا Perks، عايز أعرف أكتر عن كارت الولاء لمحلي.',
    );
  }
}
for (const b of all<HTMLButtonElement>('[data-step]'))
  b.addEventListener('click', () => {
    const dir = Number(b.dataset.dir) || 0;
    state.active = 5;
    state.planTouched = true;
    if (b.dataset.step === 'br')
      state.branches = Math.min(enterpriseBranchThreshold + 1, Math.max(1, state.branches + dir));
    else state.staff = Math.min(MAX_STAFF, Math.max(1, state.staff + dir));
    renderPlans();
  });
for (const b of all<HTMLButtonElement>('[data-bill]'))
  b.addEventListener('click', () => {
    state.annual = b.dataset.bill === 'annual';
    renderPlans();
  });
one<HTMLElement>('[data-pickers]').hidden = false;

/* ------------------------------------------------------------------- start */

for (const g of guides) syncLine(g, g.stop === state.active);
renderStamps();
renderTheme();
renderPlans();
renderSoundUi();
window.setInterval(frameTick, TICK_MS);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopVoice();
});

// Lift the loading screen once the mascot is in (or after 2.5 s, whatever happens).
const mascotArt = new Image();
let lifted = false;
const lift = () => {
  if (lifted) return;
  lifted = true;
  document.documentElement.classList.add('ready');
  // Two seconds after the page shows, the guide starts talking (typing and voice together).
  // If the browser blocks sound before a first touch, "دوس هنا عشان تسمعني" shows instead.
  window.setTimeout(() => {
    if (introPending) replay(state.active);
  }, 2000);
};
mascotArt.onload = lift;
mascotArt.onerror = lift;
mascotArt.src = '/business/mascot.png';
if (mascotArt.complete) lift();
window.setTimeout(lift, 2500);
