import { createHash } from 'node:crypto';
import {
  cardTemplates,
  logoMarkBox,
  type StampShape,
} from '../../../../packages/contracts/src/branding.js';
import { stampGeometry, stampRandom } from '../../../../packages/domain/src/stamp-ink.js';
import { stampIconPaths } from '../../../../packages/domain/src/stamp-glyphs.js';
import type { WalletCard } from './apple-pass.js';
import { cardArtMarkup } from '../../../../packages/domain/src/card-art.js';
import {
  walletArtCategory,
  walletTheme,
  type WalletTheme,
} from '../../../../packages/domain/src/wallet-theme.js';

// Part of the design fingerprint (artworkSignature). Saved cards refresh by themselves whenever the
// drawing code changes, so bumping this is only needed to force a resend with no visible change.
export const WALLET_ARTWORK_VERSION = 'perks-card-9';
export { inkFor, mix } from '../../../../packages/domain/src/wallet-theme.js';

// Slot outlines in a 48-unit box centred on 0,0, the same frames as the web card's empty slots.
function shapePath(shape: StampShape, r = 22) {
  if (shape === 'hexagon') {
    const pts = Array.from({ length: 6 }, (_, i) => {
      const a = (i * Math.PI) / 3 - Math.PI / 2;
      return (Math.cos(a) * r).toFixed(2) + ' ' + (Math.sin(a) * r).toFixed(2);
    });
    return 'M' + pts.join(' L') + 'Z';
  }
  if (shape === 'seal') {
    const n = 28,
      pts = Array.from({ length: n * 2 }, (_, i) => {
        const a = (i * Math.PI) / n - Math.PI / 2,
          rr = i % 2 ? r * 0.9 : r;
        return (Math.cos(a) * rr).toFixed(2) + ' ' + (Math.sin(a) * rr).toFixed(2);
      });
    return 'M' + pts.join(' L') + 'Z';
  }
  if (shape === 'rounded' || shape === 'square') {
    const s = r * 0.92,
      k = shape === 'rounded' ? r * 0.42 : r * 0.12;
    return (
      `M${-s + k} ${-s}H${s - k}Q${s} ${-s} ${s} ${-s + k}V${s - k}Q${s} ${s} ${s - k} ${s}` +
      `H${-s + k}Q${-s} ${s} ${-s} ${s - k}V${-s + k}Q${-s} ${-s} ${-s + k} ${-s}Z`
    );
  }
  return `M${-r} 0A${r} ${r} 0 1 0 ${r} 0A${r} ${r} 0 1 0 ${-r} 0Z`;
}

/**
 * The reward slot is a gift box instead of a stamp, in a 48-unit box centred on 0,0.
 * Empty: a dashed outline like the other empty slots. Earned: filled in the stamp colour.
 */
function giftSlot(
  filled: boolean,
  o: { ink: string; accent: string; glyphInk: string; outline: boolean; dashOpacity: number },
) {
  const lid = 'M-20 -11.5H20V-2H-20Z',
    box = 'M-17 -2H17V21H-17Z',
    bow =
      'M0 -11.5C-3 -18 -11 -22 -13.5 -17.5C-15.5 -14 -9 -11.5 0 -11.5C9 -11.5 15.5 -14 13.5 -17.5C11 -22 3 -18 0 -11.5Z';
  if (!filled)
    return (
      `<g fill="none" stroke="${o.ink}" stroke-opacity="${o.dashOpacity}" stroke-width="1.3" stroke-linejoin="round">` +
      `<path d="${box}" stroke-dasharray="3 3"/><path d="${lid}" stroke-dasharray="3 3"/>` +
      `<path d="M0 -11.5V21"/><path d="${bow}"/></g>`
    );
  const fill = o.outline ? 'none' : o.accent,
    line = o.outline ? o.accent : o.glyphInk;
  return (
    `<g stroke-linejoin="round" filter="url(#gift-lift)">` +
    `<path d="${box}" fill="${fill}" stroke="${o.accent}" stroke-width="${o.outline ? 2.4 : 0}"/>` +
    `<path d="${lid}" fill="${fill}" stroke="${o.accent}" stroke-width="${o.outline ? 2.4 : 0}"/>` +
    `<path d="M-20 -2H20" stroke="${line}" stroke-opacity=".35" stroke-width="1.2"/>` +
    `<path d="M0 -11.5V21" stroke="${line}" stroke-width="3.2"/>` +
    `<path d="${bow}" fill="${fill}" stroke="${o.outline ? o.accent : line}" stroke-width="2"/>` +
    '</g>'
  );
}
const GIFT_LIFT =
  '<filter id="gift-lift" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="#000" flood-opacity=".22"/></filter>';
/**
 * Stamp grid for the Wallet strip. Wallet scales the strip to the pass width and may trim
 * its top and bottom, so stamps stay in a centred band and never touch the edges.
 * Up to 6 stamps sit on one row, up to 12 on two balanced rows, larger cards pack for size.
 */
export function stripLayout(total: number, height = 144, rtl = false) {
  const width = 375,
    padX = 34,
    padY = Math.round(height * 0.17);
  const safeW = width - padX * 2,
    safeH = height - padY * 2,
    gapRatio = 0.34;
  let rows = total <= 6 ? 1 : total <= 12 ? 2 : 0,
    columns = rows ? Math.ceil(total / rows) : 0,
    size = 0;
  const fit = (r: number, c: number) =>
    Math.min(safeW / (c + (c - 1) * gapRatio), safeH / (r + (r - 1) * gapRatio * 0.7), 52);
  if (!rows) {
    for (let r = 2; r <= 6; r++) {
      const c = Math.ceil(total / r),
        s = fit(r, c);
      if (s > size) [size, rows, columns] = [s, r, c];
    }
  } else size = rows === 1 ? Math.min(fit(1, Math.max(columns, 4)), 52) : fit(rows, columns);
  const pitchX = size * (1 + gapRatio),
    pitchY = size * (1 + gapRatio * 0.7);
  return Array.from({ length: total }, (_, i) => {
    const row = Math.floor(i / columns),
      col = i % columns;
    // Like the web grid: rows start from the reading side and a short last row stays there.
    const offset = (col + 0.5 - columns / 2) * pitchX;
    return {
      x: width / 2 + (rtl ? -offset : offset),
      y: height / 2 + (row + 0.5 - rows / 2) * pitchY,
      size,
    };
  });
}

/**
 * Pattern editions drawn over a whole W×H area: confetti pieces in the shop's two colours, or
 * soft horizontal waves. The same seed gives the same confetti every time.
 */
function patternArt(
  kind: 'dots' | 'waves',
  W: number,
  H: number,
  color: string,
  accent: string,
  opacity: number,
  seed = '',
) {
  const n = (value: number) => value.toFixed(2);
  if (kind === 'waves') {
    const step = 26,
      amp = 6;
    return Array.from({ length: Math.ceil(H / step) + 1 }, (_, i) => {
      const y = i * step;
      let d = `M-20 ${y}`;
      for (let x = -20; x < W + 40; x += 60) d += `q15 -${amp} 30 0t30 0`;
      return `<path d="${d}" fill="none" stroke="${color}" stroke-opacity="${n(opacity)}" stroke-width="1.6"/>`;
    }).join('');
  }
  const random = stampRandom('confetti:' + seed + W + 'x' + H),
    count = Math.round((W * H) / 2600);
  return Array.from({ length: count }, (_, i) => {
    const x = random() * W,
      y = random() * H,
      fill = i % 3 === 0 ? color : accent,
      alpha = n(i % 3 === 0 ? opacity * 0.8 : opacity * 1.3);
    return i % 2
      ? `<circle cx="${n(x)}" cy="${n(y)}" r="${n(2 + random() * 3)}" fill="${fill}" fill-opacity="${alpha}"/>`
      : `<rect x="${n(x)}" y="${n(y)}" width="${n(4 + random() * 6)}" height="2.6" rx="1.3" transform="rotate(${n(random() * 180)} ${n(x)} ${n(y)})" fill="${fill}" fill-opacity="${alpha}"/>`;
  }).join('');
}

/**
 * The card edition's own drawing (the same line art as the web card), placed as if the strip were
 * the middle band of the card. It fades out at the top and bottom so it melts into the pass colour.
 */
function artLayer(card: WalletCard, theme: WalletTheme, height: number, rtl: boolean) {
  const { kind, color, opacity, rotate, scale, leaf } = theme.art;
  if (kind === 'none' || opacity <= 0) return { defs: '', body: '' };
  const n = (value: number) => value.toFixed(2);
  // The web card is a 600×420 box; the strip is its width-matched middle band.
  const k = 375 / 600,
    top = (height - 420 * k) / 2;
  const onCard = (inner: string) =>
    `<g transform="translate(0 ${n(top)}) scale(${k}) translate(300 210) rotate(${rotate}) scale(${scale}) translate(-300 -210)">${inner}</g>`;
  const lines = (alpha: number) =>
    `<g fill="none" stroke="${color}" stroke-opacity="${n(alpha)}" stroke-width="1.9" stroke-linecap="round">${cardArtMarkup[walletArtCategory(card.template)]}</g>`;
  // Leaf outline of the Botanical edition, on the reading end like the web card.
  const leafPath = leaf
    ? `<path transform="rotate(18 ${rtl ? 66 : 534} 290)" d="${rtl ? 'M-100 550A333 517 0 0 1 233 33A333 517 0 0 1 -100 550Z' : 'M367 550A333 517 0 0 1 700 33A333 517 0 0 1 367 550Z'}" fill="none" stroke="${color}" stroke-opacity="${n(opacity * 1.2)}" stroke-width="1.9"/>`
    : '';
  let defs =
    `<linearGradient id="fade-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".24" stop-color="#fff"/><stop offset=".76" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<mask id="fade" maskUnits="userSpaceOnUse" x="0" y="0" width="375" height="${height}"><rect width="375" height="${height}" fill="url(#fade-g)"/></mask>`;
  let body = '';
  if (kind === 'lines') body = onCard(lines(opacity) + leafPath);
  else if (kind === 'mosaic') {
    // The web card's 45° conic tiles: a bow-tie in every 88-point cell.
    defs += `<pattern id="tiles" width="88" height="88" patternUnits="userSpaceOnUse"><path d="M0 0L44 44L0 88ZM88 0L44 44L88 88Z" fill="${color}" fill-opacity="${n(opacity)}"/></pattern>`;
    body = `<rect width="375" height="${height}" fill="url(#tiles)"/>`;
  } else if (kind === 'ruled') {
    // Espresso: fine vertical rules in the brand colour, plus the café drawing.
    defs += `<pattern id="rules" width="50" height="${height}" patternUnits="userSpaceOnUse"><rect x="25" width=".7" height="${height}" fill="${color}" fill-opacity="${n(opacity)}"/></pattern>`;
    body = `<rect width="375" height="${height}" fill="url(#rules)"/>` + onCard(lines(opacity));
  } else if (kind === 'dots' || kind === 'waves') {
    body = patternArt(kind, 375, height, color, theme.stamp, opacity, card.merchant_id);
  } else if (kind === 'aurora') {
    // Two soft accent lights on opposite sides, fading out inside the strip, with the line art barely there.
    defs += `<radialGradient id="aur" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${theme.stamp}" stop-opacity="${n(opacity * 1.4)}"/><stop offset="1" stop-color="${theme.stamp}" stop-opacity="0"/></radialGradient>`;
    body =
      `<ellipse cx="${rtl ? 70 : 305}" cy="${n(height * 0.36)}" rx="150" ry="${n(height * 0.46)}" fill="url(#aur)"/>` +
      `<ellipse cx="${rtl ? 305 : 70}" cy="${n(height * 0.64)}" rx="140" ry="${n(height * 0.44)}" fill="url(#aur)"/>` +
      onCard(lines(opacity * 0.2));
  }
  return { defs, body: `<g mask="url(#fade)">${body}</g>` };
}

/**
 * The shop logo as a large, faint mark: the "Your logo" edition. The owner picks the corner or
 * side and how much runs past the edge; the same box is used on the web card (logoMarkBox).
 */
function watermarkMarkup(
  logo: ArtworkLogo | null | undefined,
  card: WalletCard,
  W: number,
  H: number,
  opacity: number,
) {
  if (!logo) return '';
  const box = logoMarkBox(W, H, card.logo_mark_position, card.logo_mark_bleed ?? 0),
    k = Math.min(box.size / logo.width, box.size / logo.height),
    w = logo.width * k,
    h = logo.height * k;
  return `<image data-watermark="true" opacity="${opacity.toFixed(2)}" x="${(box.x + (box.size - w) / 2).toFixed(2)}" y="${(box.y + (box.size - h) / 2).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" href="${logo.href}"/>`;
}

export function stripSvg(
  card: WalletCard,
  scale: number,
  height = 144,
  rtl = false,
  watermark: ArtworkLogo | null = null,
) {
  const total = Math.max(2, Math.min(50, card.threshold)),
    filled = Math.max(0, Math.min(total, card.display_balance));
  const theme = walletTheme(card),
    bg = theme.background,
    accent = theme.stamp,
    ink = theme.ink,
    outline = card.stamp_style === 'outline',
    glyphInk = outline ? accent : theme.stampInk,
    art = artLayer(card, theme, height, rtl),
    shape = card.stamp_shape,
    icon = stampIconPaths[card.stamp_icon] ? card.stamp_icon : 'check';
  const n = (value: number) => value.toFixed(2);
  const outlinePath = shapePath(shape);
  const glyph = (path: string, stroke: string, width: number, k: number, opacity = 1) =>
    `<g transform="scale(${(k / 24).toFixed(4)}) translate(-12 -12)" fill="none" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></g>`;
  // Everything below mirrors the web card (packages/ui StampInk + StampFrame): a dashed frame for
  // an empty slot, the gift on the last one, and the same rough ink stamp for a filled one.
  const slots = stripLayout(total, height, rtl).map(({ x, y, size }, i) => {
    const open = `<g data-slot="${i + 1}" data-filled="${i < filled}" transform="translate(${n(x)} ${n(y)})">`;
    if (i === total - 1)
      return (
        open +
        `<g transform="scale(${(size / 48).toFixed(4)})">` +
        giftSlot(i < filled, { ink, accent, glyphInk, outline, dashOpacity: 0.3 }) +
        '</g></g>'
      );
    if (i >= filled)
      return (
        open +
        `<g transform="scale(${(size / 48).toFixed(4)})">` +
        `<path d="${outlinePath}" fill="none" stroke="${ink}" stroke-opacity=".25" stroke-width="1.3" stroke-dasharray="3 3"/>` +
        '</g></g>'
      );
    // The web ink sits in a 64-unit box that overhangs its slot by 2px on a 56px slot.
    const ink64 = stampGeometry(card.id + ':' + i, shape),
      k = (size * 60) / 56 / 64;
    return (
      open +
      `<g transform="scale(${k.toFixed(4)}) rotate(${n(ink64.angle)})">` +
      `<path d="${ink64.outer}" fill="${outline ? 'none' : accent}" stroke="${outline ? accent : 'none'}" stroke-width="${outline ? 2.6 : 0}"/>` +
      `<path d="${ink64.inner}" fill="none" stroke="${glyphInk}" stroke-opacity=".35" stroke-width="1.2"/>` +
      glyph(stampIconPaths[icon]!, glyphInk, icon === 'check' ? 2.6 : 1.7, 28) +
      ink64.specks
        .map(
          (p) =>
            `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(p.r)}" fill="${accent}" opacity=".8"/>`,
        )
        .join('') +
      '</g></g>'
    );
  });
  // Flat card colour, exactly the pass background, so the strip has no visible edge.
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${375 * scale}" height="${height * scale}" viewBox="0 0 375 ${height}">` +
    `<defs>${GIFT_LIFT}${art.defs}</defs>` +
    `<rect width="375" height="${height}" fill="${bg}"/>` +
    art.body +
    (theme.art.kind === 'logo'
      ? watermarkMarkup(watermark, card, 375, height, theme.art.opacity)
      : '') +
    slots.join('') +
    '</svg>'
  );
}

/**
 * iOS 27 "Poster Generic" pass: the whole card face is one artwork image (358×448 points).
 * Wallet draws the logo and the stamp count over the top band and the reward fields over a
 * material strip at the bottom, so the stamps live in the middle band between them.
 */
// Measured on an iOS 27 iPhone: the logo row ends near 45 points and the reward strip starts
// near 383 points, so the stamps get the band between them.
export interface CardFace {
  width: number;
  height: number;
  /** The stamps live between top and bottom; the rest is covered by Wallet's own text. */
  top: number;
  bottom: number;
  padX: number;
  /** Where Wallet's own reward strip starts, if it covers the bottom of the image. */
  visibleHeight?: number;
  /** Largest stamp, in face units. */
  maxStamp?: number;
}
export const POSTER: CardFace = {
  width: 358,
  height: 448,
  top: 74,
  bottom: 350,
  padX: 30,
  visibleHeight: 383,
};
/**
 * Google Wallet's large card image (1032×812 at 2×). Google writes the shop name and the
 * numbers above it, so the whole image is the card face.
 */
export const GOOGLE_HERO: CardFace = {
  width: 516,
  height: 406,
  top: 34,
  bottom: 384,
  padX: 40,
  maxStamp: 120,
};
/**
 * Apple Wallet strip (375×144 points) for iPhones before iOS 27, which cannot show the poster.
 * Everything sits in the band between `top` and `bottom`: at least 17% clear at the top and the
 * bottom, and still 17% clear if Wallet crops the strip to 375×123 around its middle.
 */
export const APPLE_STRIP = {
  width: 375,
  height: 144,
  top: 32,
  bottom: 112,
  padX: 24,
  /** Largest shop logo on the reading side. */
  logoWidth: 104,
  logoHeight: 52,
  /** Space between the logo and the stamps, with a thin divider in the middle. */
  gutter: 28,
  /** Room under the stamps for the progress line. */
  track: 14,
  maxStamp: 40,
} as const;
/** Where the shop logo sits on a poster that carries it, and where the stamps start below it. */
const LOGO_BOX = { y: 80, height: 58, maxWidth: 190, stampsTop: 152 };

/** Stamp grid for the poster: the web card's column rule, enlarged to fill the middle band. */
export function posterLayout(total: number, rtl = false, face: CardFace = POSTER) {
  const gap = 0.3,
    safeW = face.width - face.padX * 2,
    band = face.bottom - face.top - 26; // leave room for the progress line under the stamps
  const fit = (c: number) => {
    const r = Math.ceil(total / c);
    // Filled ink and its specks reach about 20% past the slot, so the grid is fitted with that margin.
    return {
      c,
      r,
      s:
        Math.min(safeW / (c + (c - 1) * gap), band / (r + (r - 1) * gap), face.maxStamp ?? 84) /
        1.22,
    };
  };
  // Same columns as the web card (two rows for 7–10, up to six per row), unless that leaves
  // the stamps much smaller than another arrangement would.
  const web = fit(total >= 7 && total <= 10 ? Math.ceil(total / 2) : Math.min(total, 6));
  let best = web;
  // A wide face (Google) never stacks the stamps into more rows than columns.
  const wide = face.width > face.height;
  for (let c = 2; c <= 10; c++) if (fit(c).s > best.s && !(wide && fit(c).r > c)) best = fit(c);
  const { c: columns, r: rows, s: size } = best.s > web.s * 1.25 ? best : web;
  const pitch = size * (1 + gap),
    centreY = face.top + band / 2;
  return {
    size,
    trackY: centreY + (rows * size + (rows - 1) * size * gap) / 2 + 22,
    slots: Array.from({ length: total }, (_, i) => {
      const row = Math.floor(i / columns),
        col = i % columns,
        offset = (col + 0.5 - columns / 2) * pitch;
      return {
        x: face.width / 2 + (rtl ? -offset : offset),
        y: centreY + (row + 0.5 - rows / 2) * pitch,
      };
    }),
  };
}

/**
 * The business type, drawn so it reads at a glance on a Wallet card: coffee beans and a cup for
 * cafés, a barber pole and scissors for barbers, a plate and cutlery for restaurants, bubbles and
 * a car for car washes. Drawn left-to-right; Arabic cards mirror it.
 */
function categoryMotif(
  category: ReturnType<typeof walletArtCategory>,
  template: string,
  theme: WalletTheme,
  face: CardFace,
  rtl: boolean,
  seed = '',
) {
  const { width: W, height: H } = face,
    c = theme.art.color,
    a = Math.min(0.3, Math.max(0.15, theme.art.opacity * 1.5)),
    n = (v: number) => v.toFixed(2),
    line = `fill="none" stroke="${c}" stroke-opacity="${n(a)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"`,
    // A drawing made in a 100-unit box, placed at (x, y) with width w.
    at = (x: number, y: number, w: number, inner: string) =>
      `<g transform="translate(${n(x)} ${n(y)}) scale(${n(w / 100)})">${inner}</g>`,
    icon = (x: number, y: number, w: number, d: string) =>
      `<g transform="translate(${n(x)} ${n(y)}) scale(${n(w / 24)})"><path d="${d}" ${line}/></g>`;
  // back: pieces fixed to the card (poles, frames, grids); body: the drawing each shop arranges.
  let body = '',
    back = '',
    defs = '';
  if (category === 'cafe') {
    const bean = (x: number, y: number, r: number, size: number) =>
      `<g transform="translate(${n(x)} ${n(y)}) rotate(${r}) scale(${n(size / 24)})"><path d="${stampIconPaths.bean}" ${line}/></g>`;
    if (template === 'chalkboard') {
      // A café menu board: a chalk frame, a steaming cup and a few beans, all in chalk strokes.
      back = `<rect x="${n(W * 0.04)}" y="${n(H * 0.04)}" width="${n(W * 0.92)}" height="${n(H * 0.92)}" rx="10" ${line} stroke-dasharray="7 4"/>`;
      body =
        `<g stroke-dasharray="7 4">` +
        at(
          W * 0.6,
          H * 0.5,
          W * 0.36,
          `<path d="M10 30h60v18c0 18-13 30-30 30S10 66 10 48Z M70 37h6a10 10 0 0 1 0 20h-7 M2 86h84 M28 22c-6-6 6-10 0-18 M42 22c-6-6 6-10 0-18 M56 22c-6-6 6-10 0-18" ${line}/>`,
        ) +
        bean(W * 0.14, H * 0.2, -25, Math.min(W, H) * 0.09) +
        bean(W * 0.86, H * 0.16, 30, Math.min(W, H) * 0.07) +
        '</g>';
    } else if (template === 'latte')
      // A latte seen from above: the cup rim, the saucer and a heart in the foam.
      body = at(
        W * 0.5,
        H * 0.44,
        W * 0.62,
        `<circle cx="40" cy="40" r="38" ${line}/><circle cx="40" cy="40" r="30" ${line}/><circle cx="40" cy="40" r="50" ${line} stroke-dasharray="2 6"/><path d="M78 34h10a8 8 0 0 1 0 16H78 M40 54C26 44 24 34 32 29c4-2 7 0 8 3 1-3 4-5 8-3 8 5 6 15-8 25Z" ${line}/>`,
      );
    else if (template === 'roastery')
      // Roasted beans spread over the whole card.
      body = Array.from({ length: 30 }, (_, i) => {
        const col = i % 5,
          row = Math.floor(i / 5);
        return bean(
          W * (0.1 + col * 0.2 + (row % 2) * 0.1),
          H * (0.08 + row * 0.16),
          ((i * 47) % 90) - 45,
          Math.min(W, H) * 0.08,
        );
      }).join('');
    else
      body =
        [
          [0.1, 0.2, -30],
          [0.24, 0.12, 25],
          [0.07, 0.42, 55],
          [0.88, 0.2, -15],
          [0.76, 0.1, 35],
          [0.16, 0.66, -20],
        ]
          .map(([x, y, r]) => bean(W * x!, H * y!, r!, Math.min(W, H) * 0.09))
          .join('') +
        at(
          W * 0.58,
          H * 0.5,
          W * 0.44,
          `<path d="M10 30h60v18c0 18-13 30-30 30S10 66 10 48Z M70 37h6a10 10 0 0 1 0 20h-7 M2 86h84 M28 22c-6-6 6-10 0-18 M42 22c-6-6 6-10 0-18 M56 22c-6-6 6-10 0-18" ${line}/>`,
        );
  } else if (category === 'barber' && template === 'vintage') {
    // Old-school barber shop: a double frame, slim poles on both sides and scissors.
    defs = `<pattern id="pole" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><rect width="6" height="18" fill="${theme.stamp}" fill-opacity=".5"/></pattern>`;
    const band = W * 0.035;
    back =
      `<rect x="0" width="${n(band)}" height="${H}" fill="url(#pole)"/><rect x="${n(W - band)}" width="${n(band)}" height="${H}" fill="url(#pole)"/>` +
      `<rect x="${n(W * 0.07)}" y="${n(H * 0.05)}" width="${n(W * 0.86)}" height="${n(H * 0.9)}" rx="6" ${line}/>` +
      `<rect x="${n(W * 0.095)}" y="${n(H * 0.07)}" width="${n(W * 0.81)}" height="${n(H * 0.86)}" rx="4" ${line} stroke-dasharray="1 5"/>`;
    body = icon(W * 0.4, H * 0.6, W * 0.2, stampIconPaths.scissors);
  } else if (category === 'barber') {
    // The barber pole: red, white and blue stripes along the leading edge.
    defs = `<pattern id="pole" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(38)"><rect width="9" height="26" fill="${theme.stamp}" fill-opacity=".55"/><rect x="13" width="9" height="26" fill="${c}" fill-opacity="${n(a * 0.9)}"/></pattern>`;
    const bandW = template === 'grooming' ? 0 : W * 0.075;
    if (bandW)
      back =
        `<rect x="0" y="0" width="${n(bandW)}" height="${H}" fill="url(#pole)"/>` +
        `<path d="M${n(bandW)} 0V${H}" ${line}/>`;
    body =
      (bandW
        ? ''
        : // Grooming studio: a straight razor in place of the pole.
          at(
            W * 0.04,
            H * 0.56,
            W * 0.4,
            `<path d="M4 40h52l8-8h30v10H64l-8 8H4Z M10 40v10" ${line}/>`,
          )) +
      icon(W * 0.62, H * 0.5, W * 0.3, stampIconPaths.scissors) +
      at(
        W * 0.66,
        H * 0.16,
        W * 0.26,
        `<path d="M4 20h92v14H4Z M10 34v24 M20 34v24 M30 34v24 M40 34v24 M50 34v24 M60 34v24 M70 34v24 M80 34v24 M90 34v24" ${line}/>`,
      );
  } else if (category === 'restaurant' && template === 'grill') {
    // Grill house: the marks of a grill across the card and flames along the bottom.
    body =
      Array.from(
        { length: 9 },
        (_, i) =>
          `<path d="M${n(-W * 0.2 + i * W * 0.17)} ${n(H * 0.06)}l${n(W * 0.5)} ${n(H * 0.5)}" ${line}/>`,
      ).join('') +
      [0.12, 0.34, 0.56, 0.78]
        .map((x) => icon(W * x, H * 0.62, W * 0.13, stampIconPaths.flame))
        .join('');
  } else if (category === 'restaurant') {
    const cx = W * 0.82,
      cy = H * 0.6,
      r = Math.min(W, H) * 0.3;
    body =
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" ${line}/>` +
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.78)}" ${line}/>` +
      `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r * 0.62)}" ${line} stroke-dasharray="2 7"/>` +
      icon(W * 0.04, H * 0.18, W * 0.26, stampIconPaths.utensils);
    back =
      (template === 'bistro'
        ? Array.from(
            { length: 12 },
            (_, i) =>
              `<rect x="${n((W / 12) * i)}" y="0" width="${n(W / 24)}" height="${n(H * 0.05)}" fill="${c}" fill-opacity="${n(a * 0.8)}"/>`,
          ).join('')
        : '') +
      `<path d="M${n(W * 0.06)} ${n(H * 0.08)}H${n(W * 0.94)}" ${line} stroke-dasharray="1 8"/>`;
  } else if (category === 'carwash') {
    const bubble = (x: number, y: number, r: number) =>
      `<circle cx="${n(x)}" cy="${n(y)}" r="${n(r)}" ${line}/><path d="M${n(x - r * 0.55)} ${n(y - r * 0.15)}a${n(r * 0.6)} ${n(r * 0.6)} 0 0 1 ${n(r * 0.45)} -${n(r * 0.45)}" ${line}/>`;
    const u = Math.min(W, H),
      sparkle = (x: number, y: number, r: number) =>
        `<path d="M${n(x)} ${n(y - r)}Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)}Q${n(x)} ${n(y)} ${n(x)} ${n(y + r)}Q${n(x)} ${n(y)} ${n(x - r)} ${n(y)}Q${n(x)} ${n(y)} ${n(x)} ${n(y - r)}Z" ${line}/>`;
    if (template === 'foam') {
      // Foam: bubbles of every size all over the card.
      const random = stampRandom('foam:' + seed + W + 'x' + H);
      body = Array.from({ length: 26 }, () =>
        bubble(random() * W, random() * H, u * (0.02 + random() * 0.07)),
      ).join('');
    } else if (template === 'detailing')
      // Detailing: a polished shine, sparkles and long reflection lines.
      body =
        [
          [0.14, 0.18, 0.06],
          [0.27, 0.1, 0.03],
          [0.86, 0.22, 0.05],
          [0.9, 0.42, 0.03],
        ]
          .map(([x, y, r]) => sparkle(W * x!, H * y!, u * r!))
          .join('') +
        [0.62, 0.68, 0.74]
          .map(
            (y, i) => `<path d="M${n(W * (0.08 + i * 0.1))} ${n(H * y)}H${n(W * 0.92)}" ${line}/>`,
          )
          .join('') +
        icon(W * 0.6, H * 0.46, W * 0.3, stampIconPaths.car);
    else
      body =
        [
          [0.12, 0.2, 0.07],
          [0.26, 0.1, 0.035],
          [0.84, 0.16, 0.06],
          [0.72, 0.08, 0.03],
          [0.92, 0.38, 0.035],
          [0.06, 0.48, 0.045],
        ]
          .map(([x, y, r]) => bubble(W * x!, H * y!, u * r!))
          .join('') +
        icon(W * 0.36, H * 0.48, W * 0.62, stampIconPaths.car) +
        `<path d="M0 ${n(H * 0.8)}c${n(W * 0.17)} -${n(H * 0.04)} ${n(W * 0.33)} ${n(H * 0.04)} ${n(W * 0.5)} 0s${n(W * 0.33)} ${n(H * 0.04)} ${n(W * 0.5)} 0" ${line}/>`;
  }
  if (category === 'workspace') {
    // Workspace: grid paper (or a dotted blueprint for Studio), a laptop and a desk lamp.
    const grid = template === 'studio' ? 'dots' : 'lines';
    defs =
      grid === 'dots'
        ? `<pattern id="grid" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r="1.3" fill="${c}" fill-opacity="${n(a)}"/></pattern>`
        : `<pattern id="grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="${c}" stroke-opacity="${n(a * 0.45)}" stroke-width="1"/></pattern>`;
    back = `<rect width="${W}" height="${H}" fill="url(#grid)"/>`;
    body =
      icon(W * 0.56, H * 0.52, W * 0.4, stampIconPaths.laptop) +
      at(
        W * 0.06,
        H * 0.5,
        W * 0.3,
        `<path d="M20 96V40l40-16M60 24c0 14 16 22 28 12M4 96h40" ${line}/>`,
      );
  } else if (category === 'gym') {
    if (template === 'pulse')
      // Pulse: a heart-rate line across the card and a heart.
      body =
        `<path d="M0 ${n(H * 0.72)}H${n(W * 0.3)}l${n(W * 0.06)} -${n(H * 0.12)} ${n(W * 0.08)} ${n(H * 0.24)} ${n(W * 0.07)} -${n(H * 0.18)} ${n(W * 0.05)} ${n(H * 0.06)}H${W}" ${line}/>` +
        icon(W * 0.72, H * 0.08, W * 0.22, stampIconPaths.heart);
    else
    // Power: bold diagonal stripes in a corner and a big dumbbell.
    {
      back = Array.from(
        { length: 6 },
        (_, i) =>
          `<path d="M${n(W * (0.55 + i * 0.08))} 0L${n(W)} ${n(H * (0.45 - i * 0.08))}" stroke="${theme.stamp}" stroke-opacity=".35" stroke-width="7"/>`,
      ).join('');
      body = icon(W * 0.1, H * 0.5, W * 0.5, stampIconPaths.dumbbell);
    }
  } else if (category === 'beauty') {
    const leaves = at(
      W * 0.62,
      H * 0.42,
      W * 0.38,
      `<path d="M30 98C30 60 50 30 90 14M30 70c-14-6-20-20-16-34 14 4 20 18 16 34M44 46c4-14 18-20 32-16-4 14-18 20-32 16" ${line}/>`,
    );
    body =
      template === 'spa'
        ? // Spa: stacked stones and leaves.
          leaves +
          at(
            W * 0.08,
            H * 0.52,
            W * 0.34,
            `<ellipse cx="50" cy="88" rx="40" ry="10" ${line}/><ellipse cx="50" cy="68" rx="30" ry="9" ${line}/><ellipse cx="50" cy="51" rx="21" ry="7" ${line}/><ellipse cx="50" cy="38" rx="13" ry="5" ${line}/>`,
          )
        : // Salon: sparkles and a hand mirror.
          leaves +
          [
            [0.12, 0.16, 0.12],
            [0.3, 0.08, 0.07],
            [0.86, 0.12, 0.09],
          ]
            .map(([x, y, w]) => icon(W * x!, H * y!, W * w!, stampIconPaths.sparkle))
            .join('') +
          at(
            W * 0.08,
            H * 0.5,
            W * 0.22,
            `<circle cx="40" cy="34" r="30" ${line}/><circle cx="40" cy="34" r="22" ${line}/><path d="M40 64v34" ${line}/>`,
          );
  } else if (category === 'bakery') {
    if (template === 'sweets') {
      // Sweets: cupcakes and sprinkles.
      const random = stampRandom('sweets:' + seed + W + 'x' + H);
      body =
        Array.from({ length: 34 }, (_, i) => {
          const x = random() * W,
            y = random() * H;
          return `<rect x="${n(x)}" y="${n(y)}" width="7" height="2.6" rx="1.3" transform="rotate(${n(random() * 180)} ${n(x)} ${n(y)})" fill="${i % 2 ? theme.stamp : c}" fill-opacity="${n(i % 2 ? a * 1.6 : a)}"/>`;
        }).join('') +
        icon(W * 0.62, H * 0.5, W * 0.3, stampIconPaths.cupcake) +
        icon(W * 0.06, H * 0.12, W * 0.18, stampIconPaths.cupcake);
    } else
      // Bakery: wheat stalks and a croissant.
      body =
        at(
          W * 0.74,
          H * 0.06,
          W * 0.2,
          `<path d="M50 160V10M50 40c-14-8-20-22-16-36 14 4 20 18 16 36M50 40c14-8 20-22 16-36-14 4-20 18-16 36M50 74c-14-8-20-22-16-36 14 4 20 18 16 36M50 74c14-8 20-22 16-36-14 4-20 18-16 36M50 108c-14-8-20-22-16-36 14 4 20 18 16 36M50 108c14-8 20-22 16-36-14 4-20 18-16 36" ${line}/>`,
        ) +
        at(
          W * 0.08,
          H * 0.56,
          W * 0.46,
          `<path d="M6 60C14 22 86 22 94 60c-20-10-34-10-44 0-10-10-24-10-44 0Z M30 34l8 22M50 30v24M70 34l-8 22" ${line}/>`,
        );
  }
  if (!body && !back) return { defs: '', back: '', body: '' };
  const mirror = (x: string) =>
    rtl && x ? `<g transform="translate(${W} 0) scale(-1 1)">${x}</g>` : x;
  return { defs, back: mirror(back), body: mirror(body) };
}

/** The edition's artwork drawn over the whole poster, like the web card. */
/**
 * Each shop gets its own arrangement of the edition's drawing, worked out from the shop's id:
 * mirrored or not, a little larger or smaller, moved and turned. Two shops on the same template and colours
 * still get different cards; one shop always gets the same card.
 */
export function artVariation(seed: string, W: number, H: number) {
  const random = stampRandom('art-layout:' + seed),
    mirror = random() < 0.5,
    // Small enough that the drawing always stays recognisable on the card.
    k = 0.92 + random() * 0.16,
    dx = (random() - 0.5) * 0.14 * W,
    dy = (random() - 0.5) * 0.1 * H,
    turn = (random() - 0.5) * 12;
  const n = (v: number) => v.toFixed(2);
  return `translate(${n(W / 2 + dx)} ${n(H / 2 + dy)}) rotate(${n(turn)}) scale(${n(mirror ? -k : k)} ${n(k)}) translate(${n(-W / 2)} ${n(-H / 2)})`;
}
function posterArt(card: WalletCard, theme: WalletTheme, rtl: boolean, face: CardFace) {
  const art = posterArtBase(card, theme, rtl, face),
    seed = card.merchant_id || card.id || 'perks';
  return {
    defs: art.defs,
    body:
      art.back +
      (art.body
        ? `<g data-variation="true" transform="${artVariation(seed, face.width, face.height)}">${art.body}</g>`
        : ''),
  };
}
function posterArtBase(card: WalletCard, theme: WalletTheme, rtl: boolean, face: CardFace) {
  const { kind, color, opacity, rotate, scale, leaf } = theme.art,
    { width: W, height: H } = face;
  // The "Your logo" edition draws only the logo (watermarkMarkup), no edition drawing.
  if (kind === 'none' || kind === 'logo' || opacity <= 0) return { defs: '', back: '', body: '' };
  const n = (value: number) => value.toFixed(2);
  // The 600×420 web art box, scaled to the poster height and centred.
  const k = H / 420,
    dx = (W - 600 * k) / 2;
  const onCard = (inner: string) =>
    `<g transform="translate(${n(dx)} 0) scale(${n(k)})${rtl ? ' translate(600 0) scale(-1 1)' : ''} translate(300 210) rotate(${rotate}) scale(${scale}) translate(-300 -210)">${inner}</g>`;
  const lines = (alpha: number) =>
    `<g fill="none" stroke="${color}" stroke-opacity="${n(alpha)}" stroke-width="1.6" stroke-linecap="round">${cardArtMarkup[walletArtCategory(card.template)]}</g>`;
  const rules = {
    defs: `<pattern id="rules" width="50" height="${H}" patternUnits="userSpaceOnUse"><rect x="25" width=".7" height="${H}" fill="${color}" fill-opacity="${n(opacity)}"/></pattern>`,
    body: `<rect width="${W}" height="${H}" fill="url(#rules)"/>`,
  };
  // Business templates draw their business, large enough to recognise on the phone.
  const category = walletArtCategory(card.template);
  if (category !== 'general') {
    const motif = categoryMotif(
      category,
      card.template ?? 'classic',
      theme,
      face,
      rtl,
      card.merchant_id || card.id || '',
    );
    return kind === 'ruled'
      ? { defs: rules.defs + motif.defs, back: rules.body + motif.back, body: motif.body }
      : motif;
  }
  const leafPath = leaf
    ? `<path transform="rotate(18 534 290)" d="M367 550A333 517 0 0 1 700 33A333 517 0 0 1 367 550Z" fill="none" stroke="${color}" stroke-opacity="${n(opacity * 1.2)}" stroke-width="1.6"/>`
    : '';
  if (kind === 'lines') return { defs: '', back: '', body: onCard(lines(opacity) + leafPath) };
  // Full-card patterns stay in place; confetti is scattered differently for every shop.
  if (kind === 'dots' || kind === 'waves')
    return {
      defs: '',
      back: patternArt(kind, W, H, color, theme.stamp, opacity, card.merchant_id || card.id),
      body: '',
    };
  if (kind === 'mosaic')
    return {
      defs: `<pattern id="tiles" width="88" height="88" patternUnits="userSpaceOnUse"><path d="M0 0L44 44L0 88ZM88 0L44 44L88 88Z" fill="${color}" fill-opacity="${n(opacity)}"/></pattern>`,
      back: `<rect width="${W}" height="${H}" fill="url(#tiles)"/>`,
      body: '',
    };
  if (kind === 'ruled') return { defs: rules.defs, back: rules.body, body: onCard(lines(opacity)) };
  // aurora: two soft accent lights on opposite corners, with the line art barely there.
  return {
    back: '',
    defs: `<radialGradient id="aur" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${theme.stamp}" stop-opacity="${n(opacity * 1.3)}"/><stop offset="1" stop-color="${theme.stamp}" stop-opacity="0"/></radialGradient>`,
    body:
      `<ellipse cx="${n(rtl ? W * 0.2 : W * 0.8)}" cy="${n(H * 0.27)}" rx="${n(W * 0.53)}" ry="${n(H * 0.38)}" fill="url(#aur)"/>` +
      `<ellipse cx="${n(rtl ? W * 0.8 : W * 0.2)}" cy="${n(H * 0.74)}" rx="${n(W * 0.5)}" ry="${n(H * 0.36)}" fill="url(#aur)"/>` +
      onCard(lines(opacity * 0.2)),
  };
}

/** A PNG already sized for the logo slot, as a data URL plus its aspect. */
export interface ArtworkLogo {
  href: string;
  width: number;
  height: number;
}
/**
 * The stamp slots, the same as the web card (packages/ui StampInk + StampFrame): a dashed frame
 * for an empty slot, the gift on the last one, and the rough ink stamp for a filled one.
 */
function stampSlots(
  card: WalletCard,
  theme: WalletTheme,
  positions: { x: number; y: number }[],
  size: number,
  emptyOpacity: number,
  dashOpacity: number,
) {
  const total = Math.max(2, Math.min(50, card.threshold)),
    filled = Math.max(0, Math.min(total, card.display_balance)),
    accent = theme.stamp,
    ink = theme.ink,
    outline = card.stamp_style === 'outline',
    glyphInk = outline ? accent : theme.stampInk,
    shape = card.stamp_shape,
    icon = stampIconPaths[card.stamp_icon] ? card.stamp_icon : 'check';
  const n = (value: number) => value.toFixed(2);
  const glyph = (path: string, stroke: string, width: number, k: number, opacity = 1) =>
    `<g transform="scale(${(k / 24).toFixed(4)}) translate(-12 -12)" fill="none" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></g>`;
  return positions.map(({ x, y }, i) => {
    const open = `<g data-slot="${i + 1}" data-filled="${i < filled}" transform="translate(${n(x)} ${n(y)})">`;
    if (i === total - 1)
      return (
        open +
        `<g transform="scale(${(size / 48).toFixed(4)})">` +
        giftSlot(i < filled, { ink, accent, glyphInk, outline, dashOpacity }) +
        '</g></g>'
      );
    if (i >= filled)
      return (
        open +
        `<g transform="scale(${(size / 48).toFixed(4)})">` +
        `<path d="${shapePath(shape)}" fill="none" stroke="${ink}" stroke-opacity="${String(emptyOpacity).replace(/^0/, '')}" stroke-width="1.2" stroke-dasharray="3 3"/>` +
        '</g></g>'
      );
    const g = stampGeometry(card.id + ':' + i, shape),
      k = (size * 60) / 56 / 64;
    return (
      open +
      `<g transform="scale(${k.toFixed(4)}) rotate(${n(g.angle)})">` +
      `<path d="${g.outer}" fill="${outline ? 'none' : accent}" stroke="${outline ? accent : 'none'}" stroke-width="${outline ? 2.6 : 0}"/>` +
      `<path d="${g.inner}" fill="none" stroke="${glyphInk}" stroke-opacity=".35" stroke-width="1.2"/>` +
      glyph(stampIconPaths[icon]!, glyphInk, icon === 'check' ? 2.6 : 1.7, 28) +
      g.specks
        .map(
          (p) =>
            `<circle cx="${n(p.x)}" cy="${n(p.y)}" r="${n(p.r)}" fill="${accent}" opacity=".8"/>`,
        )
        .join('') +
      '</g></g>'
    );
  });
}
function appleCardNumber(card: WalletCard, theme: WalletTheme, x: number, y: number) {
  if (!card.active || !card.card_number || !/^[0-9]{6}$/.test(card.card_number)) return '';
  return (
    `<g data-card-number="true"><rect x="${x - 44}" y="${y - 11}" width="49" height="15" rx="4" fill="${theme.background}"/>` +
    `<text x="${x}" y="${y}" text-anchor="end" font-family="sans-serif" font-size="10" fill="${theme.ink}">${card.card_number}</text></g>`
  );
}

export function posterArtworkSvg(
  card: WalletCard,
  scale: number,
  rtl = false,
  options: {
    face?: CardFace;
    logo?: ArtworkLogo | null;
    watermark?: ArtworkLogo | null;
    includeAppleCardNumber?: boolean;
  } = {},
) {
  const face = options.face ?? POSTER,
    logo = options.logo ?? null,
    // With the shop logo on the card, the stamps start below it.
    stampsFace = logo ? { ...face, top: LOGO_BOX.stampsTop } : face;
  const total = Math.max(2, Math.min(50, card.threshold)),
    filled = Math.max(0, Math.min(total, card.display_balance));
  const theme = walletTheme(card),
    { width: W, height: H } = face,
    accent = theme.stamp,
    ink = theme.ink,
    art = posterArt(card, theme, rtl, face),
    layout = posterLayout(total, rtl, stampsFace);
  const n = (value: number) => value.toFixed(2);
  const slots = stampSlots(card, theme, layout.slots, layout.size, 0.28, 0.32);
  // The web card's progress line under the stamps, filled from the reading side.
  const trackX = face.padX,
    trackW = W - face.padX * 2,
    done = trackW * (filled / total);
  const track =
    `<rect x="${trackX}" y="${n(layout.trackY)}" width="${trackW}" height="2.4" rx="1.2" fill="${ink}" fill-opacity=".14"/>` +
    (done > 0
      ? `<rect x="${n(rtl ? trackX + trackW - done : trackX)}" y="${n(layout.trackY)}" width="${n(done)}" height="2.4" rx="1.2" fill="${accent}"/>`
      : '');
  // The shop logo, large and centred under Wallet's own header, like the web card's brand mark.
  let logoMarkup = '';
  if (logo) {
    const k = Math.min(LOGO_BOX.height / logo.height, LOGO_BOX.maxWidth / logo.width),
      w = logo.width * k,
      h = logo.height * k;
    logoMarkup = `<image data-logo="true" x="${n((W - w) / 2)}" y="${n(LOGO_BOX.y + (LOGO_BOX.height - h) / 2)}" width="${n(w)}" height="${n(h)}" href="${logo.href}"/>`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}">` +
    `<defs>${GIFT_LIFT}${art.defs}</defs><rect width="${W}" height="${H}" fill="${theme.background}"/>` +
    art.body +
    (theme.art.kind === 'logo'
      ? watermarkMarkup(
          options.watermark,
          card,
          face.width,
          face.visibleHeight ?? face.height,
          theme.art.opacity,
        )
      : '') +
    logoMarkup +
    slots.join('') +
    track +
    (options.includeAppleCardNumber ? appleCardNumber(card, theme, W - 18, 369) : '') +
    '</svg>'
  );
}

/** Google Wallet's large card image: the same card face as the Apple poster, in Google's shape. */
export function googleHeroSvg(
  card: WalletCard,
  scale: number,
  rtl = false,
  watermark: ArtworkLogo | null = null,
) {
  return posterArtworkSvg(card, scale, rtl, { face: GOOGLE_HERO, watermark });
}

/**
 * Where the strip puts the logo and the stamps, in left-to-right order (Arabic mirrors it).
 * The stamps use as many rows as make them largest, inside the safe band.
 */
export function appleStripLayout(total: number, logo: { width: number; height: number } | null) {
  const S = APPLE_STRIP,
    gap = 0.3,
    // Filled ink and its specks reach past the slot; fit the grid with that margin.
    overhang = 1.18;
  let logoBox: { x: number; y: number; width: number; height: number } | null = null,
    left = S.padX;
  if (logo) {
    const k = Math.min(S.logoHeight / logo.height, S.logoWidth / logo.width),
      width = logo.width * k,
      height = logo.height * k;
    logoBox = { x: S.padX, y: (S.top + S.bottom) / 2 - height / 2, width, height };
    left = S.padX + width + S.gutter;
  }
  const areaW = S.width - S.padX - left,
    areaH = S.bottom - S.top - S.track;
  let best = { rows: 1, columns: total, size: 0 };
  for (let rows = 1; rows <= 6; rows++) {
    const columns = Math.ceil(total / rows),
      size =
        Math.min(
          areaW / (columns + (columns - 1) * gap),
          areaH / (rows + (rows - 1) * gap),
          S.maxStamp * overhang,
        ) / overhang;
    // A new row has to make the stamps clearly larger, so short cards stay on one line.
    if (size > best.size * 1.08) best = { rows, columns, size };
  }
  const { rows, columns, size } = best,
    pitch = size * (1 + gap),
    gridW = columns * size + (columns - 1) * size * gap,
    gridH = rows * size + (rows - 1) * size * gap,
    centreX = left + areaW / 2,
    gridTop = S.top + (areaH - gridH) / 2;
  return {
    logo: logoBox,
    divider: logo ? S.padX + logoBox!.width + S.gutter / 2 : null,
    size,
    track: {
      x: centreX - gridW / 2,
      width: gridW,
      y: Math.min(S.bottom - 3, gridTop + gridH + size * 0.18 + 8),
    },
    slots: Array.from({ length: total }, (_, i) => {
      const row = Math.floor(i / columns),
        col = i % columns;
      return {
        x: centreX + (col + 0.5 - columns / 2) * pitch,
        y: gridTop + size / 2 + row * pitch,
      };
    }),
  };
}

/**
 * The storeCard strip for iOS 26 and earlier. It is drawn for the strip, not cut from the
 * poster: the card colour with a soft glow like the poster's light, the shop logo large on the
 * reading side, the stamps with the gift, and the progress line. No business drawing, which
 * does not fit a strip this short. Arabic mirrors everything, stamps filling from the right.
 */
export function appleStripSvg(
  card: WalletCard,
  scale: number,
  rtl = false,
  logo: ArtworkLogo | null = null,
) {
  const S = APPLE_STRIP,
    W = S.width,
    H = S.height;
  const total = Math.max(2, Math.min(50, card.threshold)),
    filled = Math.max(0, Math.min(total, card.display_balance)),
    theme = walletTheme(card),
    layout = appleStripLayout(total, logo),
    n = (value: number) => value.toFixed(2),
    flip = (x: number) => (rtl ? W - x : x);
  // The glow fades to the exact card colour before every edge, so the strip has no visible seam.
  const stampsX = flip(layout.track.x + layout.track.width / 2),
    logoX = layout.logo ? flip(layout.logo.x + layout.logo.width / 2) : null;
  const defs =
    GIFT_LIFT +
    `<radialGradient id="strip-glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${theme.stamp}" stop-opacity=".22"/><stop offset=".6" stop-color="${theme.stamp}" stop-opacity=".08"/><stop offset="1" stop-color="${theme.stamp}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="strip-light" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${theme.ink}" stop-opacity=".09"/><stop offset="1" stop-color="${theme.ink}" stop-opacity="0"/></radialGradient>`;
  const glow =
    `<ellipse cx="${n(stampsX)}" cy="${H / 2}" rx="${n(Math.max(120, layout.track.width / 2 + 60))}" ry="${n(H * 0.42)}" fill="url(#strip-glow)"/>` +
    // A soft light behind the logo on dark cards; on a light card the same glow reads as a smudge.
    (logoX === null || theme.ink !== '#ffffff'
      ? ''
      : `<ellipse cx="${n(logoX)}" cy="${H / 2}" rx="${n(layout.logo!.width / 2 + 40)}" ry="${n(H * 0.4)}" fill="url(#strip-light)"/>`);
  let logoMarkup = '';
  if (logo && layout.logo) {
    const box = layout.logo,
      x = rtl ? W - box.x - box.width : box.x;
    logoMarkup =
      `<image data-logo="true" x="${n(x)}" y="${n(box.y)}" width="${n(box.width)}" height="${n(box.height)}" href="${logo.href}"/>` +
      `<path data-divider="true" d="M${n(flip(layout.divider!))} ${S.top + 8}V${S.bottom - 8}" stroke="${theme.ink}" stroke-opacity=".16" stroke-width="1"/>`;
  }
  const slots = stampSlots(
    card,
    theme,
    layout.slots.map(({ x, y }) => ({ x: flip(x), y })),
    layout.size,
    0.3,
    0.34,
  );
  const t = layout.track,
    done = t.width * (filled / total),
    trackX = rtl ? W - t.x - t.width : t.x;
  const track =
    `<rect data-track="true" x="${n(trackX)}" y="${n(t.y)}" width="${n(t.width)}" height="3" rx="1.5" fill="${theme.ink}" fill-opacity=".14"/>` +
    (done > 0
      ? `<rect x="${n(rtl ? trackX + t.width - done : trackX)}" y="${n(t.y)}" width="${n(done)}" height="3" rx="1.5" fill="${theme.stamp}"/>`
      : '');
  // A closed card keeps its stamps, faded, so it reads as no longer in use.
  const body = slots.join('') + track;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W * scale}" height="${H * scale}" viewBox="0 0 ${W} ${H}">` +
    `<defs>${defs}</defs><rect width="${W}" height="${H}" fill="${theme.background}"/>` +
    glow +
    logoMarkup +
    (card.active ? body : `<g data-closed="true" opacity=".4">${body}</g>`) +
    appleCardNumber(card, theme, W - 18, 126) +
    '</svg>'
  );
}

let artworkSignatureCache: string | null = null;
/**
 * A fingerprint of how the Wallet artwork is drawn today: every edition, in both reading
 * directions, on the iOS 27 poster, the older-iPhone strip and the Google card. Any change to the
 * drawing code changes it, with no version number to remember to bump. Cards already saved in
 * Wallet are re-sent when it changes, and Google gets a new image address.
 */
export function artworkSignature() {
  if (artworkSignatureCache) return artworkSignatureCache;
  const hash = createHash('sha256').update(WALLET_ARTWORK_VERSION);
  for (const template of cardTemplates)
    for (const [threshold, balance] of [
      [8, 3],
      [12, 12],
    ] as const) {
      const card: WalletCard = {
        id: '00000000-0000-4000-8000-00000000d351',
        merchant_id: '00000000-0000-4000-8000-00000000d352',
        merchant_name: 'Perks',
        program_name: 'Perks',
        threshold,
        display_balance: balance,
        pending_rewards: balance >= threshold ? 1 : 0,
        primary_color: '#204E43',
        accent_color: '#D4B56A',
        template,
        stamp_shape: 'seal',
        stamp_icon: 'coffee',
        stamp_style: 'solid',
        reward_title: 'Perks',
        reward_terms: '',
        active: true,
        earning_active: true,
      };
      for (const rtl of [false, true])
        hash
          .update(posterArtworkSvg(card, 1, rtl))
          .update(appleStripSvg(card, 1, rtl))
          .update(googleHeroSvg(card, 1, rtl))
          .update(stripSvg(card, 1, 144, rtl));
    }
  return (artworkSignatureCache = hash.digest('hex').slice(0, 16));
}
