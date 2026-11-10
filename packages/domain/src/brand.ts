// Perks brand: one source for the platform mark used by the web shell, icons and favicon.
// Merchant cards keep each shop's own colors; these tokens are for the Perks platform only.
export const perksColors = {
  navy: '#181B38',
  lime: '#CBFF64',
  offWhite: '#F5F5F1',
} as const;
const P =
  'M60 20H130A90 90 0 0 1 130 200H100V242A38 38 0 0 1 62 280H58A38 38 0 0 1 20 242V60A40 40 0 0 1 60 20Z';
/** The P with two loyalty cards, drawn on a 240×300 grid. */
export function perksMark(p: string, back: string, front: string, gap: string) {
  return (
    `<path d="${P}" fill="${p}"/>` +
    `<rect x="51" y="53" width="138" height="86" rx="16" fill="${back}" transform="rotate(-12 120 96)"/>` +
    `<rect x="60" y="78" width="140" height="88" rx="17" fill="${front}" stroke="${gap}" stroke-width="8" transform="rotate(-7 130 122)"/>`
  );
}
/**
 * App icon on a 1024 canvas. `maskable` keeps the mark inside the 80% safe zone and fills
 * the whole square, as launchers and iOS apply their own corner mask.
 */
export function perksIconSvg(options: { rounded: boolean; maskable?: boolean }) {
  const { navy, lime, offWhite } = perksColors;
  const scale = options.maskable ? 1.75 : 2.25,
    x = 512 - 120 * scale,
    y = 512 - 150 * scale;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">' +
    `<rect width="1024" height="1024" rx="${options.rounded ? 228 : 0}" fill="${navy}"/>` +
    `<g transform="translate(${x} ${y}) scale(${scale})">${perksMark(offWhite, navy, lime, offWhite)}</g></svg>`
  );
}
