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
] as const;
export type CardTemplate = (typeof cardTemplates)[number];
export const logoStyles = ['framed', 'plain'] as const;
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
};
export type TemplateCategory = 'general' | 'cafe' | 'restaurant' | 'barber';
export const categoryNames: Record<TemplateCategory, { ar: string; en: string }> = {
  general: { ar: 'عام', en: 'General' },
  cafe: { ar: 'كافيه', en: 'Cafe' },
  restaurant: { ar: 'مطعم', en: 'Restaurant' },
  barber: { ar: 'حلاق', en: 'Barber' },
};
export function templateCategory(template: CardTemplate): TemplateCategory {
  if (template === 'cafe' || template === 'espresso') return 'cafe';
  if (template === 'restaurant' || template === 'bistro') return 'restaurant';
  if (template === 'barber' || template === 'grooming') return 'barber';
  return 'general';
}
export function suggestedStamps(
  template: CardTemplate,
): { stampShape: StampShape; stampIcon: StampIcon; stampStyle: StampStyle } | undefined {
  const category = templateCategory(template);
  if (category === 'cafe')
    return {
      stampShape: template === 'espresso' ? 'seal' : 'circle',
      stampIcon: 'coffee',
      stampStyle: 'solid',
    };
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
