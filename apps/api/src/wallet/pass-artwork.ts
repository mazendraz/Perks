import type { StampShape } from '../../../../packages/contracts/src/branding.js';
import { stampIconPaths } from '../../../../packages/domain/src/stamp-glyphs.js';
import type { WalletCard } from './apple-pass.js';

export const WALLET_ARTWORK_VERSION = 'perks-material-2';
const color = (value: string, fallback: string) =>
  /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
function mix(a: string, b: string, amount: number) {
  return (
    '#' +
    [1, 3, 5]
      .map((i) =>
        Math.round(
          parseInt(a.slice(i, i + 2), 16) * (1 - amount) + parseInt(b.slice(i, i + 2), 16) * amount,
        )
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
export function inkFor(color: string) {
  const c = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  return c[0]! * 0.2126 + c[1]! * 0.7152 + c[2]! * 0.0722 > 0.179 ? '#132a26' : '#ffffff';
}
function frame(shape: StampShape, x: number, y: number, r: number) {
  if (shape === 'hexagon' || shape === 'seal') {
    const count = shape === 'seal' ? 32 : 6;
    const points = Array.from({ length: count }, (_, i) => {
      const angle = (2 * Math.PI * i) / count - Math.PI / 2,
        radius = shape === 'seal' && i % 2 ? r * 0.87 : r;
      return `${(x + Math.cos(angle) * radius).toFixed(2)},${(y + Math.sin(angle) * radius).toFixed(2)}`;
    });
    return `<polygon points="${points.join(' ')}"/>`;
  }
  if (shape === 'rounded' || shape === 'square')
    return `<rect x="${x - r}" y="${y - r}" width="${2 * r}" height="${2 * r}" rx="${r * (shape === 'rounded' ? 0.3 : 0.08)}"/>`;
  return `<circle cx="${x}" cy="${y}" r="${r}"/>`;
}
// Native store cards use a 375×144pt strip. Keep important artwork inside
// an inset safe area rather than relying on Wallet's cropping behaviour.
export function stripSvg(card: WalletCard, scale: number, height = 144) {
  const total = Math.max(2, Math.min(50, card.threshold)),
    filled = Math.max(0, Math.min(total, card.display_balance));
  const bg = color(card.primary_color, '#181b38'),
    accent = color(card.accent_color, '#cbff64'),
    ink = inkFor(bg);
  const top = 18,
    bottom = height - 24,
    rows = total <= 6 ? 1 : total <= 16 ? 2 : Math.ceil(total / 10),
    columns = Math.ceil(total / rows);
  const cell = Math.min(319 / columns, (bottom - top) / rows),
    r = Math.min(27, cell * 0.36);
  const slots = [];
  for (let i = 0; i < total; i++) {
    const row = Math.floor(i / columns),
      count = Math.min(columns, total - row * columns),
      col = i % columns;
    const x = (375 - count * cell) / 2 + cell * (col + 0.5),
      y = (top + bottom - rows * cell) / 2 + cell * (row + 0.5);
    const stamped = i < filled,
      outline = card.stamp_style === 'outline';
    const glyph = stamped
      ? stampIconPaths[card.stamp_icon] || stampIconPaths.check
      : i === total - 1
        ? 'M3 9h18v4H3zM5 13v8h14v-8M12 9v12M12 9H8a3 3 0 1 1 3-3l1 3Zm0 0h4a3 3 0 1 0-3-3l-1 3Z'
        : '';
    const angle = stamped ? ((i * 7 + 3) % 9) - 4 : 0,
      size = (r * 0.96) / 24,
      glyphInk = outline ? accent : inkFor(accent);
    slots.push(
      `<g data-slot="${i + 1}" data-filled="${stamped}" transform="rotate(${angle} ${x} ${y})">` +
        `<g transform="translate(0 1.2)" fill="none" stroke="#000" stroke-opacity=".16" stroke-width="1.2">${frame(card.stamp_shape, x, y, r)}</g>` +
        `<g fill="${stamped && !outline ? 'url(#foil)' : mix(bg, ink, 0.035)}" stroke="${stamped ? accent : ink}" stroke-opacity="${stamped ? '.9' : '.26'}" stroke-width="${stamped ? '1.2' : '.8'}">${frame(card.stamp_shape, x, y, r)}</g>` +
        (stamped
          ? `<g fill="none" stroke="${outline ? accent : glyphInk}" stroke-opacity=".3" stroke-width=".65">${frame(card.stamp_shape, x, y, r * 0.84)}</g>`
          : '') +
        (glyph
          ? `<g transform="translate(${x - 12 * size} ${y - 12 * size}) scale(${size})" fill="none" stroke="${stamped ? glyphInk : ink}" opacity="${stamped ? '.95' : '.42'}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="${glyph}"/></g>`
          : '') +
        '</g>',
    );
  }
  const contours = Array.from(
    { length: 9 },
    (_, i) =>
      `<ellipse cx="350" cy="-8" rx="${58 + i * 8}" ry="${48 + i * 8}" fill="none" stroke="${accent}" stroke-opacity=".065" stroke-width=".6"/>`,
  ).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${375 * scale}" height="${height * scale}" viewBox="0 0 375 ${height}"><defs><linearGradient id="material" x2="1" y2="1"><stop stop-color="${mix(bg, ink, 0.045)}"/><stop offset=".55" stop-color="${bg}"/><stop offset="1" stop-color="${mix(bg, '#000000', 0.16)}"/></linearGradient><linearGradient id="foil" x2="1" y2="1"><stop stop-color="${mix(accent, '#ffffff', 0.26)}"/><stop offset=".44" stop-color="${accent}"/><stop offset=".58" stop-color="${mix(accent, '#ffffff', 0.1)}"/><stop offset="1" stop-color="${mix(accent, '#000000', 0.12)}"/></linearGradient><pattern id="grain" width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 1h1m2 2h1" stroke="${ink}" stroke-opacity=".024" stroke-width=".4"/></pattern></defs><rect width="375" height="${height}" fill="url(#material)"/><rect width="375" height="${height}" fill="url(#grain)"/>${contours}<rect x="17" y="8" width="341" height="${height - 16}" rx="16" fill="none" stroke="${accent}" stroke-opacity=".25" stroke-width=".7"/><path d="M29 ${height - 12}h317" stroke="${ink}" stroke-opacity=".13" stroke-linecap="round" stroke-width="1.2"/><path d="M29 ${height - 12}h${(317 * filled) / total}" stroke="${accent}" stroke-opacity="${filled ? 0.9 : 0}" stroke-linecap="round" stroke-width="1.2"/>${slots.join('')}</svg>`;
}
