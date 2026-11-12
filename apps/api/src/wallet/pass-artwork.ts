import type { StampShape } from '../../../../packages/contracts/src/branding.js';
import { stampRandom } from '../../../../packages/domain/src/stamp-ink.js';
import { stampIconPaths } from '../../../../packages/domain/src/stamp-glyphs.js';
import type { WalletCard } from './apple-pass.js';

// Bump whenever the strip changes, so Google re-fetches it and Apple passes refresh.
export const WALLET_ARTWORK_VERSION = 'perks-card-6';
const color = (value: string, fallback: string) =>
  /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
function luminance(color: string) {
  const c = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722;
}
export function inkFor(color: string) {
  return luminance(color) > 0.179 ? '#132a26' : '#ffffff';
}
/** Mixes two #rrggbb colours; used for Wallet label text that sits between ink and background. */
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

export function stripSvg(card: WalletCard, scale: number, height = 144, rtl = false) {
  const total = Math.max(2, Math.min(50, card.threshold)),
    filled = Math.max(0, Math.min(total, card.display_balance));
  const bg = color(card.primary_color, '#181b38'),
    accent = color(card.accent_color, '#cbff64'),
    ink = inkFor(bg),
    light = ink !== '#ffffff',
    outline = card.stamp_style === 'outline',
    glyphInk = outline ? accent : inkFor(accent),
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
    '</defs>';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${375 * scale}" height="${height * scale}" viewBox="0 0 375 ${height}">` +
    defs +
    `<rect width="375" height="${height}" fill="${bg}"/><ellipse cx="187.5" cy="${height / 2}" rx="187.5" ry="${height / 2}" fill="url(#glow)"/>` +
    slots.join('') +
    '</svg>'
  );
}
