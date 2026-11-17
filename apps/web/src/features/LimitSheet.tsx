import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, ApiError, errorText } from '../api.js';
import { featureText, planLimitText } from '../error-messages.js';
import { addonLabel } from './billing-labels.js';

const PHONE = '01006111380';

/**
 * "وصلت لحد باقتك": opens when an action hits the plan. The owner can ask for the add-on or
 * the upgrade right here; anyone else is told to ask the owner (and never sees prices).
 */
export function LimitSheet({
  merchantId,
  lang,
  owner,
  onRequested,
}: {
  merchantId: string;
  lang: Language;
  owner: boolean;
  onRequested?: () => void;
}) {
  const ar = lang === 'ar';
  const [hit, setHit] = useState<ApiError | null>(null),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    const show = (e: Event) => {
      setHit((e as CustomEvent<ApiError>).detail);
      setDone('');
      setError('');
    };
    window.addEventListener('perks:plan-limit', show);
    return () => window.removeEventListener('perks:plan-limit', show);
  }, []);
  if (!hit?.details) return null;
  const d = hit.details;
  const text = hit.code === 'FEATURE_NOT_IN_PLAN' ? featureText(d, lang) : planLimitText(d, lang);
  const request = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError('');
    try {
      await api('/merchants/' + merchantId + '/plan/requests', {
        method: 'POST',
        key: crypto.randomUUID(),
        body,
      });
      setDone(
        ar
          ? 'طلبك وصل لفريق Perks. هنكلمك نأكد معاك ونسجّل الدفع.'
          : 'Your request reached the Perks team. We will call to confirm.',
      );
      onRequested?.();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop sheet-backdrop" onClick={() => !busy && setHit(null)}>
      <section
        className="dialog limit-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="limit-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="sheet-handle" aria-hidden="true" />
        <h2 id="limit-sheet-title">
          {hit.code === 'FEATURE_NOT_IN_PLAN'
            ? ar
              ? 'مش ضمن باقتك'
              : 'Not in your plan'
            : ar
              ? 'وصلت لحد باقتك'
              : 'You reached your plan limit'}
        </h2>
        <p>{text}</p>
        {done ? (
          <p role="status" className="notice success">
            {done}
          </p>
        ) : owner ? (
          <div className="sheet-actions">
            {(d.options || []).map((o) =>
              o.type === 'addon' && o.key ? (
                <button
                  key={'a' + o.key}
                  className="primary"
                  disabled={busy}
                  onClick={() => request({ kind: 'addon', addonKey: o.key, quantity: 1 })}
                >
                  {o.key === 'extra_branch'
                    ? ar
                      ? 'ضيف فرع'
                      : 'Add a branch'
                    : o.key === 'extra_staff'
                      ? ar
                        ? 'ضيف موظف'
                        : 'Add a staff member'
                      : addonLabel(o.key, lang)}
                </button>
              ) : o.type === 'upgrade' && o.plan ? (
                <button
                  key={'u' + o.plan}
                  className={
                    (d.options || []).some((x) => x.type === 'addon') ? 'secondary' : 'primary'
                  }
                  disabled={busy}
                  onClick={() =>
                    request({ kind: 'change_plan', plan: o.plan, billingPeriod: 'monthly' })
                  }
                >
                  {ar ? 'طلّع الباقة' : 'Upgrade the plan'}
                </button>
              ) : (
                <a
                  key="contact"
                  className="secondary"
                  href={'https://wa.me/2' + PHONE}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {ar ? 'كلّمنا عن Enterprise' : 'Talk to us about Enterprise'}
                </a>
              ),
            )}
          </div>
        ) : (
          <p className="muted">
            {ar ? 'كلّم صاحب المحل يزوّد الباقة.' : 'Ask the shop owner to extend the plan.'}
          </p>
        )}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
        <button className="text-button" data-dialog-close onClick={() => setHit(null)}>
          {done ? (ar ? 'تمام' : 'OK') : ar ? 'مش دلوقتي' : 'Not now'}
        </button>
      </section>
    </div>
  );
}
