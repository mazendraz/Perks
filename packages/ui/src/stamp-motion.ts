import { stampGeometry, stampRandom } from './StampInk.js';
import type { StampShape } from '../../contracts/src/branding.js';
export interface MotionRun {
  cancel: () => void;
  finished: Promise<void>;
}
let toolSequence = 0;
// Timings match docs/design/stamp-motion-v2.html. Geometry is read once before
// each tool starts; animations only write transform/opacity (reward glow excepted).
export function stampMotion({
  card,
  slot,
  ink,
  layer,
  seed,
  shape = 'circle',
  delay: startDelay = 0,
  reduced = false,
  onImpact,
  position,
}: {
  card: HTMLElement;
  slot: HTMLElement;
  ink: HTMLElement;
  layer: HTMLElement;
  seed: string;
  shape?: StampShape;
  delay?: number;
  reduced?: boolean;
  onImpact: () => void;
  position?: { x: number; y: number; width: number; height: number };
}): MotionRun {
  const animations: Animation[] = [],
    nodes: HTMLElement[] = [],
    timers: number[] = [];
  let cancelled = false,
    resolveFinished: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  const animate = (
    element: Element,
    frames: Keyframe[],
    options: KeyframeAnimationOptions,
    id: string,
  ) => {
    const animation = element.animate(frames, options);
    animation.id = id;
    animations.push(animation);
    return animation;
  };
  const later = (fn: () => void, ms: number) => {
    timers.push(
      window.setTimeout(() => {
        if (!cancelled) fn();
      }, ms),
    );
  };
  const cleanup = () => {
    for (const node of nodes) node.remove();
  };
  if (reduced || typeof slot.animate !== 'function') {
    onImpact();
    if (typeof ink.animate === 'function')
      animate(
        ink,
        [{ filter: 'brightness(1.6)' }, { filter: 'none' }],
        { duration: 300 },
        'nuqta-ink-reduced',
      );
    later(resolveFinished, 300);
  } else {
    const start = () => {
      const delay = 0;
      const base = position ? null : card.getBoundingClientRect(),
        rect = position ?? slot.getBoundingClientRect();
      const x = position ? position.x : (rect as DOMRect).left - base!.left + rect.width / 2,
        y = position ? position.y : (rect as DOMRect).top - base!.top + rect.height / 2;
      const { angle } = stampGeometry(seed, shape),
        random = stampRandom(seed + ':flight');
      const fragment = document.createDocumentFragment();
      const node = (className: string) => {
        const element = document.createElement('div');
        element.className = className;
        element.style.left = x + 'px';
        element.style.top = y + 'px';
        fragment.append(element);
        nodes.push(element);
        return element;
      };
      const tool = node('nq-stamp-tool'),
        shadow = node('nq-stamp-shadow'),
        gradient = 'nq-tool-wood-' + ++toolSequence;
      // Static SVG only; brand ink comes from currentColor, never HTML interpolation.
      tool.innerHTML =
        '<svg viewBox="0 0 74 96" width="74" height="96" aria-hidden="true"><defs><linearGradient id="' +
        gradient +
        '" x1="0" x2="1"><stop offset="0" stop-color="#3b2a1a"/><stop offset=".5" stop-color="#6a4a2c"/><stop offset="1" stop-color="#3b2a1a"/></linearGradient></defs><ellipse cx="37" cy="14" rx="15" ry="11" fill="url(#' +
        gradient +
        ')"/><rect x="31" y="20" width="12" height="34" rx="5" fill="url(#' +
        gradient +
        ')"/><rect x="12" y="52" width="50" height="16" rx="6" fill="#2a1f15"/><rect x="9" y="66" width="56" height="12" rx="4" fill="currentColor"/><rect x="9" y="76" width="56" height="4" rx="2" fill="currentColor" opacity=".75"/></svg>';
      const ring = node('nq-stamp-ring');
      const frame = slot.querySelector('.stamp-frame')?.cloneNode(true);
      if (frame) ring.append(frame);
      ring.style.width = rect.width + 'px';
      ring.style.height = rect.height + 'px';
      ring.style.marginLeft = -rect.width / 2 + 'px';
      ring.style.marginTop = -rect.height / 2 + 'px';
      const dots = Array.from({ length: 7 }, () => ({
        dot: node('nq-ink-dot'),
        a: random() * Math.PI * 2,
        r: 30 + random() * 20,
        s: 0.5 + random() * 0.9,
        duration: 380 + random() * 120,
      }));
      // Construct transient effects while detached, so each WAAPI call cannot
      // force a style/layout pass over the live card. Connect the tree once.
      const rotate = ' rotate(' + angle + 'deg)';
      // One compositor track per tool/shadow avoids competing forwards-filled
      // effects. Segment offsets/easings keep the approved timings unchanged.
      animate(
        tool,
        [
          {
            offset: 0,
            opacity: 0,
            transform: 'translateY(-40px) scale(1.25)' + rotate,
            easing: 'ease-out',
          },
          {
            offset: 120 / 640,
            opacity: 1,
            transform: 'translateY(-30px) scale(1.2)' + rotate,
            easing: 'cubic-bezier(.55,0,.9,.4)',
          },
          {
            offset: 300 / 640,
            opacity: 1,
            transform: 'translateY(0) scale(1)' + rotate,
            easing: 'linear',
          },
          {
            offset: 360 / 640,
            opacity: 1,
            transform: 'translateY(3px) scale(1.04,.9)' + rotate,
            easing: 'linear',
          },
          {
            offset: 420 / 640,
            opacity: 1,
            transform: 'translateY(0) scale(1)' + rotate,
            easing: 'ease-in',
          },
          { offset: 1, opacity: 0, transform: 'translateY(-44px) scale(1.12)' + rotate },
        ],
        { delay, duration: 640, fill: 'forwards' },
        'nuqta-tool',
      );
      animate(
        shadow,
        [
          { offset: 0, opacity: 0, transform: 'scale(.45)', easing: 'linear' },
          { offset: 120 / 500, opacity: 0.35, transform: 'scale(.7)', easing: 'ease-in' },
          { offset: 300 / 500, opacity: 0.85, transform: 'scale(1)', easing: 'linear' },
          { offset: 1, opacity: 0, transform: 'scale(1)' },
        ],
        { delay, duration: 500, fill: 'forwards' },
        'nuqta-shadow',
      );
      animate(
        ink,
        [
          { opacity: 0, transform: 'scale(1.18)' },
          { opacity: 1, transform: 'scale(.97)', offset: 0.6 },
          { opacity: 1, transform: 'scale(1)' },
        ],
        { delay: delay + 300, duration: 220, fill: 'both', easing: 'ease-out' },
        'nuqta-stamp-ink',
      );
      animate(
        card,
        [
          { transform: 'none' },
          { transform: 'translateY(3px) scale(.988)' },
          { transform: 'none' },
        ],
        { delay: delay + 300, duration: 160, easing: 'ease-out' },
        'nuqta-card-thud',
      );
      animate(
        ring,
        [
          { opacity: 0.8, transform: 'scale(1)' },
          { opacity: 0, transform: 'scale(1.7)' },
        ],
        { delay: delay + 300, duration: 420, easing: 'ease-out', fill: 'forwards' },
        'nuqta-ink-ring',
      );
      for (const { dot, a, r, s, duration } of dots) {
        animate(
          dot,
          [
            { opacity: 1, transform: 'translate(0,0) scale(' + s + ')' },
            {
              opacity: 0,
              transform:
                'translate(' +
                Math.cos(a) * r +
                'px,' +
                Math.sin(a) * r +
                'px) scale(' +
                s * 0.4 +
                ')',
            },
          ],
          {
            delay: delay + 300,
            duration,
            easing: 'cubic-bezier(.1,.7,.3,1)',
            fill: 'both',
          },
          'nuqta-ink-flight',
        );
      }
      layer.append(fragment);
      later(() => {
        onImpact();
        try {
          navigator.vibrate?.(25);
        } catch {
          /* Optional haptic. */
        }
      }, delay + 300);
      later(resolveFinished, delay + 650);
      later(() => {
        animations.forEach((animation) => animation.cancel());
        cleanup();
      }, delay + 810);
    };
    // Build each staggered tool when its flight starts, rather than creating
    // three SVG/particle trees and every WAAPI effect in one main-thread task.
    if (startDelay) later(start, startDelay);
    else start();
  }
  return {
    finished,
    cancel: () => {
      cancelled = true;
      timers.forEach(window.clearTimeout);
      animations.forEach((animation) => animation.cancel());
      cleanup();
      resolveFinished();
    },
  };
}
export function rewardMotion(
  card: HTMLElement,
  banner: HTMLElement,
  layer: HTMLElement,
  colors: string[],
  reduced: boolean,
): MotionRun {
  const animations: Animation[] = [],
    timers: number[] = [];
  let frame = 0,
    cancelled = false,
    resolveFinished: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });
  const canvas = document.createElement('canvas');
  canvas.className = 'nq-confetti';
  if (reduced || typeof card.animate !== 'function') {
    banner.style.opacity = '1';
    return { finished: Promise.resolve(), cancel: () => {} };
  }
  const accent = colors[0]!,
    animate = (
      element: HTMLElement,
      frames: Keyframe[],
      options: KeyframeAnimationOptions,
      id: string,
    ) => {
      const a = element.animate(frames, options);
      a.id = id;
      animations.push(a);
    };
  animate(
    card,
    [
      { boxShadow: '0 18px 40px #0b1a1240,0 0 0 0 ' + accent + '00' },
      { boxShadow: '0 18px 40px #0b1a1240,0 0 0 10px ' + accent + '55' },
      { boxShadow: '0 18px 40px #0b1a1240,0 0 0 0 ' + accent + '00' },
    ],
    { duration: 900, easing: 'ease-out' },
    'nuqta-reward-glow',
  );
  animate(
    banner,
    [
      { opacity: 0, transform: 'translateY(12px) scale(.96)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: 380, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'forwards' },
    'nuqta-reward-banner',
  );
  const rect = card.getBoundingClientRect(),
    W = rect.width,
    H = rect.height,
    dpr = Math.min(2, devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  layer.append(canvas);
  const context = canvas.getContext('2d');
  if (context) {
    context.scale(dpr, dpr);
    const random = stampRandom('reward:' + card.dataset.cardId + ':' + card.dataset.cardRevision);
    const particles = Array.from({ length: 44 }, () => ({
      x: W / 2 + (random() - 0.5) * 60,
      y: H * 0.35,
      vx: (random() - 0.5) * 7,
      vy: -4 - random() * 6,
      r: random() * 6.28,
      vr: (random() - 0.5) * 0.4,
      w: 5 + random() * 5,
      h: 3 + random() * 4,
      c: colors[Math.floor(random() * colors.length)]!,
    }));
    canvas.dataset.particles = '44';
    const start = performance.now();
    let last = start;
    const draw = (now: number) => {
      if (cancelled) return;
      const elapsed = now - start,
        delta = Math.min(2, (now - last) / (1000 / 60));
      last = now;
      context.clearRect(0, 0, W, H);
      for (const p of particles) {
        p.vy += 0.22 * delta;
        p.vx *= 0.99 ** delta;
        p.x += p.vx * delta;
        p.y += p.vy * delta;
        p.r += p.vr * delta;
        context.save();
        context.translate(p.x, p.y);
        context.rotate(p.r);
        context.globalAlpha = Math.max(0, 1 - elapsed / 1300);
        context.fillStyle = p.c;
        context.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        context.restore();
      }
      if (elapsed < 1300) frame = requestAnimationFrame(draw);
      else {
        canvas.remove();
        resolveFinished();
      }
    };
    frame = requestAnimationFrame(draw);
  } else {
    canvas.remove();
    timers.push(window.setTimeout(resolveFinished, 1300));
  }
  return {
    finished,
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      timers.forEach(window.clearTimeout);
      animations.forEach((a) => a.cancel());
      canvas.remove();
      resolveFinished();
    },
  };
}
