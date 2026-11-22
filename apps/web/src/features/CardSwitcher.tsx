import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { Language, SavedCard } from '../../../../packages/contracts/src/index.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';
import { LoyaltyCard } from '../../../../packages/ui/src/LoyaltyCard.js';
import { navigate } from '../useRoute.js';
import './card-switcher.css';

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

/**
 * Cards fanned like a hand of cards: the current one in front, the others tilted behind it.
 * Drag sideways (or use the arrows / arrow keys) to bring the next card forward.
 * `front` replaces the front card's face (the full, interactive card on the detail page);
 * otherwise the front card opens with `onOpen`.
 */
function CardDeck({
  lang,
  cards,
  index,
  move,
  front,
  onOpen,
  caption = true,
  disabled = false,
}: {
  lang: Language;
  cards: SavedCard[];
  index: number;
  move: (index: number) => void;
  front?: ReactNode;
  onOpen?: (card: SavedCard) => void;
  caption?: boolean;
  disabled?: boolean;
}) {
  const ar = lang === 'ar';
  const dir: 1 | -1 = ar ? -1 : 1;
  const stage = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; x: number; y: number; width: number; live: boolean } | null>(
    null,
  );
  const dragged = useRef(false);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  // Same element each render, so a drag frame does not re-render every card face.
  const faces = useMemo(
    () => cards.map((card) => <LoyaltyCard key={card.id} card={card} lang={lang} motion="quiet" />),
    [cards, lang],
  );
  const last = cards.length - 1;
  const go = (next: number) => {
    const target = Math.max(0, Math.min(last, next));
    if (!disabled && target !== index) move(target);
  };
  const current = cards[index]!;

  const endDrag = (commit: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    setDragging(false);
    if (g?.live && commit) {
      // A short flick moves one card; a long drag can move several.
      const step =
        Math.abs(drag) < 0.18 ? 0 : Math.abs(drag) < 1 ? Math.sign(drag) : Math.round(drag);
      go(index + step);
    }
    setDrag(0);
  };

  return (
    <section
      className="card-deck"
      data-detail={front ? true : undefined}
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
          go(index + ((event.key === 'ArrowRight') !== ar ? 1 : -1));
        }}
        onPointerDown={(event) => {
          if (disabled || (event.pointerType === 'mouse' && event.button !== 0)) return;
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
          const isFront = position === index;
          const pose = deckPose(position - index - drag, dir);
          return (
            <div
              className="card-deck-slide"
              key={card.id}
              data-current={isFront}
              style={{ ...pose, visibility: pose.opacity === 0 ? 'hidden' : undefined }}
              aria-hidden={!isFront}
            >
              {isFront && front ? (
                front
              ) : (
                <button
                  type="button"
                  className="card-open"
                  tabIndex={isFront ? 0 : -1}
                  aria-label={isFront ? card.merchant_name : undefined}
                  onClick={() => (isFront ? onOpen?.(card) : go(position))}
                >
                  {faces[position]}
                </button>
              )}
            </div>
          );
        })}
      </div>
      {caption && (
        <div className="card-deck-caption" aria-live="polite">
          <strong>{current.merchant_name}</strong>
          <span>{current.program_name}</span>
        </div>
      )}
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
            disabled={disabled || index === 0}
            onClick={() => go(index - 1)}
          >
            <Icon name="arrow" />
          </button>
          <button
            type="button"
            className="secondary wallet-card-arrow"
            data-step="next"
            aria-label={ar ? 'الكارت اللي بعده' : 'Next card'}
            disabled={disabled || index === last}
            onClick={() => go(index + 1)}
          >
            <Icon name="arrow" />
          </button>
        </div>
      </div>
    </section>
  );
}

/** "My cards": all saved cards as a fanned deck; the front card opens its page. */
export function CardWallet({ lang, cards }: { lang: Language; cards: SavedCard[] }) {
  const [current, setCurrent] = useState(0);
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
  return (
    <CardDeck
      lang={lang}
      cards={cards}
      index={Math.min(current, cards.length - 1)}
      move={setCurrent}
      onOpen={(card) => navigate('/customer/' + card.id)}
    />
  );
}

/** A card's own page: the same deck, with the full interactive card in front. */
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
  if (cards.length < 2 || index < 0) return children;
  return (
    <CardDeck
      lang={lang}
      cards={cards}
      index={index}
      move={(next) => navigate('/customer/' + cards[next]!.id)}
      front={children}
      caption={false}
      disabled={disabled}
    />
  );
}
