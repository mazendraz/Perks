import type { ReactNode } from 'react';
import { Icon } from '../../../../packages/ui/src/Icon.js';
import './why-disabled.css';

/**
 * One short line under a button that cannot be used right now, saying why and what unlocks it.
 * A grey button with no reason leaves people guessing; render this whenever the cause is
 * something the person can understand or fix (not while a request is merely in flight).
 * Pass nothing (or false) and it renders nothing, so it can sit next to the button always.
 */
export function WhyDisabled({ children, id }: { children?: ReactNode | false; id?: string }) {
  if (!children) return null;
  return (
    <small className="why-disabled" id={id}>
      <Icon name="lock" size={14} />
      <span>{children}</span>
    </small>
  );
}
