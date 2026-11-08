import { useEffect } from 'react';
export function useDialogAccessibility() {
  useEffect(() => {
    let dialog: HTMLElement | null = null,
      restore: HTMLElement | null = null,
      lastOutside = document.activeElement as HTMLElement | null,
      overflow = '';
    const focusable = () =>
      dialog
        ? Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
            ),
          ).filter((e) => e.getClientRects().length > 0)
        : [];
    const focusFirst = () => {
      const target = focusable()[0] || dialog;
      if (target) {
        if (target === dialog) target.tabIndex = -1;
        target.focus();
      }
    };
    const focus = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (!dialog) {
        if (!target.closest('[role="dialog"]')) lastOutside = target;
      } else if (!dialog.contains(target)) focusFirst();
    };
    const key = (event: KeyboardEvent) => {
      if (!dialog) return;
      if (event.key === 'Escape') {
        if ((event.target as HTMLElement).closest('[data-control][data-open="true"]')) return;
        const close = dialog.querySelector<HTMLButtonElement>(
          'button[data-dialog-close]:not(:disabled)',
        );
        if (close) {
          event.preventDefault();
          close.click();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable(),
        first = elements[0],
        last = elements.at(-1);
      if (!first) {
        event.preventDefault();
        focusFirst();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    const sync = () => {
      const next = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
      if (next === dialog) return;
      if (dialog) {
        document.body.style.overflow = overflow;
        dialog = null;
        if (restore?.isConnected) restore.focus();
      }
      if (next) {
        restore = lastOutside;
        overflow = document.body.style.overflow;
        dialog = next;
        document.body.style.overflow = 'hidden';
        if (!dialog.contains(document.activeElement)) focusFirst();
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('focusin', focus);
    document.addEventListener('keydown', key, true);
    sync();
    return () => {
      observer.disconnect();
      document.removeEventListener('focusin', focus);
      document.removeEventListener('keydown', key, true);
      if (dialog) document.body.style.overflow = overflow;
    };
  }, []);
}
