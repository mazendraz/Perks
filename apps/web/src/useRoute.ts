import { useEffect, useState } from 'react';
import { applyUpdateOnNavigation } from './update-gate.js';
export function navigate(path: string) {
  if (applyUpdateOnNavigation(path)) return;
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
  document.querySelector('.customer-page-scroll')?.scrollTo(0, 0);
  window.scrollTo(0, 0);
}
export function useRoute() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const fn = () => setPath(location.pathname);
    addEventListener('popstate', fn);
    return () => removeEventListener('popstate', fn);
  }, []);
  return path;
}
