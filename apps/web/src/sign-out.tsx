import { useState } from 'react';
import type { Language, Session } from '../../../packages/contracts/src/index.js';
import { api } from './api.js';
import { unlinkPushDevice } from './push.js';

// Signing out of a staff workspace used to remove the customer card this browser also holds,
// so a cashier who collects stamps elsewhere lost their own card at every end of shift. Now the
// person is asked: their own phone keeps the card, a shared shop phone clears it.
export function useSignOut(lang: Language, after: () => void, onError: (e: unknown) => void) {
  const [asking, setAsking] = useState(false),
    [busy, setBusy] = useState(false);
  const ar = lang === 'ar';
  const finish = async (keepCustomerCard: boolean) => {
    setBusy(true);
    try {
      // Unlink this device's notifications while the session is still valid to say so.
      await unlinkPushDevice();
      await api('/auth/logout', {
        method: 'POST',
        ...(keepCustomerCard ? { body: { keepCustomerCard: true } } : {}),
      });
      setAsking(false);
      after();
    } catch (e) {
      onError(e);
    } finally {
      setBusy(false);
    }
  };
  const request = async () => {
    let cardHere = false;
    try {
      cardHere = !!(await api<Session>('/session')).user.customerCardHere;
    } catch {
      /* Signed out already or offline: nothing to ask about. */
    }
    if (cardHere) setAsking(true);
    else await finish(false);
  };
  const dialog = asking ? (
    <div className="modal-backdrop">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="sign-out-title">
        <h2 id="sign-out-title">{ar ? 'فيه كارت زبون على الموبايل ده' : 'A customer card is on this phone'}</h2>
        <p>
          {ar
            ? 'لو الموبايل ده بتاعك، سيب كارتك عليه. لو موبايل المحل المشترك، امسحه عشان محدش يفتحه بعدك.'
            : 'If this is your own phone, keep your card on it. If it is the shop’s shared phone, remove it so no one else opens it.'}
        </p>
        <div className="form-actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => void finish(true)}
          >
            {ar ? 'موبايلي، سيب الكارت' : 'My phone, keep the card'}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void finish(false)}
          >
            {ar ? 'موبايل مشترك، امسحه' : 'Shared phone, remove it'}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => setAsking(false)}
          >
            {ar ? 'رجوع' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  ) : null;
  return { request, dialog };
}
