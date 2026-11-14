import type { StampShape } from '../../../../packages/contracts/src/branding.js';
import { stampGeometry } from '../../../../packages/domain/src/stamp-ink.js';
import { stampIconPaths } from '../../../../packages/domain/src/stamp-glyphs.js';
import type { WalletCard } from './apple-pass.js';
import { cardArtMarkup } from '../../../../packages/domain/src/card-art.js';
import {
  walletArtCategory,
  walletTheme,
  type WalletTheme,
} from '../../../../packages/domain/src/wallet-theme.js';

// Bump whenever the strip changes, so Google re-fetches it and Apple passes refresh.
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

export function stripSvg(card: WalletCard, scale: number, height = 144, rtl = false) {
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
  /** Largest stamp, in face units. */
  maxStamp?: number;
}
export const POSTER: CardFace = { width: 358, height: 448, top: 74, bottom: 350, padX: 30 };
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

/** The edition's artwork drawn over the whole poster, like the web card. */
function posterArt(card: WalletCard, theme: WalletTheme, rtl: boolean, face: CardFace) {
  const { kind, color, opacity, rotate, scale, leaf } = theme.art,
    { width: W, height: H } = face;
  if (kind === 'none' || opacity <= 0) return { defs: '', body: '' };
  const n = (value: number) => value.toFixed(2);
  // The 600×420 web art box, scaled to the poster height and centred.
  const k = H / 420,
    dx = (W - 600 * k) / 2;
  const onCard = (inner: string) =>
    `<g transform="translate(${n(dx)} 0) scale(${n(k)})${rtl ? ' translate(600 0) scale(-1 1)' : ''} translate(300 210) rotate(${rotate}) scale(${scale}) translate(-300 -210)">${inner}</g>`;
  const lines = (alpha: number) =>
    `<g fill="none" stroke="${color}" stroke-opacity="${n(alpha)}" stroke-width="1.6" stroke-linecap="round">${cardArtMarkup[walletArtCategory(card.template)]}</g>`;
  const leafPath = leaf
    ? `<path transform="rotate(18 534 290)" d="M367 550A333 517 0 0 1 700 33A333 517 0 0 1 367 550Z" fill="none" stroke="${color}" stroke-opacity="${n(opacity * 1.2)}" stroke-width="1.6"/>`
    : '';
  if (kind === 'lines') return { defs: '', body: onCard(lines(opacity) + leafPath) };
  if (kind === 'mosaic')
    return {
      defs: `<pattern id="tiles" width="88" height="88" patternUnits="userSpaceOnUse"><path d="M0 0L44 44L0 88ZM88 0L44 44L88 88Z" fill="${color}" fill-opacity="${n(opacity)}"/></pattern>`,
      body: `<rect width="${W}" height="${H}" fill="url(#tiles)"/>`,
    };
  if (kind === 'ruled')
    return {
      defs: `<pattern id="rules" width="50" height="${H}" patternUnits="userSpaceOnUse"><rect x="25" width=".7" height="${H}" fill="${color}" fill-opacity="${n(opacity)}"/></pattern>`,
      body: `<rect width="${W}" height="${H}" fill="url(#rules)"/>` + onCard(lines(opacity)),
    };
  // aurora: two soft accent lights on opposite corners, with the line art barely there.
  return {
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
export function posterArtworkSvg(
  card: WalletCard,
  scale: number,
  rtl = false,
  options: { face?: CardFace; logo?: ArtworkLogo | null } = {},
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
    outline = card.stamp_style === 'outline',
    glyphInk = outline ? accent : theme.stampInk,
    shape = card.stamp_shape,
    icon = stampIconPaths[card.stamp_icon] ? card.stamp_icon : 'check',
    art = posterArt(card, theme, rtl, face),
    layout = posterLayout(total, rtl, stampsFace);
  const n = (value: number) => value.toFixed(2);
  const glyph = (path: string, stroke: string, width: number, k: number, opacity = 1) =>
    `<g transform="scale(${(k / 24).toFixed(4)}) translate(-12 -12)" fill="none" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></g>`;
  const slots = layout.slots.map(({ x, y }, i) => {
    const open = `<g data-slot="${i + 1}" data-filled="${i < filled}" transform="translate(${n(x)} ${n(y)})">`;
    if (i === total - 1)
      return (
        open +
        `<g transform="scale(${(layout.size / 48).toFixed(4)})">` +
        giftSlot(i < filled, { ink, accent, glyphInk, outline, dashOpacity: 0.32 }) +
        '</g></g>'
      );
    if (i >= filled)
      return (
        open +
        `<g transform="scale(${(layout.size / 48).toFixed(4)})">` +
        `<path d="${shapePath(shape)}" fill="none" stroke="${ink}" stroke-opacity=".28" stroke-width="1.2" stroke-dasharray="3 3"/>` +
        '</g></g>'
      );
    const g = stampGeometry(card.id + ':' + i, shape),
      k = (layout.size * 60) / 56 / 64;
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
    logoMarkup +
    slots.join('') +
    track +
    '</svg>'
  );
}

/** Google Wallet's large card image: the same card face as the Apple poster, in Google's shape. */
export function googleHeroSvg(card: WalletCard, scale: number, rtl = false) {
  return posterArtworkSvg(card, scale, rtl, { face: GOOGLE_HERO });
}
