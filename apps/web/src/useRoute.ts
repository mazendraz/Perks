import { useEffect, useState } from 'react';
export function navigate(path: string) {
  history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
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
