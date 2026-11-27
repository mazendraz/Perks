import { ACTIVE_MARKET } from '../../../../packages/domain/src/market.js';
import type { PublicPlanKey } from '../../../../packages/contracts/src/plan-catalog.js';

export const SUPPORT_PHONE = ACTIVE_MARKET.whatsapp;

/** Sales lines by the device's language; any other language (Arabic included) uses SUPPORT_PHONE. */
const PHONE_BY_LANGUAGE: Record<string, string> = {
  en: '201069012881',
  fr: '201069012881',
  es: '201069012881',
  de: '201069012881',
  it: '201008605904',
  ru: '201008605904',
  tr: '201008605904',
};

const baseLanguage = (language: string | undefined) =>
  (language ?? '').toLowerCase().split(/[-_]/)[0] ?? '';

/** The WhatsApp number for the device's first preferred language, e.g. "fr-CA" → the French line. */
export function supportPhoneFor(language: string | undefined): string {
  return PHONE_BY_LANGUAGE[baseLanguage(language)] ?? SUPPORT_PHONE;
}

/** How a price is labelled: `unit` sits after the amount, `name` follows "الأسعار بـ". */
export interface PriceCurrency {
  unit: string;
  name: string;
}
/**
 * Prices are in the active market's currency for every visitor: we sell in Egypt only, so a
 * French or English device still reads جنيه (the amount is what self sign-up charges).
 */
export const PRICE_CURRENCY: PriceCurrency = {
  unit: ACTIVE_MARKET.unitAr,
  name: ACTIVE_MARKET.nameAr,
};
export const VOICE = '/business/voice/';

/** Every sentence the guide can say, with the recording that matches it word for word. */
export const LINES = {
  hero: { text: 'لو عندك كافيه أو محل… ركّز معايا دقيقة.', clip: '01_hero' },
  problem: {
    text: 'الزبون بييجي مرة، وبعدين يروح لغيرك. مش عشان مش عاجبه… عشان مفيش حاجة تفكّره بيك.',
    clip: '02_problem',
  },
  demoStart: { text: 'جرّب بنفسك. دوس الزرار كأنك زبون.', clip: '03_demo_start' },
  demoWait: { text: 'الكاشير بيوافق دلوقتي…', clip: '03_demo_wait' },
  demoProgress: { text: 'حلو! كمّل، الهدية قرّبت.', clip: '03_demo_progress' },
  demoDone: { text: 'شفت؟ كمّل الكارت وخد هديته… وهيرجعلك تاني.', clip: '03_demo_done' },
  cards: { text: 'اختار نوع محلك… وشوف الكارت.', clip: '04_cards' },
  owner: { text: 'انت مشغول في محلك، وإحنا بنفكّر الزبون إن فاضله ختمتين.', clip: '05_owner' },
  plansAsk: { text: 'قولّي عندك كام فرع، وأنا أقولك تاخد إيه.', clip: '06_plans_ask' },
  planStarter: { text: 'محل واحد؟ Starter كفاية عليك.', clip: '06_plan_starter' },
  planGrowth: { text: 'يبقى Growth هي اللي تناسبك.', clip: '06_plan_growth' },
  planPro: { text: 'عندك كذا فرع؟ خد Pro.', clip: '06_plan_pro' },
  planScale: { text: 'سلسلة؟ يبقى Scale.', clip: '06_plan_scale' },
  planEnterprise: {
    text: 'أكتر من 10 فروع؟ كلّمنا ونعملك باقة على مقاسك.',
    clip: '06_plan_enterprise',
  },
  close: { text: 'ابعتلنا رسالة… ونجهّزلك كارت محلك.', clip: '07_close' },
} as const;
/** Recording lengths in seconds, so typing keeps pace with the voice before the file's metadata loads. */
export const CLIP_SECONDS: Record<string, number> = {
  '01_hero': 3.08,
  '02_problem': 6.22,
  '03_demo_start': 2.61,
  '03_demo_wait': 1.99,
  '03_demo_progress': 2.22,
  '03_demo_done': 3.08,
  '04_cards': 1.99,
  '05_owner': 3.81,
  '06_plans_ask': 2.22,
  '06_plan_starter': 2.27,
  '06_plan_growth': 1.75,
  '06_plan_pro': 1.72,
  '06_plan_scale': 1.52,
  '06_plan_enterprise': 3.5,
  '07_close': 2.77,
};
export type LineKey = keyof typeof LINES;
export const PLAN_LINE: Record<PublicPlanKey, LineKey> = {
  starter: 'planStarter',
  growth: 'planGrowth',
  pro: 'planPro',
  scale: 'planScale',
};
