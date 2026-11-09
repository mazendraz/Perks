import { useEffect } from 'react';
import { api } from './api.js';
export function useCardExperience(membershipId: string | undefined) {
  useEffect(() => {
    const query = new URLSearchParams(location.search),
      code = query.get('code'),
      branch = query.get('b'),
      at = Number(query.get('at'));
    if (!membershipId || !code || !branch || !Number.isFinite(at) || at <= 0) return;
    const body = {
      membershipId,
      branchId: branch,
      placementCode: code,
      elapsedMs: Math.round(Math.max(0, Math.min(600000, Date.now() - at))),
    };
    let done = false,
      running = false;
    const send = () => {
      if (done || running || document.hidden) return;
      running = true;
      void api('/me/experience', {
        method: 'POST',
        key: 'experience:' + membershipId + ':' + at,
        body,
      })
        .then(() => {
          done = true;
        })
        .catch(() => {})
        .finally(() => {
          running = false;
        });
    };
    send();
    window.addEventListener('online', send);
    return () => {
      window.removeEventListener('online', send);
    };
  }, [membershipId]);
}
