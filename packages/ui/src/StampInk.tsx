import { StampPath } from './StampSymbol.js';
import { memo } from 'react';
import type { StampShape, StampIcon, StampStyle } from '../../contracts/src/branding.js';
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
export const StampInk = memo(function StampInk({
  seed,
  shape = 'circle',
  symbol = 'check',
  style = 'solid',
  grainId,
}: {
  seed: string;
  shape?: StampShape;
  symbol?: StampIcon;
  style?: StampStyle;
  grainId: string;
}) {
  const geometry = stampGeometry(seed, shape),
    outline = style === 'outline';
  return (
    <svg
      className="nq-stamp-ink"
      viewBox="-32 -32 64 64"
      aria-hidden="true"
      data-ink-seed={seed}
      data-ink-angle={geometry.angle.toFixed(4)}
    >
      <g transform={'rotate(' + geometry.angle + ')'}>
        <path
          d={geometry.outer}
          fill={outline ? 'none' : 'var(--accent)'}
          stroke={outline ? 'var(--accent)' : 'none'}
          strokeWidth={outline ? 2.6 : 0}
        />
        <path
          d={geometry.inner}
          fill="none"
          stroke={outline ? 'var(--accent)' : 'var(--accent-ink)'}
          strokeOpacity=".35"
          strokeWidth="1.2"
        />
        <g
          transform="translate(-14 -14) scale(1.166667)"
          style={{ color: outline ? 'var(--accent)' : 'var(--accent-ink)' }}
        >
          <StampPath symbol={symbol} />
        </g>
        {geometry.specks.map((point, index) => (
          <circle
            key={index}
            cx={point.x}
            cy={point.y}
            r={point.r}
            fill="var(--accent)"
            opacity=".8"
          />
        ))}
        <path d={geometry.outer} fill={'url(#' + grainId + ')'} opacity=".35" />
      </g>
    </svg>
  );
});
