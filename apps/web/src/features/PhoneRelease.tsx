import { useState, type FormEvent } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
import { PhoneInput } from '../controls/PhoneInput.js';

// Platform admin: someone registered with a number that is not theirs, and its owner cannot get
// a card anywhere. Once the owner has messaged support on WhatsApp FROM that number, free it here.
export function PhoneRelease({ lang }: { lang: Language }) {
  const ar = lang === 'ar',
    [phone, setPhone] = useState(''),
    [reason, setReason] = useState(''),
    [confirming, setConfirming] = useState(false),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState(''),
    [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError('');
    try {
      const r = await api<{ released: boolean; shops?: number }>(
        '/platform/customer-phones/release',
        { method: 'POST', body: { phone, reason } },
      );
      setResult(
        r.released
          ? ar
            ? `الرقم اتفك. صاحبه يقدر يسجّل دلوقتي. اتشال من ${r.shops ?? 0} محل كرقم تواصل.`
            : `Number released. Its owner can register now. Removed as contact at ${r.shops ?? 0} shops.`
          : ar
            ? 'مفيش حساب على الرقم ده. صاحبه يقدر يسجّل عادي.'
            : 'No account uses this number. Its owner can register as usual.',
      );
      setPhone('');
      setReason('');
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  };
  return (
    <section className="panel">
      <h2>{ar ? 'فك رقم محجوز' : 'Release a taken number'}</h2>
      <p className="muted">
        {ar
          ? 'لما حد يسجّل برقم مش بتاعه، صاحب الرقم مش بيقدر ياخد كارت في أي محل. فكّه بس بعد ما صاحبه يبعتلنا واتساب من نفس الرقم.'
          : 'When someone registers with a number that is not theirs, its owner cannot get a card anywhere. Release it only after the owner messages us on WhatsApp from that same number.'}
      </p>
      <form onSubmit={(e) => void submit(e)}>
        <label>
          {ar ? 'الرقم' : 'Number'}
          <PhoneInput
            lang={lang}
            aria-label={ar ? 'الرقم' : 'Number'}
            required
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              setConfirming(false);
            }}
          />
        </label>
        <label>
          {ar ? 'إزاي اتأكدت إنه صاحبه' : 'How the owner was confirmed'}
          <input
            required
            minLength={10}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              ar
                ? 'مثلًا: بعت واتساب للدعم من الرقم ده يوم ...'
                : 'e.g. messaged support on WhatsApp from this number on …'
            }
          />
        </label>
        {confirming && (
          <p className="notice" role="alert">
            {ar
              ? 'اللي سجّل بالرقم ده هيفضل بكروته على موبايله، بس الرقم مش هيبقى بتاعه. متأكد؟'
              : 'Whoever registered with it keeps their cards on their phone, but the number is no longer theirs. Sure?'}
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        {result && (
          <p className="notice success" role="status">
            {result}
          </p>
        )}
        <div className="form-actions">
          <button className={confirming ? 'danger' : 'secondary'} disabled={busy}>
            {confirming
              ? ar
                ? 'أيوه، فك الرقم'
                : 'Yes, release it'
              : ar
                ? 'فك الرقم'
                : 'Release number'}
          </button>
          {confirming && (
            <button type="button" className="text-button" onClick={() => setConfirming(false)}>
              {ar ? 'رجوع' : 'Cancel'}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
