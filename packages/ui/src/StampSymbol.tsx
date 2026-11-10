import type { StampIcon, StampShape } from '../../contracts/src/branding.js';
import { stampIconPaths as paths } from '../../domain/src/stamp-glyphs.js';
export function StampPath({ symbol = 'check' }: { symbol?: StampIcon }) {
  return (
    <path
      d={paths[symbol] || paths.check}
      stroke="currentColor"
      strokeWidth={symbol === 'check' ? 2.6 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  );
}
export function StampSymbol({
  symbol = 'check',
  className = 'stamp-check',
}: {
  symbol?: StampIcon;
  className?: string;
}) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <StampPath symbol={symbol} />
    </svg>
  );
}
const sealPoints = Array.from({ length: 32 }, (_, i) => {
  const angle = (i * Math.PI) / 16 - Math.PI / 2,
    r = i % 2 ? 18.6 : 22;
  return [24 + Math.cos(angle) * r, 24 + Math.sin(angle) * r].join(',');
}).join(' ');
export function StampFrame({ shape = 'circle' }: { shape?: StampShape }) {
  return (
    <svg className="stamp-frame" viewBox="0 0 48 48" aria-hidden="true">
      {shape === 'hexagon' ? (
        <polygon points="24,2 43,13 43,35 24,46 5,35 5,13" />
      ) : shape === 'seal' ? (
        <polygon points={sealPoints} />
      ) : shape === 'rounded' || shape === 'square' ? (
        <rect x="3" y="3" width="42" height="42" rx={shape === 'rounded' ? 11 : 1} />
      ) : (
        <circle cx="24" cy="24" r="21.5" />
      )}
    </svg>
  );
}
