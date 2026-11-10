import { useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, ApiError, errorText } from '../api.js';
export function DeleteCustomerAccount({ lang }: { lang: Language }) {
  const ar = lang === 'ar',
    [open, setOpen] = useState(false),
    [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [key] = useState(() => crypto.randomUUID());
  const complete = () => window.dispatchEvent(new Event('nuqta:customer-deleted'));
  const remove = async () => {
    setBusy(true);
    setError('');
    try {
      await api('/me/privacy/delete', { method: 'POST', key, body: { confirmed: true } });
      complete();
    } catch (error) {
      if (error instanceof ApiError && error.status === 0) {
        try {
          const state = await api<{ deleted: boolean }>('/customer/deletion-status');
          if (state.deleted) {
            complete();
            return;
          }
        } catch {
          /* A verified receipt is required before showing success. */
        }
        setError(
          ar
            ? 'مش قادرين نأكد نتيجة الحذف. حدّث الصفحة؛ لو كارتك لسه بيفتح، جرّب الحذف تاني.'
            : 'We could not confirm deletion. Refresh the page; if your card still opens, try deleting again.',
        );
      } else setError(errorText(error, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel privacy-delete">
      <h2>{ar ? 'حذف حساب العميل' : 'Delete customer account'}</h2>
      <p className="muted">
        {ar
          ? 'الحذف يخص كل كروتك عند كل المحلات. هنشيل اسمك ووسائل التواصل ونلغي الأجهزة. أرقام العمليات هتفضل من غير اسمك ورقمك.'
          : 'Deletion covers your cards at every shop. Your name and contact details are removed and devices revoked. Transaction records remain without your name or number.'}
      </p>
      {!open ? (
        <button className="text-button" onClick={() => setOpen(true)}>
          {ar ? 'راجع طلب الحذف' : 'Review deletion'}
        </button>
      ) : (
        <>
          <p>
            {ar
              ? 'هتفقد الوصول لكل الكروت والمكافآت، ومش هتقدر ترجعهم برابط استرجاع.'
              : 'You will lose access to all cards and rewards. A recovery link will not restore them.'}
          </p>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            {ar
              ? 'فاهم إن الحذف يخص كل كروتي ومكافآتي'
              : 'I understand this deletes access to all my cards and rewards'}
          </label>
          {error && (
            <p className="error-text" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setConfirmed(false);
                setError('');
              }}
            >
              {ar ? 'رجوع' : 'Go back'}
            </button>
            <button
              className="primary"
              disabled={busy || !confirmed}
              aria-busy={busy}
              onClick={() => void remove()}
            >
              {busy
                ? ar
                  ? 'بنحذف بياناتك…'
                  : 'Deleting…'
                : ar
                  ? 'احذف حساب العميل'
                  : 'Delete customer account'}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
export function CustomerDeletionComplete({ lang }: { lang: Language }) {
  const ar = lang === 'ar';
  return (
    <main id="main" className="legal-page">
      <span className="eyebrow">{ar ? 'Perks · خصوصيتك' : 'Perks · Your privacy'}</span>
      <h1>{ar ? 'تم حذف حساب العميل' : 'Customer account deleted'}</h1>
      <p role="status">
        {ar
          ? 'شيلنا اسمك ووسائل التواصل ولغينا الأجهزة والجلسات. سجل العمليات موجود من غير اسمك ورقمك.'
          : 'Your name and contact details were removed, and devices and sessions revoked. Transaction records remain without your name or number.'}
      </p>
      <p>
        {ar
          ? 'لو حبيت تبدأ تاني، اعمل سكان لكود المحل. التسجيل الجديد بيبدأ بكارت جديد.'
          : 'To start again, scan a shop’s code. A new registration starts a new card.'}
      </p>
    </main>
  );
}
