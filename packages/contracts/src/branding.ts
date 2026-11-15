import { z } from 'zod';
export const cardTemplates = [
  'classic',
  'minimal',
  'bold',
  'noir',
  'editorial',
  'botanical',
  'ticket',
  'mosaic',
  'aurora',
  'cafe',
  'espresso',
  'restaurant',
  'bistro',
  'barber',
  'grooming',
  'latte',
  'roastery',
  'carwash',
  'detailing',
  'confetti',
  'waves',
  'chalkboard',
  'grill',
  'vintage',
  'foam',
  'logomark',
  'cowork',
  'studio',
  'gym',
  'pulse',
  'salon',
  'spa',
  'bakery',
  'sweets',
] as const;
export type CardTemplate = (typeof cardTemplates)[number];
export const logoStyles = ['framed', 'plain'] as const;
/** Where the "Your logo" edition puts the large logo. Physical sides: what the owner sees. */
export const logoMarkPositions = [
  'center',
  'top',
  'bottom',
  'left',
  'right',
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
] as const;
export type LogoMarkPosition = (typeof logoMarkPositions)[number];
/** How much of the logo goes past the card edge, in percent of the logo. */
export const LOGO_MARK_MAX_BLEED = 60;
/**
 * The large logo's square box (size and top-left corner) on a W×H card: 80% of the card's
 * shorter side, pushed toward the chosen edge, with `bleed` percent of it past that edge.
 * Shared by the web card and the Wallet artwork so they place the logo the same way.
 */
export function logoMarkBox(
  W: number,
  H: number,
  position: LogoMarkPosition = 'center',
  bleed = 0,
) {
  const size = Math.min(W, H) * 0.8,
    b = Math.max(0, Math.min(LOGO_MARK_MAX_BLEED, bleed)) / 100,
    ax = position.includes('left') ? -1 : position.includes('right') ? 1 : 0,
    ay = position.startsWith('top') ? -1 : position.startsWith('bottom') ? 1 : 0;
  return {
    size,
    x: W / 2 - size / 2 + ax * (W / 2 - size / 2 + b * size),
    y: H / 2 - size / 2 + ay * (H / 2 - size / 2 + b * size),
  };
}
export const logoMarkPositionNames: Record<LogoMarkPosition, { ar: string; en: string }> = {
  center: { ar: 'في النص', en: 'Centre' },
  top: { ar: 'فوق', en: 'Top' },
  bottom: { ar: 'تحت', en: 'Bottom' },
  left: { ar: 'شمال', en: 'Left' },
  right: { ar: 'يمين', en: 'Right' },
  'top-left': { ar: 'فوق شمال', en: 'Top left' },
  'top-right': { ar: 'فوق يمين', en: 'Top right' },
  'bottom-left': { ar: 'تحت شمال', en: 'Bottom left' },
  'bottom-right': { ar: 'تحت يمين', en: 'Bottom right' },
};
export type LogoStyle = (typeof logoStyles)[number];
export const cardTemplate = z.enum(cardTemplates);
export const templateNames: Record<CardTemplate, { ar: string; en: string }> = {
  classic: { ar: 'التوقيع', en: 'Signature' },
  minimal: { ar: 'البسيط', en: 'Minimal' },
  bold: { ar: 'الجريء', en: 'Bold' },
  noir: { ar: 'الليلي', en: 'Noir' },
  editorial: { ar: 'المجلة', en: 'Editorial' },
  botanical: { ar: 'الطبيعة', en: 'Botanical' },
  ticket: { ar: 'التذكرة', en: 'Ticket' },
  mosaic: { ar: 'الموزاييك', en: 'Mosaic' },
  aurora: { ar: 'الشفق', en: 'Aurora' },
  cafe: { ar: 'بيت القهوة', en: 'Coffee House' },
  espresso: { ar: 'إسبريسو', en: 'Espresso' },
  restaurant: { ar: 'مائدة', en: 'Dining Room' },
  bistro: { ar: 'بيسترو', en: 'Bistro' },
  barber: { ar: 'باربر كلوب', en: 'Barber Club' },
  grooming: { ar: 'جروومينج', en: 'Grooming Studio' },
  latte: { ar: 'لاتيه', en: 'Latte' },
  roastery: { ar: 'المحمصة', en: 'Roastery' },
  carwash: { ar: 'لمعة', en: 'Shine' },
  detailing: { ar: 'ديتيلنج', en: 'Detailing' },
  confetti: { ar: 'كونفيتي', en: 'Confetti' },
  waves: { ar: 'الموج', en: 'Waves' },
  chalkboard: { ar: 'السبورة', en: 'Chalkboard' },
  grill: { ar: 'المشويات', en: 'Grill House' },
  vintage: { ar: 'زمان', en: 'Vintage' },
  foam: { ar: 'رغوة', en: 'Foam' },
  logomark: { ar: 'لوجو المحل', en: 'Your logo' },
  cowork: { ar: 'كوورك', en: 'Cowork' },
  studio: { ar: 'ستوديو', en: 'Studio' },
  gym: { ar: 'باور', en: 'Power' },
  pulse: { ar: 'نبض', en: 'Pulse' },
  salon: { ar: 'صالون', en: 'Salon' },
  spa: { ar: 'سبا', en: 'Spa' },
  bakery: { ar: 'المخبز', en: 'Bakery' },
  sweets: { ar: 'حلويات', en: 'Sweets' },
};
export const stampShapes = ['circle', 'rounded', 'square', 'hexagon', 'seal'] as const;
export const stampIcons = [
  'check',
  'star',
  'heart',
  'coffee',
  'utensils',
  'scissors',
  'crown',
  'flame',
  'car',
  'drop',
  'bean',
  'laptop',
  'dumbbell',
  'sparkle',
  'cupcake',
] as const;
export const stampStyles = ['solid', 'outline'] as const;
export const stampDesign = {
  stampShape: z.enum(stampShapes).default('circle'),
  stampIcon: z.enum(stampIcons).default('check'),
  stampStyle: z.enum(stampStyles).default('solid'),
};
export type StampShape = (typeof stampShapes)[number];
export type StampIcon = (typeof stampIcons)[number];
export type StampStyle = (typeof stampStyles)[number];
export const stampShapeNames: Record<StampShape, { ar: string; en: string }> = {
  circle: { ar: 'دائري', en: 'Circle' },
  rounded: { ar: 'حواف ناعمة', en: 'Rounded' },
  square: { ar: 'مربع', en: 'Square' },
  hexagon: { ar: 'سداسي', en: 'Hexagon' },
  seal: { ar: 'ختم مسنن', en: 'Seal' },
};
export const stampIconNames: Record<StampIcon, { ar: string; en: string }> = {
  check: { ar: 'صح', en: 'Check' },
  star: { ar: 'نجمة', en: 'Star' },
  heart: { ar: 'قلب', en: 'Heart' },
  coffee: { ar: 'فنجان قهوة', en: 'Coffee' },
  utensils: { ar: 'شوكة وسكينة', en: 'Cutlery' },
  scissors: { ar: 'مقص', en: 'Scissors' },
  crown: { ar: 'تاج', en: 'Crown' },
  flame: { ar: 'شعلة', en: 'Flame' },
  car: { ar: 'عربية', en: 'Car' },
  drop: { ar: 'نقطة مية', en: 'Water drop' },
  bean: { ar: 'حباية بن', en: 'Coffee bean' },
  laptop: { ar: 'لابتوب', en: 'Laptop' },
  dumbbell: { ar: 'دمبل', en: 'Dumbbell' },
  sparkle: { ar: 'لمعة', en: 'Sparkle' },
  cupcake: { ar: 'كب كيك', en: 'Cupcake' },
};
export const templateCategories = [
  'general',
  'cafe',
  'restaurant',
  'barber',
  'carwash',
  'workspace',
  'gym',
  'beauty',
  'bakery',
] as const;
export type TemplateCategory = (typeof templateCategories)[number];
export const categoryNames: Record<TemplateCategory, { ar: string; en: string }> = {
  general: { ar: 'عام', en: 'General' },
  cafe: { ar: 'كافيه', en: 'Cafe' },
  restaurant: { ar: 'مطعم', en: 'Restaurant' },
  barber: { ar: 'حلاق', en: 'Barber' },
  carwash: { ar: 'غسيل عربيات', en: 'Car wash' },
  workspace: { ar: 'مساحة عمل', en: 'Workspace' },
  gym: { ar: 'جيم', en: 'Gym' },
  beauty: { ar: 'تجميل وسبا', en: 'Beauty & spa' },
  bakery: { ar: 'مخبز وحلويات', en: 'Bakery & sweets' },
};
/**
 * One place per business type: the membership name printed on the card (web and Wallet) and the
 * symbol in the card's corner. Adding a business type starts here.
 */
export const categoryEditions: Record<TemplateCategory, { ar: string; en: string }> = {
  general: { ar: 'عضوية ولاء', en: 'Loyalty membership' },
  cafe: { ar: 'عضوية الكافيه', en: 'Café membership' },
  restaurant: { ar: 'عضوية المطعم', en: 'Dining membership' },
  barber: { ar: 'عضوية العناية', en: 'Grooming membership' },
  carwash: { ar: 'عضوية الغسيل', en: 'Car care membership' },
  workspace: { ar: 'عضوية مساحة العمل', en: 'Workspace membership' },
  gym: { ar: 'عضوية الجيم', en: 'Gym membership' },
  beauty: { ar: 'عضوية الجمال', en: 'Beauty membership' },
  bakery: { ar: 'عضوية المخبز', en: 'Bakery membership' },
};
export const categorySymbols: Record<TemplateCategory, StampIcon | null> = {
  general: null,
  cafe: 'coffee',
  restaurant: 'utensils',
  barber: 'scissors',
  carwash: 'car',
  workspace: 'laptop',
  gym: 'dumbbell',
  beauty: 'sparkle',
  bakery: 'cupcake',
};
export function templateCategory(template: CardTemplate): TemplateCategory {
  if (['cafe', 'espresso', 'latte', 'roastery', 'chalkboard'].includes(template)) return 'cafe';
  if (['carwash', 'detailing', 'foam'].includes(template)) return 'carwash';
  if (['restaurant', 'bistro', 'grill'].includes(template)) return 'restaurant';
  if (['barber', 'grooming', 'vintage'].includes(template)) return 'barber';
  if (['cowork', 'studio'].includes(template)) return 'workspace';
  if (['gym', 'pulse'].includes(template)) return 'gym';
  if (['salon', 'spa'].includes(template)) return 'beauty';
  if (['bakery', 'sweets'].includes(template)) return 'bakery';
  return 'general';
}
export function suggestedStamps(
  template: CardTemplate,
): { stampShape: StampShape; stampIcon: StampIcon; stampStyle: StampStyle } | undefined {
  const category = templateCategory(template);
  if (template === 'confetti')
    return { stampShape: 'circle', stampIcon: 'star', stampStyle: 'solid' };
  if (template === 'chalkboard')
    return { stampShape: 'circle', stampIcon: 'coffee', stampStyle: 'outline' };
  if (template === 'grill')
    return { stampShape: 'hexagon', stampIcon: 'flame', stampStyle: 'solid' };
  if (template === 'vintage')
    return { stampShape: 'seal', stampIcon: 'scissors', stampStyle: 'solid' };
  if (category === 'workspace')
    return {
      stampShape: 'rounded',
      stampIcon: 'laptop',
      stampStyle: template === 'studio' ? 'outline' : 'solid',
    };
  if (category === 'gym')
    return { stampShape: 'hexagon', stampIcon: 'dumbbell', stampStyle: 'solid' };
  if (category === 'beauty')
    return {
      stampShape: 'circle',
      stampIcon: 'sparkle',
      stampStyle: template === 'spa' ? 'outline' : 'solid',
    };
  if (category === 'bakery')
    return {
      stampShape: template === 'sweets' ? 'seal' : 'circle',
      stampIcon: 'cupcake',
      stampStyle: 'solid',
    };
  if (category === 'cafe')
    return {
      stampShape: template === 'espresso' || template === 'roastery' ? 'seal' : 'circle',
      stampIcon: template === 'roastery' ? 'bean' : 'coffee',
      stampStyle: 'solid',
    };
  if (category === 'carwash')
    return template === 'detailing'
      ? { stampShape: 'rounded', stampIcon: 'car', stampStyle: 'outline' }
      : { stampShape: 'circle', stampIcon: 'drop', stampStyle: 'solid' };
  if (category === 'restaurant')
    return {
      stampShape: template === 'bistro' ? 'rounded' : 'hexagon',
      stampIcon: 'utensils',
      stampStyle: 'solid',
    };
  if (category === 'barber')
    return {
      stampShape: template === 'grooming' ? 'rounded' : 'seal',
      stampIcon: 'scissors',
      stampStyle: 'outline',
    };
}
