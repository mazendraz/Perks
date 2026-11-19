import { useEffect, useState } from 'react';

/**
 * A tab kept in the address bar (?tab=customers): refresh, Back and a shared link all land on the
 * same tab, and switching tabs starts at the top of the page.
 */
export function useUrlTab(initial: string, allowed: readonly string[], param = 'tab') {
  const read = () => {
    const value = new URLSearchParams(location.search).get(param);
    return value && allowed.includes(value) ? value : initial;
  };
  const [tab, setTabState] = useState(read);
  useEffect(() => {
    const back = () => setTabState(read());
    window.addEventListener('popstate', back);
    return () => window.removeEventListener('popstate', back);
  }, []);
  const setTab = (next: string) => {
    if (next === tab) return;
    const url = new URL(location.href);
    if (next === initial) url.searchParams.delete(param);
    else url.searchParams.set(param, next);
    history.pushState(history.state, '', url);
    setTabState(next);
    window.scrollTo({ top: 0 });
  };
  return [tab, setTab] as const;
}
