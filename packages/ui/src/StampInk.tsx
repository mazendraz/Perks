import { StampPath } from './StampSymbol.js';
import { stampGeometry } from '../../domain/src/stamp-ink.js';
import { memo } from 'react';
import type { StampShape, StampIcon, StampStyle } from '../../contracts/src/branding.js';
export { stampGeometry, stampRandom } from '../../domain/src/stamp-ink.js';
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
