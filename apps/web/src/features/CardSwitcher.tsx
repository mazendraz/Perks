import { useLayoutEffect, useRef } from 'react';
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
  const track = useRef<HTMLDivElement>(null);
  const frame = useRef(0);
  const gesture = useRef<{
    pointer: number;
    x: number;
    y: number;
    width: number;
    dragging: boolean;
    preview: number;
    lastX: number;
    lastTime: number;
    velocity: number;
    offset: number;
  } | null>(null);
  // Keep the drag on the transform layer. React updates the selected card and its actions on release.
  function paint(offset: number) {
    const stage = track.current;
    if (!stage || !multiple) return;
    const current = index + offset;
    const front = Math.round(current);
    for (const child of stage.children) {
      const slide = child as HTMLElement;
      const position = Number(slide.dataset.slide);
      if (Math.abs(position - current) > 3.6 && slide.style.visibility === 'hidden') continue;
      const pose = deckPose(position - current, direction);
      slide.style.transform = pose.transform;
      const opacity = String(pose.opacity);
      if (slide.style.opacity !== opacity) slide.style.opacity = opacity;
      const visibility = pose.opacity === 0 ? 'hidden' : '';
      if (slide.style.visibility !== visibility) slide.style.visibility = visibility;
      // Change the stacking order only when a different card comes to the front.
      const order = String(100 - Math.abs(position - front));
      if (slide.style.zIndex !== order) slide.style.zIndex = order;
    }
  }
  useLayoutEffect(() => {
    if (multiple) paint(gesture.current?.offset ?? 0);
    else track.current?.firstElementChild?.removeAttribute('style');
  });
  useLayoutEffect(() => () => cancelAnimationFrame(frame.current), []);

  function stepTo(position: number) {
    const next = cards[position];
    if (next && !disabled && position !== index) onSelect(next.id);
  }
  function reset(position = index) {
    gesture.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0;
    if (track.current?.dataset.dragging) {
      delete track.current.dataset.dragging;
      paint(position - index);
    }
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
        ref={track}
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) => {
          if (!multiple || disabled || !event.isPrimary || event.button !== 0) return;
          const width =
            event.currentTarget.querySelector<HTMLElement>('[aria-hidden="false"]')!.offsetWidth;
          const slide = (event.target as Element).closest<HTMLElement>('[data-slide]');
          gesture.current = {
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            width,
            dragging: false,
            preview: slide ? Number(slide.dataset.slide) : index,
            lastX: event.clientX,
            lastTime: event.timeStamp,
            velocity: 0,
            offset: 0,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const g = gesture.current;
          if (!g || g.pointer !== event.pointerId) return;
          const dx = event.clientX - g.x;
          const dy = event.clientY - g.y;
          if (!g.dragging) {
            if (Math.abs(dy) > 5 && Math.abs(dy) > Math.abs(dx)) return reset();
            if (Math.abs(dx) < 4) return;
            g.dragging = true;
            event.currentTarget.dataset.dragging = 'true';
          }
          const elapsed = event.timeStamp - g.lastTime;
          if (elapsed > 0) {
            g.velocity = (event.clientX - g.lastX) / elapsed;
            g.lastX = event.clientX;
            g.lastTime = event.timeStamp;
          }
          // In the fan, adjacent cards are separated by 24% of a card width.
          // Mapping that distance to one step keeps the card under the finger.
          const progress = (-direction * dx) / (g.width * 0.24);
          const bounded = Math.max(
            -Math.min(1, index),
            Math.min(1, cards.length - 1 - index, progress),
          );
          g.offset = bounded + Math.tanh(progress - bounded) * 0.12;
          if (!frame.current) {
            frame.current = requestAnimationFrame(() => {
              frame.current = 0;
              if (gesture.current) paint(gesture.current.offset);
            });
          }
        }}
        onPointerUp={(event) => {
          const g = gesture.current;
          if (!g || g.pointer !== event.pointerId) return;
          const dx = event.clientX - g.x;
          const dy = event.clientY - g.y;
          let target = index;
          if (g.dragging && !disabled) {
            const velocity = event.timeStamp - g.lastTime < 90 ? g.velocity : 0;
            const projected = dx + Math.max(-24, Math.min(24, velocity * 70));
            if (Math.abs(dx) >= 8 && Math.abs(projected) >= Math.min(24, g.width * 0.09)) {
              target = Math.max(
                0,
                Math.min(cards.length - 1, index - direction * Math.sign(projected)),
              );
            }
          } else if (!disabled && Math.hypot(dx, dy) < 5) {
            target = g.preview;
          }
          reset(target);
          stepTo(target);
        }}
        onLostPointerCapture={() => reset()}
        onPointerCancel={() => reset()}
        tabIndex={multiple ? 0 : undefined}
        onKeyDown={(event) => {
          if (disabled || !multiple || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault();
          stepTo(index + ((event.key === 'ArrowRight') !== ar ? 1 : -1));
        }}
      >
        {cards.map((card, i) => (
          <div key={card.id} className="customer-slide" data-slide={i} aria-hidden={i !== index}>
            <LoyaltyCard
              card={card}
              lang={lang}
              waiting={i === index && waiting}
              reveal={i === index && reveal}
              motion={i === index && !celebrating ? 'normal' : 'quiet'}
            />
          </div>
        ))}
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
