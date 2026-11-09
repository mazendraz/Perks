import { useEffect } from 'react';
import { api, ApiError, errorText } from './api.js';
import type { SavedCard, Language } from '../../../packages/contracts/src/index.js';

// A deterministic command key, not an authentication proof. Two independent
// 32-bit hashes keep public placement codes of any allowed length below 120 chars.
function requestKey(member: string, code: string, at: number) {
  let a = 2166136261,
    b = 5381;
  for (let i = 0; i < code.length; i++) {
    a = Math.imul(a ^ code.charCodeAt(i), 16777619);
    b = Math.imul(b, 33) ^ code.charCodeAt(i);
  }
  return (
    'auto:' +
    member +
    ':' +
    (a >>> 0).toString(16) +
    (b >>> 0).toString(16) +
    ':' +
    Math.floor(at / 600000)
  );
}
export function useAutoStampRequest(
  card: SavedCard,
  branch: string,
  validBranch: boolean,
  lang: Language,
  onSaved: () => Promise<void>,
  onError: (message: string) => void,
) {
  useEffect(() => {
    const query = new URLSearchParams(location.search),
      code = query.get('code');
    if (query.get('auto') !== '1' || !branch || !code) return;
    if (!validBranch) {
      onError(
        lang === 'ar'
          ? 'الفرع ده مش متاح دلوقتي. اسأل فريق المحل عن الكود الحالي.'
          : 'This branch is unavailable. Ask the shop team for its current code.',
      );
      return;
    }
    const at = Number(query.get('at')) || Date.now();
    query.set('at', String(at));
    history.replaceState(history.state, '', location.pathname + '?' + query);
    const key = requestKey(card.id, code, at);
    let alive = true,
      done = false,
      inFlight = false;
    const send = async () => {
      if (!alive || done || inFlight || document.hidden) return;
      if (Date.now() - at >= 600000) {
        done = true;
        onError(
          lang === 'ar'
            ? 'الطلب خلص، اعمل سكان تاني.'
            : 'The request expired. Scan the shop code again.',
        );
        return;
      }
      inFlight = true;
      try {
        await api('/me/stamp-requests', {
          method: 'POST',
          key,
          body: { membershipId: card.id, branchId: branch, placementCode: code },
        });
        if (!alive) return;
        done = true;
        const latestQuery = new URLSearchParams(location.search);
        latestQuery.delete('auto');
        history.replaceState(history.state, '', location.pathname + '?' + latestQuery);
        onError('');
        await onSaved();
      } catch (error) {
        if (!alive) return;
        if (error instanceof ApiError && error.status === 0)
          onError(
            lang === 'ar'
              ? 'مفيش نت، هنبعت الطلب أول ما يرجع.'
              : 'You’re offline. We’ll send the request when you reconnect.',
          );
        else {
          done = true;
          onError(errorText(error, lang).split(' · ')[0]!);
        }
      } finally {
        inFlight = false;
      }
    };
    void send();
    const retry = () => {
      if (!navigator.onLine) return;
      void send();
    };
    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', retry);
    const interval = window.setInterval(retry, 3000);
    return () => {
      alive = false;
      window.clearInterval(interval);
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', retry);
    };
  }, [card.id, branch, validBranch, lang]);
}
