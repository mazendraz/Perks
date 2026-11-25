import { useEffect } from 'react';

// The Perks header is sticky in every portal. Its height changes with the language, the screen
// width and the phone's top safe area, so it is measured and published as --app-header-h for
// the other sticky bars and for scroll-padding (focus and anchors never land under it).
export function useStickyHeaderHeight(header: HTMLElement | null) {
  useEffect(() => {
    const root = document.documentElement;
    if (!header) {
      root.style.removeProperty('--app-header-h');
      return;
    }
    const publish = () =>
      root.style.setProperty(
        '--app-header-h',
        Math.ceil(header.getBoundingClientRect().height) + 'px',
      );
    publish();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(publish);
    observer.observe(header);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--app-header-h');
    };
  }, [header]);
}
