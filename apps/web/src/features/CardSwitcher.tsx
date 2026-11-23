import { useEffectEvent, useLayoutEffect, useRef } from 'react';
import type { Language, SavedCard } from '../../../../packages/contracts/src/index.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';
import { LoyaltyCard } from '../../../../packages/ui/src/LoyaltyCard.js';
import './card-switcher.css';

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
  const track = useRef<HTMLDivElement>(null);
  const controlTarget = useRef<string | null>(null);
  const arrowTouch = useRef<{ x: number; y: number } | null>(null);
  const ar = lang === 'ar';
  const index = cards.findIndex((card) => card.id === cardId);
  const multiple = cards.length > 1;
  // Measure in viewport coordinates. Safari's RTL scrollLeft can be negative or overscroll.
  function align(position: number, smooth: boolean) {
    const rail = track.current;
    const slide = rail?.children[position];
    if (!rail || !slide) return;
    const delta = slide.getBoundingClientRect().left - rail.getBoundingClientRect().left;
    rail.scrollBy({
      left: delta,
      behavior:
        smooth && !matchMedia('(prefers-reduced-motion: reduce)').matches ? 'smooth' : 'auto',
    });
  }
  function stepTo(position: number) {
    const next = cards[position];
    if (!next || disabled) return;
    controlTarget.current = next.id;
    onSelect(next.id);
  }
  useLayoutEffect(() => {
    const rail = track.current;
    const slide = rail?.children[index];
    if (!rail || !slide) return;
    const fit = () => {
      rail.style.height = Math.ceil(slide.getBoundingClientRect().height) + 'px';
    };
    align(index, controlTarget.current === cardId);
    if (typeof ResizeObserver === 'undefined') return;
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(slide);
    return () => observer.disconnect();
  }, [index, lang, cardId]);

  const settle = useEffectEvent(() => {
    const rail = track.current;
    if (!rail) return;
    const left = rail.getBoundingClientRect().left;
    const distances = Array.from(rail.children, (slide) =>
      Math.abs(slide.getBoundingClientRect().left - left),
    );
    const distance = Math.min(...distances);
    const nearest = distances.indexOf(distance);
    if (controlTarget.current === cardId) {
      if (nearest === index && distance <= 2) controlTarget.current = null;
      return;
    }
    if (distance > 2) align(nearest, true);
    else if (nearest !== index) onSelect(cards[nearest]!.id);
  });

  // Wait for native momentum and snapping to settle before switching the card's actions.
  useLayoutEffect(() => {
    const rail = track.current;
    if (!rail || !multiple || disabled) return;
    let timer: number;
    let touching = false;
    const scroll = () => {
      clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!touching) settle();
      }, 90);
    };
    const startTouch = () => {
      controlTarget.current = null;
      touching = true;
    };
    const endTouch = () => {
      touching = false;
      scroll();
    };
    const interrupt = () => {
      controlTarget.current = null;
    };
    rail.addEventListener('wheel', interrupt, { passive: true });
    rail.addEventListener('touchstart', startTouch, { passive: true });
    rail.addEventListener('touchend', endTouch);
    rail.addEventListener('touchcancel', endTouch);
    rail.addEventListener('scroll', scroll, { passive: true });
    return () => {
      clearTimeout(timer);
      rail.removeEventListener('wheel', interrupt);
      rail.removeEventListener('touchstart', startTouch);
      rail.removeEventListener('touchend', endTouch);
      rail.removeEventListener('touchcancel', endTouch);
      rail.removeEventListener('scroll', scroll);
    };
  }, [multiple, disabled]);

  return (
    <section
      className="customer-carousel"
      dir={ar ? 'rtl' : 'ltr'}
      aria-roledescription={multiple ? (ar ? 'عارض كروت' : 'carousel') : undefined}
      aria-label={ar ? 'كروتي' : 'My cards'}
    >
      <div
        className="customer-card-track"
        ref={track}
        data-locked={!multiple || disabled}
        tabIndex={multiple ? 0 : undefined}
        onKeyDown={(event) => {
          if (disabled || !multiple || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
          event.preventDefault();
          stepTo(index + ((event.key === 'ArrowRight') !== ar ? 1 : -1));
        }}
      >
        {cards.map((card, i) => (
          <div key={card.id} className="customer-slide" aria-hidden={i !== index}>
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
