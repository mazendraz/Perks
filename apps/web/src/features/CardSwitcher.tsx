import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Language, SavedCard } from '../../../../packages/contracts/src/index.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';
import { LoyaltyCard } from '../../../../packages/ui/src/LoyaltyCard.js';
import { navigate } from '../useRoute.js';
import './card-switcher.css';

function CardControls({
  lang,
  index,
  total,
  move,
  disabled = false,
}: {
  lang: Language;
  index: number;
  total: number;
  move: (index: number) => void;
  disabled?: boolean;
}) {
  const ar = lang === 'ar';
  return (
    <div className="wallet-card-controls">
      <button
        type="button"
        className="secondary wallet-card-arrow"
        data-step="previous"
        aria-label={ar ? 'الكارت اللي قبله' : 'Previous card'}
        disabled={disabled || index === 0}
        onClick={() => move(index - 1)}
      >
        <Icon name="arrow" />
      </button>
      <span role="status" aria-atomic="true">
        {ar ? `${index + 1} من ${total}` : `${index + 1} of ${total}`}
      </span>
      <button
        type="button"
        className="secondary wallet-card-arrow"
        data-step="next"
        aria-label={ar ? 'الكارت اللي بعده' : 'Next card'}
        disabled={disabled || index === total - 1}
        onClick={() => move(index + 1)}
      >
        <Icon name="arrow" />
      </button>
    </div>
  );
}

export function CardWallet({ lang, cards }: { lang: Language; cards: SavedCard[] }) {
  const track = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const [visible, setVisible] = useState(0);
  const index = Math.min(visible, cards.length - 1);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const move = (next: number) => {
    const viewport = track.current;
    const slide = viewport?.children[next];
    if (!viewport || !slide) return;
    const x = slide.getBoundingClientRect();
    const view = viewport.getBoundingClientRect();
    viewport.scrollBy({
      left: x.left + x.width / 2 - (view.left + view.width / 2),
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  };

  if (cards.length <= 1) {
    return (
      <div className="cards-grid">
        {cards.map((card) => (
          <button
            className="card-open"
            key={card.id}
            onClick={() => navigate('/customer/' + card.id)}
          >
            <LoyaltyCard card={card} lang={lang} />
          </button>
        ))}
      </div>
    );
  }

  const onScroll = () => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const viewport = track.current;
      const first = viewport?.children[0];
      const second = viewport?.children[1];
      if (!viewport || !first || !second) return;
      const spacing = Math.abs(
        first.getBoundingClientRect().left - second.getBoundingClientRect().left,
      );
      if (spacing)
        setVisible(
          Math.min(
            viewport.children.length - 1,
            Math.round(Math.abs(viewport.scrollLeft) / spacing),
          ),
        );
    });
  };

  return (
    <section
      className="wallet-card-carousel"
      aria-label={lang === 'ar' ? 'تبديل الكروت' : 'Switch cards'}
    >
      <div
        className="cards-grid wallet-card-track"
        ref={track}
        onScroll={onScroll}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          move(index + ((event.key === 'ArrowRight') !== (lang === 'ar') ? 1 : -1));
        }}
      >
        {cards.map((card, position) => (
          <div className="wallet-card-slide" key={card.id} data-current={position === index}>
            <button className="card-open" onClick={() => navigate('/customer/' + card.id)}>
              <LoyaltyCard card={card} lang={lang} motion="quiet" />
            </button>
          </div>
        ))}
      </div>
      <CardControls lang={lang} index={index} total={cards.length} move={move} />
    </section>
  );
}

export function CardDetailSwitcher({
  cards,
  cardId,
  lang,
  disabled,
  children,
}: {
  cards: SavedCard[];
  cardId: string;
  lang: Language;
  disabled: boolean;
  children: ReactNode;
}) {
  const index = cards.findIndex((card) => card.id === cardId);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const transition = useRef<{ id: string; offset: number } | null>(null);
  if (cards.length < 2) return children;

  const move = (next: number) => {
    const target = cards[next];
    if (disabled || !target || next === index) return;
    const direction = lang === 'ar' ? -1 : 1;
    transition.current = { id: target.id, offset: (next > index ? 1 : -1) * direction * 28 };
    navigate('/customer/' + target.id);
  };
  const offset = transition.current?.id === cardId ? transition.current.offset : 0;

  return (
    <div className="wallet-card-detail-switcher">
      <div
        className="wallet-card-gesture"
        onTouchStart={(event) => {
          const start = event.touches.length === 1 ? event.touches[0] : undefined;
          touch.current = start && !disabled ? { x: start.clientX, y: start.clientY } : null;
        }}
        onTouchCancel={() => {
          touch.current = null;
        }}
        onTouchEnd={(event) => {
          const start = touch.current;
          touch.current = null;
          const end = event.changedTouches[0];
          if (!start || !end) return;
          const dx = end.clientX - start.x;
          const dy = end.clientY - start.y;
          if (Math.abs(dx) < 48 || Math.abs(dx) < 1.5 * Math.abs(dy)) return;
          move(index + (dx < 0 !== (lang === 'ar') ? 1 : -1));
        }}
      >
        <div
          key={cardId}
          className={offset ? 'wallet-card-arriving' : undefined}
          style={
            offset ? ({ '--wallet-card-offset': `${offset}px` } as React.CSSProperties) : undefined
          }
          onAnimationEnd={() => {
            transition.current = null;
          }}
        >
          {children}
        </div>
      </div>
      <CardControls
        lang={lang}
        index={index}
        total={cards.length}
        move={move}
        disabled={disabled}
      />
    </div>
  );
}
