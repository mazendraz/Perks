import { useState } from 'react';
import type { Language } from '../../../packages/contracts/src/index.js';
import { api } from './api.js';
import { unlinkPushDevice } from './push.js';

// Signing out of a staff workspace ends only the staff session. A customer card this browser also
// holds stays on it: removing it was a separate "remove the card" choice that cost cashiers their
// own cards, so it is gone. Customers (device sign-in) still end their card session; the server
// ignores keepCustomerCard for them.
export function useSignOut(_lang: Language, after: () => void, onError: (e: unknown) => void) {
  const [busy, setBusy] = useState(false);
  const request = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Unlink this device's notifications while the session is still valid to say so.
      await unlinkPushDevice();
      await api('/auth/logout', { method: 'POST', body: { keepCustomerCard: true } });
      after();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  return { request, busy };
}
