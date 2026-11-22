import { useMemo, useRef, useState, type ReactNode } from 'react';
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

/** Where a card sits in the fanned deck, `p` cards away from the front (negative = before it). */
function deckPose(p: number, dir: 1 | -1) {
  const a = Math.min(Math.abs(p), 3.6);
  const side = Math.sign(p) * dir;
  const x = a <= 1 ? a * 24 : 24 + (a - 1) * 9;
  const opacity = a <= 2.6 ? 1 : Math.max(0, 1 - (a - 2.6));
  return {
    transform: `translate3d(${side * x}%, ${a * 2.2}%, 0) rotate(${side * a * 5.5}deg) scale(${1 - a * 0.075})`,
    zIndex: 100 - Math.round(Math.abs(p) * 10),
    opacity,
  };
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function CardWallet({ lang, cards }: { lang: Language; cards: SavedCard[] }) {
  const ar = lang === 'ar';
  const dir: 1 | -1 = ar ? -1 : 1;
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; width: number; live: boolean } | null>(
    null,
  );
  const dragged = useRef(false);
  const [current, setCurrent] = useState(0);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const index = Math.max(0, Math.min(current, cards.length - 1));
  // Same element each render, so a drag frame does not re-render every card face.
  const faces = useMemo(
    () => cards.map((card) => <LoyaltyCard key={card.id} card={card} lang={lang} motion="quiet" />),
    [cards, lang],
  );

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

  const last = cards.length - 1;
  const move = (next: number) => setCurrent(Math.max(0, Math.min(last, next)));
  const front = cards[index]!;

  const endDrag = (commit: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (g?.live && commit) {
      // A short flick moves one card; a long drag can move several.
      const step =
        Math.abs(drag) < 0.18 ? 0 : Math.abs(drag) < 1 ? Math.sign(drag) : Math.round(drag);
      move(index + step);
    }
    setDrag(0);
  };

  return (
    <section
      className="card-deck"
      aria-label={ar ? 'تبديل الكروت' : 'Switch cards'}
      aria-roledescription="carousel"
    >
      <div
        className="cards-grid card-deck-stage"
        ref={stage}
        data-dragging={dragging || undefined}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
          event.preventDefault();
          move(index + ((event.key === 'ArrowRight') !== ar ? 1 : -1));
        }}
        onPointerDown={(event) => {
          if (event.pointerType === 'mouse' && event.button !== 0) return;
          const width =
            stage.current?.querySelector('.card-deck-slide')?.getBoundingClientRect().width ?? 300;
          gesture.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            width,
            live: false,
          };
          dragged.current = false;
        }}
        onPointerMove={(event) => {
          const g = gesture.current;
          if (!g || g.id !== event.pointerId) return;
          const dx = event.clientX - g.x;
          const dy = event.clientY - g.y;
          if (!g.live) {
            if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return endDrag(false);
            if (Math.abs(dx) < 8) return;
            g.live = true;
            dragged.current = true;
            setDragging(true);
            stage.current?.setPointerCapture(event.pointerId);
          }
          let next = (-dx * dir) / (g.width * 0.55);
          // Resist past the first and last card.
          const min = -index,
            max = last - index;
          if (next < min) next = min + (next - min) * 0.25;
          if (next > max) next = max + (next - max) * 0.25;
          setDrag(next);
        }}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
        onClickCapture={(event) => {
          if (dragged.current) {
            event.preventDefault();
            event.stopPropagation();
            dragged.current = false;
          }
        }}
      >
        {cards.map((card, position) => {
          const p = position - index - drag;
          const isFront = position === index;
          const pose = deckPose(p, dir);
          return (
            <div
              className="card-deck-slide"
              key={card.id}
              data-current={isFront}
              style={{ ...pose, visibility: pose.opacity === 0 ? 'hidden' : undefined }}
              aria-hidden={!isFront}
            >
              <button
                type="button"
                className="card-open"
                tabIndex={isFront ? 0 : -1}
                aria-label={isFront ? card.merchant_name : undefined}
                onClick={() => (isFront ? navigate('/customer/' + card.id) : move(position))}
              >
                {faces[position]}
              </button>
            </div>
          );
        })}
      </div>
      <div className="card-deck-caption" aria-live="polite">
        <strong>{front.merchant_name}</strong>
        <span>{front.program_name}</span>
      </div>
      <div className="card-deck-footer">
        <span className="card-deck-count" aria-hidden="true">
          {pad2(index + 1)} / {pad2(cards.length)}
        </span>
        <span className="sr-only" role="status">
          {ar ? `${index + 1} من ${cards.length}` : `${index + 1} of ${cards.length}`}
        </span>
        <div className="card-deck-arrows">
          <button
            type="button"
            className="secondary wallet-card-arrow"
            data-step="previous"
            aria-label={ar ? 'الكارت اللي قبله' : 'Previous card'}
            disabled={index === 0}
            onClick={() => move(index - 1)}
          >
            <Icon name="arrow" />
          </button>
          <button
            type="button"
            className="secondary wallet-card-arrow"
            data-step="next"
            aria-label={ar ? 'الكارت اللي بعده' : 'Next card'}
            disabled={index === last}
            onClick={() => move(index + 1)}
          >
            <Icon name="arrow" />
          </button>
        </div>
      </div>
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
