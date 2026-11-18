import type { Language } from '../../../../packages/contracts/src/index.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';

/**
 * An item the plan locked after a downgrade: a lock, one line saying why, and what to do.
 * The owner gets a way to My plan; everyone else is told to ask the owner (no prices, ever).
 */
export function LockedBadge({
  lang,
  onOpenPlan,
  part = 'all',
}: {
  lang: Language;
  onOpenPlan?: () => void;
  /** pill: the lock chip in a row's status slot; reason: the line under the item's name. */
  part?: 'all' | 'pill' | 'reason';
}) {
  const ar = lang === 'ar';
  const pill = (
    <span className="status-pill warning locked-pill">
      <Icon name="lock" size={14} />
      {ar ? 'مقفول' : 'Locked'}
    </span>
  );
  if (part === 'pill') return pill;
  return (
    <span className="locked-note">
      {part === 'all' && pill}
      <small>
        {onOpenPlan
          ? ar
            ? 'برّه حدود باقتك، ومحفوظ زي ما هو.'
            : 'Over your plan’s limit, kept as it was.'
          : ar
            ? 'مقفول مؤقتًا. كلّم صاحب المحل.'
            : 'Locked for now. Ask the shop owner.'}
      </small>
      {onOpenPlan && (
        <button type="button" className="text-button" onClick={onOpenPlan}>
          {ar ? 'افتح باقتي' : 'Open my plan'}
        </button>
      )}
    </span>
  );
}
