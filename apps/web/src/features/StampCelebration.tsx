import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { Language, SavedCard } from '../../../../packages/contracts/src/index.js';
import { LoyaltyCard } from '../../../../packages/ui/src/LoyaltyCard.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';
export interface StampMoment {
  /** The card as it was before the cashier approved. */
  from: SavedCard;
  /** The card now. Later approvals while open just move this forward. */
  to: SavedCard;
}
const shownBalance = (c: SavedCard) => c.display_balance ?? c.balance;
/** True when the card gained stamps or a reward since `before`. */
export function gainedStamp(before: SavedCard, after: SavedCard) {
  return (
    before.id === after.id &&
    after.revision > before.revision &&
    (shownBalance(after) > shownBalance(before) ||
      (after.pending_rewards ?? 0) > (before.pending_rewards ?? 0))
  );
}
function stampsLeft(n: number, ar: boolean) {
  if (!ar) return n === 1 ? '1 stamp' : n + ' stamps';
  if (n === 1) return 'ختم واحد';
  if (n === 2) return 'ختمين';
  return n + (n <= 10 ? ' أختام' : ' ختم');
}
// The moment the cashier approves: the card comes up over everything and the new stamp is
// pressed in front of the customer, with a vibration. It opens on the card as it was, then
// moves to the new card so the card's own stamp animation plays here.
export function StampCelebration({
  moment,
  lang,
  onClose,
}: {
  moment: StampMoment;
  lang: Language;
  onClose: () => void;
}) {
  const ar = lang === 'ar',
    [shown, setShown] = useState(moment.from),
    [leaving, setLeaving] = useState(false),
    close = useRef(onClose),
    button = useRef<HTMLButtonElement>(null);
  close.current = onClose;
  const reduced =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Let the card arrive first, then press the stamp.
  useEffect(() => {
    const t = window.setTimeout(() => setShown(moment.to), reduced ? 0 : 420);
    return () => window.clearTimeout(t);
  }, [moment.to]);
  const reward = (moment.to.pending_rewards ?? 0) > (moment.from.pending_rewards ?? 0),
    added = Math.max(1, shownBalance(moment.to) - shownBalance(moment.from)),
    left = Math.max(0, moment.to.threshold - shownBalance(moment.to));
  const dismiss = () => {
    if (leaving) return;
    if (reduced) return close.current();
    setLeaving(true);
    window.setTimeout(() => close.current(), 220);
  };
  // Closes by itself after the animation has had time to land; any tap closes it sooner.
  useEffect(() => {
    const t = window.setTimeout(dismiss, (reward ? 6500 : 4200) + (added - 1) * 350);
    return () => window.clearTimeout(t);
  }, [moment.to, reward, added]);
  useEffect(() => {
    button.current?.focus({ preventScroll: true });
    const key = (e: KeyboardEvent) => e.key === 'Escape' && dismiss();
    document.addEventListener('keydown', key);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', key);
      document.body.style.overflow = overflow;
    };
  }, []);
  return createPortal(
    <div
      className={'stamp-moment' + (leaving ? ' is-leaving' : '') + (reward ? ' is-reward' : '')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="stamp-moment-title"
      onClick={dismiss}
    >
      <div className="stamp-moment-body">
        <div className="stamp-moment-heading" aria-live="polite">
          {reward && <Icon name="gift" size={34} />}
          <h2 id="stamp-moment-title">
            {reward
              ? ar
                ? 'مبروك! كسبت مكافأتك'
                : 'Congrats! You earned your reward'
              : added > 1
                ? ar
                  ? 'اتضافلك ' + stampsLeft(added, true) + '!'
                  : added + ' new stamps!'
                : ar
                  ? 'ختم جديد!'
                  : 'New stamp!'}
          </h2>
          <p>
            {reward
              ? (moment.to.reward_title ?? '') +
                (ar ? ' · ورّي الكارت للكاشير وخدها' : ' · show your card to the cashier')
              : left > 0
                ? ar
                  ? 'فاضلك ' +
                    stampsLeft(left, true) +
                    ' على ' +
                    (moment.to.reward_title ?? 'المكافأة')
                  : stampsLeft(left, false) +
                    ' to go for ' +
                    (moment.to.reward_title ?? 'your reward')
                : ''}
          </p>
        </div>
        <div className="stamp-moment-card">
          <LoyaltyCard card={shown} lang={lang} motion="celebrate" />
        </div>
        <button ref={button} type="button" className="primary stamp-moment-done" onClick={dismiss}>
          {ar ? 'تمام' : 'Done'}
        </button>
      </div>
    </div>,
    document.body,
  );
}
