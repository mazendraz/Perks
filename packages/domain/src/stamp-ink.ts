import type { StampShape } from '../../contracts/src/branding.js';
// One ink shape for the web card and the Wallet artwork, so both show the same stamp.
export function stampRandom(seed: string) {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619);
  let state = ((hash >>> 0) % 2147483646) + 1;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}
function radius(shape: StampShape, angle: number, r: number) {
  if (shape === 'hexagon')
    return (
      (r * Math.cos(Math.PI / 6)) /
      Math.cos(
        ((((angle + Math.PI / 6) % (Math.PI / 3)) + Math.PI / 3) % (Math.PI / 3)) - Math.PI / 6,
      )
    );
  if (shape === 'square' || shape === 'rounded') {
    const n = shape === 'square' ? 18 : 4;
    return r / (Math.abs(Math.cos(angle)) ** n + Math.abs(Math.sin(angle)) ** n) ** (1 / n);
  }
  return r;
}
export function stampGeometry(seed: string, shape: StampShape = 'circle') {
  const random = stampRandom(seed),
    angle = (random() - 0.5) * 16;
  const rough = (r: number) => {
    const points = Array.from({ length: 36 }, (_, i) => {
      const a = (i / 36) * Math.PI * 2,
        seal = shape === 'seal' ? (i % 2 ? 0.89 : 1) : 1,
        rr = radius(shape, a, r) * seal * (1 + (random() - 0.5) * 0.09);
      return (i ? 'L' : 'M') + (Math.cos(a) * rr).toFixed(2) + ' ' + (Math.sin(a) * rr).toFixed(2);
    });
    return points.join(' ') + 'Z';
  };
  const outer = rough(28),
    inner = rough(23.5);
  const specks = Array.from({ length: 7 }, () => {
    const a = random() * Math.PI * 2,
      r = 31 + random() * 5;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r, r: 0.8 + random() * 1.6 };
  });
  return { angle, outer, inner, specks };
}
