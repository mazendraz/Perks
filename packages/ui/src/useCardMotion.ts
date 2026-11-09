import { useLayoutEffect, useEffect, useRef, useState } from 'react';
import type { CardData } from '../../contracts/src/index.js';
import { stampMotion, rewardMotion, type MotionRun } from './stamp-motion.js';
const revealedCards = new Set<string>();
export function useCardMotion(
  card: CardData,
  balance: number,
  threshold: number,
  experience: boolean,
  waiting: boolean,
  reveal: boolean,
) {
  const article = useRef<HTMLElement>(null),
    layer = useRef<HTMLDivElement>(null),
    banner = useRef<HTMLDivElement>(null),
    progress = useRef<HTMLSpanElement>(null);
  const [visualBalance, setVisualBalance] = useState(balance),
    [kind, setKind] = useState(''),
    [bannerReady, setBannerReady] = useState(!!card.pending_rewards);
  const previous = useRef({
    id: card.id,
    revision: card.revision,
    balance,
    rawBalance: card.balance,
    cycle: card.cycle_number ?? 1,
    rewards: card.pending_rewards ?? 0,
  });
  const runs = useRef<MotionRun[]>([]),
    timers = useRef<number[]>([]),
    extra = useRef<Animation[]>([]);
  const cancel = () => {
    runs.current.forEach((run) => run.cancel());
    runs.current = [];
    timers.current.forEach(window.clearTimeout);
    timers.current = [];
    extra.current.forEach((animation) => animation.cancel());
    extra.current = [];
  };
  useEffect(() => () => cancel(), []);
  useLayoutEffect(() => {
    const prev = previous.current,
      cycle = card.cycle_number ?? 1,
      rewards = card.pending_rewards ?? 0;
    previous.current = {
      id: card.id,
      revision: card.revision,
      balance,
      rawBalance: card.balance,
      cycle,
      rewards,
    };
    if (
      prev.id === card.id &&
      prev.revision === card.revision &&
      prev.balance === balance &&
      prev.cycle === cycle &&
      prev.rewards === rewards
    )
      return;
    cancel();
    const element = article.current,
      fx = layer.current;
    if (!experience || !element || !fx || prev.id !== card.id) {
      setVisualBalance(balance);
      setBannerReady(!!rewards);
      setKind('');
      return;
    }
    const reduced =
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      typeof element.animate !== 'function';
    const renewed = cycle > prev.cycle,
      earned = rewards > prev.rewards;
    const celebrate = () => {
      setBannerReady(!!rewards);
      if (!rewards || !banner.current) return;
      runs.current.push(
        rewardMotion(
          element,
          banner.current,
          fx,
          [card.accent_color, card.surface_color, card.primary_color],
          reduced,
        ),
      );
    };
    if (renewed) {
      setKind('cycle-renew');
      setVisualBalance(balance);
      setBannerReady(!!rewards);
      if (!reduced) {
        const a = element.animate(
          [
            { opacity: 0.6, transform: 'perspective(1000px) rotateY(-8deg) translateY(10px)' },
            {
              opacity: 1,
              transform: 'perspective(1000px) rotateY(2deg) translateY(-2px)',
              offset: 0.65,
            },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 700, easing: 'cubic-bezier(.2,.8,.2,1)' },
        );
        a.id = 'nuqta-cycle-renew';
        extra.current.push(a);
      }
    } else if (balance > prev.balance || card.balance > prev.rawBalance || earned) {
      setKind(earned ? 'reward-earned' : 'stamp-added');
      setBannerReady(earned ? false : !!rewards);
      setVisualBalance(Math.min(prev.balance, balance));
      const indices = Array.from(
        { length: Math.max(0, balance - prev.balance) },
        (_, i) => prev.balance + i,
      );
      const base = element.getBoundingClientRect();
      // Batch all layout reads before adding FX nodes or starting any animation.
      const targets = indices.map((index) => {
        const slot = element.querySelector<HTMLElement>('[data-stamp-index="' + index + '"]')!,
          rect = slot.getBoundingClientRect(),
          ink = slot.querySelector<HTMLElement>('.nq-ink-layer')!;
        return {
          index,
          slot,
          ink,
          position: {
            x: rect.left - base.left + rect.width / 2,
            y: rect.top - base.top + rect.height / 2,
            width: rect.width,
            height: rect.height,
          },
        };
      });
      for (const [order, target] of targets.entries()) {
        const mark = card.stamp_ink?.[target.index],
          seed = mark
            ? mark.ledgerId + ':' + mark.ordinal
            : card.id + ':' + cycle + ':' + target.index;
        runs.current.push(
          stampMotion({
            card: element,
            layer: fx,
            ...target,
            seed,
            shape: card.stamp_shape,
            delay: reduced ? 0 : order * 350,
            reduced,
            onImpact: () => setVisualBalance((current) => Math.max(current, target.index + 1)),
          }),
        );
      }
      if (earned) {
        const when = reduced ? 0 : indices.length ? (indices.length - 1) * 350 + 650 : 0;
        timers.current.push(window.setTimeout(celebrate, when));
      }
    } else {
      setVisualBalance(balance);
      setBannerReady(!!rewards);
      setKind('');
    }
    timers.current.push(
      window.setTimeout(
        () => setKind(''),
        Math.max(1600, Math.max(0, balance - prev.balance - 1) * 350 + 2000),
      ),
    );
  }, [
    card.id,
    card.revision,
    card.cycle_number,
    card.pending_rewards,
    card.balance,
    balance,
    threshold,
    experience,
  ]);
  useLayoutEffect(() => {
    const element = article.current;
    if (!experience || !reveal || !element) return;
    const key = 'nuqta-card-reveal:' + card.id;
    try {
      if (sessionStorage.getItem(key)) return;
    } catch {
      /* Memory fallback below. */
    }
    if (revealedCards.has(key)) return;
    const remember = () => {
      revealedCards.add(key);
      try {
        sessionStorage.setItem(key, '1');
      } catch {
        /* Storage is optional. */
      }
      const query = new URLSearchParams(location.search);
      if (query.has('new')) {
        query.delete('new');
        history.replaceState(
          history.state,
          '',
          location.pathname + (query.toString() ? '?' + query : ''),
        );
      }
    };
    if (
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      typeof element.animate !== 'function'
    ) {
      remember();
      return;
    }
    const animation = element.animate(
      [
        { opacity: 0, transform: 'perspective(1000px) translateY(18px) rotateY(-6deg)' },
        { opacity: 1, transform: 'none' },
      ],
      { duration: 720, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
    animation.id = 'nuqta-first-card';
    // Chrome80 supports WAAPI but not Animation.finished (added in84).
    // The finish event keeps completion and cancellation semantics on it too.
    animation.onfinish = remember;
    return () => {
      animation.onfinish = null;
      animation.cancel();
    };
  }, [card.id, experience, reveal]);
  useLayoutEffect(() => {
    const ghost = article.current?.querySelector<HTMLElement>(
      '[data-stamp-index="' + balance + '"] .nq-ghost',
    );
    if (!experience || !waiting || !ghost) return;
    if (
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      typeof ghost.animate !== 'function'
    ) {
      ghost.style.opacity = '.6';
      return () => {
        ghost.style.opacity = '';
      };
    }
    const animation = ghost.animate(
      [
        { opacity: 0.15, transform: 'scale(.92)' },
        { opacity: 0.7, transform: 'scale(1.04)' },
      ],
      { duration: 900, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' },
    );
    animation.id = 'nuqta-waiting-ghost';
    return () => animation.cancel();
  }, [card.id, waiting, balance, experience]);
  const progressRun = useRef<{ animation: Animation; from: number; to: number } | null>(null),
    ratio = useRef(balance / threshold);
  useLayoutEffect(() => {
    const element = progress.current,
      to = visualBalance / threshold,
      old = progressRun.current;
    let from = ratio.current;
    if (old) {
      const elapsed = old.animation.effect?.getComputedTiming().progress;
      if (typeof elapsed === 'number') from = old.from + (old.to - old.from) * elapsed;
      old.animation.cancel();
    }
    ratio.current = to;
    progressRun.current = null;
    if (
      !experience ||
      !element ||
      Math.abs(from - to) < 0.0001 ||
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      typeof element.animate !== 'function'
    )
      return;
    const animation = element.animate(
      [{ transform: 'scaleX(' + from + ')' }, { transform: 'scaleX(' + to + ')' }],
      { duration: 500, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
    animation.id = 'nuqta-progress';
    progressRun.current = { animation, from, to };
  }, [visualBalance, threshold, experience]);
  useEffect(() => () => progressRun.current?.animation.cancel(), []);
  return { article, layer, banner, progress, visualBalance, kind, bannerReady };
}
