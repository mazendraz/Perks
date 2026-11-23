import { useMemo, useRef, useState } from 'react';
import type { Language, SavedCard } from '../../../../packages/contracts/src/index.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';
import { LoyaltyCard } from '../../../../packages/ui/src/LoyaltyCard.js';
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

export function CardSwitcher({
  cards,
  cardId,
  lang,
  disabled,
  onSelect,
  waiting,
  reveal,
  celebrating,
}: {
  cards: SavedCard[];
  cardId: string;
  lang: Language;
  disabled: boolean;
  onSelect: (id: string) => void;
  waiting: boolean;
  reveal: boolean;
  celebrating: boolean;
}) {
  const index = cards.findIndex((card) => card.id === cardId);
  const multiple = cards.length > 1;
  const ar = lang === 'ar';
  const direction = ar ? -1 : 1;
  const arrowTouch = useRef<{ x: number; y: number } | null>(null);
  const gesture = useRef<{
    pointer: number;
    x: number;
    y: number;
    width: number;
    dragging: boolean;
  } | null>(null);
  const [offset, setOffset] = useState(0);
  const faces = useMemo(
    () =>
      cards.map((card) => (
        <LoyaltyCard
          key={card.id}
          card={card}
          lang={lang}
          waiting={card.id === cardId && waiting}
          reveal={card.id === cardId && reveal}
          motion={card.id === cardId && !celebrating ? 'normal' : 'quiet'}
        />
      )),
    [cards, cardId, lang, waiting, reveal, celebrating],
  );
  function stepTo(position: number) {
    const next = cards[position];
    if (next && !disabled && position !== index) onSelect(next.id);
  }
  function reset() {
    gesture.current = null;
    setOffset(0);
  }
  return (
    <section
      className="customer-carousel"
      dir={ar ? 'rtl' : 'ltr'}
      aria-roledescription={multiple ? (ar ? 'عارض كروت' : 'carousel') : undefined}
      aria-label={ar ? 'كروتي' : 'My cards'}
    >
      <div
        className="customer-card-track"
        data-multiple={multiple}
        data-dragging={offset !== 0}
        onPointerDown={(event) => {
          if (!multiple || disabled || !event.isPrimary || event.button !== 0) return;
          const width =
            event.currentTarget.querySelector<HTMLElement>('[aria-hidden="false"]')!.offsetWidth;
          gesture.current = {
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            width,
            dragging: false,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const g = gesture.current;
          if (!g || g.pointer !== event.pointerId) return;
          const dx = event.clientX - g.x;
          const dy = event.clientY - g.y;
          if (!g.dragging) {
            if (Math.abs(dy) > 8 && Math.abs(dy) > Math.abs(dx)) return reset();
            if (Math.abs(dx) < 8) return;
            g.dragging = true;
          }
          setOffset(
            Math.max(
              -Math.min(1, index),
              Math.min(1, cards.length - 1 - index, (-direction * dx) / (g.width * 0.55)),
            ),
          );
        }}
        onPointerUp={(event) => {
          const g = gesture.current;
          if (!g || g.pointer !== event.pointerId) return;
          const dx = event.clientX - g.x;
          if (g.dragging && Math.abs(dx) > Math.min(42, g.width * 0.13))
            stepTo(index - direction * Math.sign(dx));
          reset();
        }}
        onLostPointerCapture={reset}
        onPointerCancel={reset}
        tabIndex={multiple ? 0 : undefined}
        onKeyDown={(event) => {
          if (disabled || !multiple || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault();
          stepTo(index + ((event.key === 'ArrowRight') !== ar ? 1 : -1));
        }}
      >
        {cards.map((card, i) => {
          const pose = multiple ? deckPose(i - index - offset, direction) : undefined;
          return (
            <div
              key={card.id}
              className="customer-slide"
              aria-hidden={i !== index}
              style={pose && { ...pose, visibility: pose.opacity === 0 ? 'hidden' : undefined }}
            >
              {faces[i]}
            </div>
          );
        })}
      </div>
      {multiple && (
        <div className="customer-card-controls">
          <span role="status">
            <bdi className="sr-only">{cards[index]?.merchant_name} </bdi>
            {ar ? `كارت ${index + 1} من ${cards.length}` : `Card ${index + 1} of ${cards.length}`}
          </span>
          <div>
            {([-1, 1] as const).map((step) => (
              <button
                key={step}
                type="button"
                className="secondary"
                aria-label={
                  step < 0
                    ? ar
                      ? 'الكارت اللي قبله'
                      : 'Previous card'
                    : ar
                      ? 'الكارت اللي بعده'
                      : 'Next card'
                }
                disabled={disabled || !cards[index + step]}
                onTouchStart={(event) => {
                  const touch = event.touches[0];
                  arrowTouch.current =
                    touch && event.touches.length === 1
                      ? { x: touch.clientX, y: touch.clientY }
                      : null;
                }}
                onTouchCancel={() => {
                  arrowTouch.current = null;
                }}
                onTouchEnd={(event) => {
                  const start = arrowTouch.current;
                  arrowTouch.current = null;
                  const end = event.changedTouches[0];
                  if (!start || !end || !event.cancelable) return;
                  // Handle intentional taps even when the browser suppresses a click after momentum scrolling.
                  event.preventDefault();
                  if (
                    Math.hypot(end.clientX - start.x, end.clientY - start.y) <= 8 &&
                    event.currentTarget.contains(
                      document.elementFromPoint(end.clientX, end.clientY),
                    )
                  )
                    stepTo(index + step);
                }}
                onClick={() => stepTo(index + step)}
                data-back={step < 0 !== ar}
              >
                <Icon name="arrow" />
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
