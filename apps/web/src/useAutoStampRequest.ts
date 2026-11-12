import { useEffect, useRef, useState } from 'react';
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
interface Collection {
  outcome: 'awarded' | 'pending' | 'location_required' | 'not_eligible';
  reason?: string;
  nextAt?: string;
}
interface Position {
  latitude: number;
  longitude: number;
  accuracy: number;
}
export type CollectionNotice = { tone: 'info' | 'error'; text: string; retry?: boolean } | null;

// What the customer reads when this visit gives no stamp. Deliberately plain: it never explains
// the shop's rules (daily limits, cooldowns, location checks), so the checks cannot be learned
// and worked around. Never shown with a stamp animation.
export function collectionReason(result: Collection, lang: Language) {
  const ar = lang === 'ar';
  if (result.reason === 'limit_reached' || result.reason === 'cooldown')
    return ar ? 'ختمك اتسجل خلاص ✓' : 'Your stamp is already counted ✓';
  return ar
    ? 'ورّي كارتك للكاشير وهو يضيف ختمك.'
    : 'Show your card to the cashier to add your stamp.';
}
const locate = () =>
  new Promise<Position | 'denied' | 'unavailable'>((resolve) => {
    if (!navigator.geolocation) return resolve('unavailable');
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          latitude: p.coords.latitude,
          longitude: p.coords.longitude,
          accuracy: p.coords.accuracy,
        }),
      (e) => resolve(e.code === e.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  });

// A sticker tap or scan arrives as ?auto=1&code=…. The server alone decides what it becomes:
// a stamp now, a request for the cashier, a location prompt, or a reason for no stamp.
export function useAutoStampRequest(
  card: SavedCard,
  branch: string,
  validBranch: boolean,
  lang: Language,
  onSaved: () => Promise<void>,
  onAwarded: () => Promise<void> | void,
) {
  const [notice, setNotice] = useState<CollectionNotice>(null),
    [attempt, setAttempt] = useState(0);
  const saved = useRef(onSaved),
    awarded = useRef(onAwarded);
  saved.current = onSaved;
  awarded.current = onAwarded;
  useEffect(() => {
    const query = new URLSearchParams(location.search),
      code = query.get('code');
    if (query.get('auto') !== '1' || !branch || !code) return;
    const ar = lang === 'ar';
    if (!validBranch) {
      setNotice({
        tone: 'error',
        text: ar
          ? 'الفرع ده مش متاح دلوقتي. اسأل فريق المحل عن الكود الحالي.'
          : 'This branch is unavailable. Ask the shop team for its current code.',
      });
      return;
    }
    const at = Number(query.get('at')) || Date.now();
    query.set('at', String(at));
    history.replaceState(history.state, '', location.pathname + '?' + query);
    let alive = true,
      done = false,
      inFlight = false;
    const finish = () => {
      done = true;
      const latest = new URLSearchParams(location.search);
      latest.delete('auto');
      history.replaceState(history.state, '', location.pathname + '?' + latest);
    };
    const post = (key: string, position?: Position) =>
      api<Collection>('/me/stamp-collections', {
        method: 'POST',
        key,
        body: {
          membershipId: card.id,
          branchId: branch,
          placementCode: code,
          ...(position ? { location: position } : {}),
        },
      });
    const send = async () => {
      if (!alive || done || inFlight || document.hidden) return;
      if (Date.now() - at >= 600000) {
        done = true;
        setNotice({
          tone: 'error',
          text: ar
            ? 'الطلب خلص، اعمل سكان تاني.'
            : 'The request expired. Scan the shop code again.',
        });
        return;
      }
      inFlight = true;
      try {
        const key = requestKey(card.id, code, at) + (attempt ? ':' + attempt : '');
        let result = await post(key);
        if (!alive) return;
        if (result.outcome === 'location_required') {
          // The phone's own permission prompt is the only thing the customer may see here;
          // the page never says that location is part of the check.
          setNotice({ tone: 'info', text: ar ? 'بنسجّل زيارتك…' : 'Recording your visit…' });
          const position = await locate();
          if (!alive) return;
          if (typeof position === 'string') {
            finish();
            setNotice({ tone: 'info', text: collectionReason({ outcome: 'not_eligible' }, lang) });
            return;
          }
          result = await post(key + ':l', position);
          if (!alive) return;
        }
        finish();
        if (result.outcome === 'awarded') {
          setNotice(null);
          // The card reloads with the confirmed balance; the stamp animation plays from that.
          await awarded.current();
        } else if (result.outcome === 'pending') {
          setNotice(null);
          await saved.current();
        } else
          setNotice({
            tone: 'info',
            text: collectionReason(result, lang),
          });
      } catch (error) {
        if (!alive) return;
        if (error instanceof ApiError && error.status === 0)
          setNotice({
            tone: 'error',
            text: ar
              ? 'مفيش نت، هنبعت الطلب أول ما يرجع.'
              : 'You’re offline. We’ll send the request when you reconnect.',
          });
        else {
          done = true;
          setNotice({ tone: 'error', text: errorText(error, lang).split(' · ')[0]! });
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
  }, [card.id, branch, validBranch, lang, attempt]);
  return {
    notice,
    // Runs the same sticker visit again, for example after allowing location.
    retry: () => {
      const query = new URLSearchParams(location.search);
      if (!query.get('code')) return;
      query.set('auto', '1');
      history.replaceState(history.state, '', location.pathname + '?' + query);
      setNotice(null);
      setAttempt((n) => n + 1);
    },
  };
}
