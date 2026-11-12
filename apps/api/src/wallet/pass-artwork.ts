import type { StampShape } from '../../../../packages/contracts/src/branding.js';
import { stampRandom } from '../../../../packages/domain/src/stamp-ink.js';
import { stampIconPaths } from '../../../../packages/domain/src/stamp-glyphs.js';
import type { WalletCard } from './apple-pass.js';
import { cardArtMarkup } from '../../../../packages/domain/src/card-art.js';
import {
  inkFor,
  mix,
  walletArtCategory,
  walletTheme,
  type WalletTheme,
} from '../../../../packages/domain/src/wallet-theme.js';

// Bump whenever the strip changes, so Google re-fetches it and Apple passes refresh.
export const WALLET_ARTWORK_VERSION = 'perks-card-7';
export { inkFor, mix } from '../../../../packages/domain/src/wallet-theme.js';

// Clean slot outlines in a 48-unit box centred on 0,0. At Wallet size a crisp edge reads as
// premium; the rough ink edge of the web stamp turns into noise at 40 points.
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
const GIFT =
  'M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z';

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
    // A light card (paper editions), judged by the card itself: Noir's cream ink is not a light card.
    light = inkFor(bg) !== '#ffffff',
    outline = card.stamp_style === 'outline',
    glyphInk = outline ? accent : theme.stampInk,
    art = artLayer(card, theme, height, rtl),
    shape = card.stamp_shape,
    icon = stampIconPaths[card.stamp_icon] ? card.stamp_icon : 'check',
    random = stampRandom(card.id + ':wallet');
  const n = (value: number) => value.toFixed(2);
  const outlinePath = shapePath(shape);
  const glyph = (path: string, stroke: string, width: number, k: number, opacity = 1) =>
    `<g transform="scale(${(k / 24).toFixed(4)}) translate(-12 -12)" fill="none" stroke="${stroke}" stroke-opacity="${opacity}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></g>`;
  const slots = stripLayout(total, height, rtl).map(({ x, y, size }, i) => {
    const k = size / 48,
      reward = i === total - 1,
      tilt = (random() - 0.5) * 10;
    const open = `<g data-slot="${i + 1}" data-filled="${i < filled}" transform="translate(${n(x)} ${n(y)})">`;
    if (i >= filled) {
      // Empty: a soft recessed well. The reward slot is drawn in the accent colour as the goal.
      return (
        open +
        `<g transform="scale(${k.toFixed(4)})">` +
        (reward
          ? `<path d="${outlinePath}" fill="${accent}" fill-opacity=".14" stroke="${accent}" stroke-opacity=".85" stroke-width="1.6"/>` +
            glyph(GIFT, accent, 1.9, 22)
          : `<path d="${outlinePath}" fill="${ink}" fill-opacity="${light ? 0.06 : 0.08}" stroke="${ink}" stroke-opacity="${light ? 0.2 : 0.22}" stroke-width="1.2"/>`) +
        '</g></g>'
      );
    }
    // Filled: a crisp pressed stamp in the shop's accent, slightly turned like a real stamp.
    return (
      open +
      `<g transform="scale(${k.toFixed(4)}) rotate(${n(reward ? 0 : tilt)})" filter="url(#lift)">` +
      `<path d="${outlinePath}" fill="${outline ? bg : 'url(#ink)'}" stroke="${accent}" stroke-width="${outline ? 2.6 : 0}"/>` +
      `<path d="${shapePath(shape, 17.6)}" fill="none" stroke="${glyphInk}" stroke-opacity=".28" stroke-width="1.1"/>` +
      glyph(
        reward ? GIFT : stampIconPaths[icon]!,
        glyphInk,
        icon === 'check' && !reward ? 2.8 : 2,
        reward ? 21 : 22,
      ) +
      '</g></g>'
    );
  });
  const defs =
    '<defs>' +
    // A soft light behind the stamps that fades to the exact card colour at every edge, so the
    // strip blends into the pass instead of reading as a pasted box.
    `<radialGradient id="glow" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${mix(bg, light ? '#ffffff' : accent, light ? 0.45 : 0.1)}"/><stop offset="1" stop-color="${bg}"/></radialGradient>` +
    `<linearGradient id="ink" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${mix(accent, '#ffffff', 0.18)}"/><stop offset="1" stop-color="${mix(accent, '#000000', 0.1)}"/></linearGradient>` +
    `<filter id="lift" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="1.2" stdDeviation="1.3" flood-color="#000" flood-opacity="${light ? 0.18 : 0.32}"/></filter>` +
    art.defs +
    '</defs>';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${375 * scale}" height="${height * scale}" viewBox="0 0 375 ${height}">` +
    defs +
    `<rect width="375" height="${height}" fill="${bg}"/><ellipse cx="187.5" cy="${height / 2}" rx="187.5" ry="${height / 2}" fill="url(#glow)"/>` +
    art.body +
    slots.join('') +
    '</svg>'
  );
}
