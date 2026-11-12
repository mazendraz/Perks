import { templateCategory, type CardTemplate } from '../../contracts/src/branding.js';

/**
 * One place that turns a shop's card design (template + colours) into Wallet colours and artwork.
 * Apple, Google and any future preview read from here, so a colour or template change is made once.
 * Values mirror the web card editions in apps/web/src/design.css.
 */
export type WalletArtKind = 'lines' | 'mosaic' | 'aurora' | 'ruled' | 'none';
export interface WalletTheme {
  /** Pass background, also the strip background, so the strip has no visible edge. */
  background: string;
  /** Field values and the shop name. */
  ink: string;
  /** Field captions. */
  label: string;
  /** Filled stamp colour and the glyph drawn on it. */
  stamp: string;
  stampInk: string;
  art: {
    kind: WalletArtKind;
    /** Line colour and opacity of the template's drawing behind the stamps. */
    color: string;
    opacity: number;
    rotate: number;
    scale: number;
    /** Botanical edition's leaf outline. */
    leaf: boolean;
  };
}
interface Edition {
  surface?: boolean;
  art: WalletArtKind;
  opacity: number;
  rotate?: number;
  scale?: number;
  brandArt?: boolean;
  leaf?: boolean;
}
// Same numbers as each `.loyalty-card.<template> .card-art` rule on the web card.
const editions: Record<CardTemplate, Edition> = {
  classic: { art: 'lines', opacity: 0.15 },
  minimal: { surface: true, art: 'lines', opacity: 0.06 },
  bold: { art: 'lines', opacity: 0.23, rotate: 30, scale: 1.3 },
  noir: { art: 'lines', opacity: 0.1, rotate: -15, scale: 1.6 },
  editorial: { surface: true, art: 'none', opacity: 0 },
  botanical: { art: 'lines', opacity: 0.18, rotate: 55, scale: 1.5, leaf: true },
  ticket: { surface: true, art: 'none', opacity: 0 },
  mosaic: { art: 'mosaic', opacity: 0.12 },
  aurora: { art: 'aurora', opacity: 0.32 },
  cafe: { art: 'lines', opacity: 0.12 },
  espresso: { surface: true, art: 'ruled', opacity: 0.12, brandArt: true },
  restaurant: { art: 'lines', opacity: 0.13 },
  bistro: { surface: true, art: 'lines', opacity: 0.09, brandArt: true },
  barber: { art: 'lines', opacity: 0.2 },
  grooming: { surface: true, art: 'lines', opacity: 0.09, brandArt: true },
};
const NOIR = { background: '#171c1b', ink: '#f5eedb', gold: '#d4b876' };

export const validHex = (value: string | null | undefined, fallback: string) =>
  value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
export function luminance(color: string) {
  const c = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
}
/** Same rule as the web card's `cardInk`. */
export function inkFor(color: string) {
  return luminance(color) > 0.179 ? '#132a26' : '#ffffff';
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m) as [number, number];
  return (x + 0.05) / (y + 0.05);
}
/** Mixes two #rrggbb colours. */
export function mix(a: string, b: string, amount: number) {
  const pa = parseInt(a.slice(1), 16),
    pb = parseInt(b.slice(1), 16);
  return (
    '#' +
    [16, 8, 0]
      .map((s) =>
        Math.round(((pa >> s) & 255) * (1 - amount) + ((pb >> s) & 255) * amount)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
const quietLabel = (ink: string, bg: string) => mix(ink, bg, ink === '#ffffff' ? 0.36 : 0.3);

export function walletTheme(card: {
  template?: CardTemplate | null;
  primary_color: string;
  accent_color: string;
  surface_color?: string | null;
}): WalletTheme {
  const template = card.template && card.template in editions ? card.template : 'classic',
    edition = editions[template],
    brand = validHex(card.primary_color, '#181b38'),
    accent = validHex(card.accent_color, '#cbff64');
  let background: string, ink: string, label: string, artColor: string;
  if (template === 'noir') {
    ({ background, ink } = NOIR);
    label = NOIR.gold;
    artColor = NOIR.ink;
  } else if (edition.surface) {
    background = validHex(card.surface_color, '#f5f5f1');
    ink = inkFor(background);
    // Light editions write their captions in the brand colour when it reads well on the paper.
    label = contrast(brand, background) >= 3 ? brand : quietLabel(ink, background);
    artColor = edition.brandArt ? brand : ink;
  } else {
    background = brand;
    ink = inkFor(brand);
    label = quietLabel(ink, brand);
    artColor = ink;
  }
  // Stamps use the shop's accent like the web card; if it would vanish into the card, use the brand.
  const stamp =
    contrast(accent, background) >= 1.4 ? accent : contrast(brand, background) >= 1.4 ? brand : ink;
  return {
    background,
    ink,
    label,
    stamp,
    stampInk: inkFor(stamp),
    art: {
      kind: edition.art,
      color: artColor,
      opacity: edition.opacity,
      rotate: edition.rotate ?? 0,
      scale: edition.scale ?? 1,
      leaf: !!edition.leaf,
    },
  };
}
export const walletArtCategory = (template?: CardTemplate | null) =>
  templateCategory(template && template in editions ? template : 'classic');
