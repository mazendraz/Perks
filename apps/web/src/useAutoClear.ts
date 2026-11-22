import { useEffect } from 'react';

/** How long a cashier's "done" confirmation stays on screen before it clears itself. */
export const RESULT_VISIBLE_MS = 10_000;

/**
 * Clears a transient result (e.g. "Stamp added") after `ms`, so a busy counter screen does not keep
 * old confirmations around. A newer result restarts the countdown.
 */
export function useAutoClear<T>(value: T | null, clear: () => void, ms = RESULT_VISIBLE_MS) {
  useEffect(() => {
    if (value === null) return;
    const timer = window.setTimeout(clear, ms);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
}
