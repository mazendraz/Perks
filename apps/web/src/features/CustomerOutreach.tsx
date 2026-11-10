import { PhoneInput } from '../controls/PhoneInput.js';
import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
export function WhatsAppDraft({
  merchantId,
  lang,
  recipient,
  onClose,
}: {
  merchantId: string;
  lang: Language;
  recipient: {
    id?: string;
    name: string;
    business?: boolean;
    missing?: string[];
    rewards?: number;
  };
  onClose: () => void;
}) {
  const ar = lang === 'ar',
    [message, setMessage] = useState(
      recipient.business
        ? ar
          ? 'أهلًا ' +
            recipient.name +
            '، بنتابع تجهيز حسابكم على Perks.' +
            (recipient.missing?.length
              ? ' المتبقي: ' + recipient.missing.join('، ') + '.'
              : ' لو محتاجين مساعدة إحنا معاكم.')
          : 'Hi ' +
            recipient.name +
            ', checking in on your Perks setup.' +
            (recipient.missing?.length
              ? ' Still to complete: ' + recipient.missing.join(', ') + '.'
              : ' Let us know if you need a hand.')
        : recipient.rewards
          ? ar
            ? 'أهلًا ' +
              recipient.name +
              '، عندك مكافأة جاهزة على كارت الولاء. تنورنا في زيارتك الجاية.'
            : 'Hi ' +
              recipient.name +
              ', you have a reward ready on your loyalty card. We look forward to your next visit.'
          : ar
            ? 'أهلًا ' +
              recipient.name +
              '، بنطمن إن كارت الولاء شغال معاك. لو محتاج مساعدة ابعتلنا.'
            : 'Hi ' +
              recipient.name +
              ', checking that your loyalty card is working for you. Let us know if you need help.',
    ),
    [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="modal-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="whatsapp-draft-title"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          setUrl('');
          try {
            const r = await api<{ url: string }>(
              recipient.business
                ? '/platform/merchants/' + merchantId + '/whatsapp'
                : '/merchants/' + merchantId + '/customer-outreach/' + recipient.id + '/whatsapp',
              { method: 'POST', body: { message } },
            );
            setUrl(r.url);
          } catch (e) {
            setError(errorText(e, lang));
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="whatsapp-draft-title">{ar ? 'رسالة واتساب' : 'WhatsApp message'}</h2>
        <p>{recipient.name}</p>
        <label>
          {ar ? 'راجع الرسالة' : 'Review message'}
          <textarea
            required
            minLength={1}
            maxLength={2000}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              setUrl('');
            }}
            rows={6}
          />
        </label>
        <p className="muted">
          {ar
            ? 'هنفتح مسودة في واتساب. الإرسال بيتم بإيدك من هناك، والرسالة لسه ما اتبعتتش.'
            : 'This opens a WhatsApp draft. You send it there; this message has not been sent.'}
        </p>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="button" className="secondary" data-dialog-close onClick={onClose}>
            {ar ? 'إغلاق' : 'Close'}
          </button>
          {url ? (
            <a className="primary" href={url} target="_blank" rel="noopener noreferrer">
              {ar ? 'افتح المسودة في واتساب' : 'Open draft in WhatsApp'}
            </a>
          ) : (
            <button className="primary" disabled={busy}>
              {ar ? 'جهّز مسودة واتساب' : 'Prepare WhatsApp draft'}
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
interface Customer {
  id: string;
  alias: string;
  phonePresent: boolean;
  whatsappConsent: boolean;
  contactPhone: string;
  lastPurchase: string | null;
  availableRewards: number;
}
export function CustomerOutreach({ merchantId, lang }: { merchantId: string; lang: Language }) {
  const ar = lang === 'ar',
    [rows, setRows] = useState<Customer[]>([]),
    [query, setQuery] = useState(''),
    [offset, setOffset] = useState(0),
    [next, setNext] = useState<number | null>(null),
    [error, setError] = useState(''),
    [recipient, setRecipient] = useState<Customer | null>(null);
  const load = async () => {
    try {
      const r = await api<{ customers: Customer[]; nextOffset: number | null }>(
        '/merchants/' +
          merchantId +
          '/customer-outreach?offset=' +
          offset +
          '&query=' +
          encodeURIComponent(query),
      );
      setRows(r.customers);
      setNext(r.nextOffset);
      setError('');
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [merchantId, offset, query]);
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <h2>{ar ? 'العملاء والتواصل' : 'Customers and contact'}</h2>
          <p className="muted">
            {ar
              ? 'شوف مين لسه ما اشترى، ومين له مكافأة، ومين مجهّز رقم وموافقة واتساب.'
              : 'See who has not purchased, who has a reward, and who has a WhatsApp number and consent.'}
          </p>
        </div>
        <button className="secondary small" onClick={() => void load()}>
          {ar ? 'تحديث' : 'Refresh'}
        </button>
      </div>
      <label>
        {ar ? 'دور باسم العميل' : 'Search customer name'}
        <input
          type="search"
          value={query}
          maxLength={80}
          onChange={(e) => {
            setQuery(e.target.value);
            setOffset(0);
          }}
        />
      </label>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {(ar
                ? ['العميل', 'حالة الاستخدام', 'الرقم', 'واتساب', 'التواصل']
                : ['Customer', 'Activity', 'Phone', 'WhatsApp', 'Contact']
              ).map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>
                  <strong>{c.alias}</strong>
                </td>
                <td>
                  {c.lastPurchase
                    ? ar
                      ? 'اشترى قبل كده'
                      : 'Has purchased'
                    : ar
                      ? 'لسه من غير شراء'
                      : 'No purchase yet'}
                  {c.availableRewards > 0 && (
                    <small>
                      {ar ? 'مكافآت جاهزة: ' : 'Rewards ready: '}
                      {c.availableRewards}
                    </small>
                  )}
                </td>
                <td>
                  {c.phonePresent
                    ? ar
                      ? 'رقم موجود'
                      : 'Number provided'
                    : ar
                      ? 'الرقم مش مضاف'
                      : 'Number missing'}
                </td>
                <td>
                  <span className="badge">
                    {c.whatsappConsent
                      ? ar
                        ? 'موافق'
                        : 'Opted in'
                      : ar
                        ? 'بدون موافقة'
                        : 'Not opted in'}
                  </span>
                </td>
                <td>
                  <button
                    className="secondary small"
                    disabled={!c.phonePresent || !c.whatsappConsent}
                    onClick={() => setRecipient(c)}
                  >
                    {ar ? 'رسالة واتساب' : 'WhatsApp message'}
                  </button>
                  {(!c.phonePresent || !c.whatsappConsent) && (
                    <small className="muted">
                      {ar
                        ? 'العميل يقدر يكملها من تفضيلات كارته.'
                        : 'The customer can update this in card preferences.'}
                    </small>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && !error && (
        <p className="muted">
          {ar ? 'لسه مفيش عملاء في الاختيار ده.' : 'No customers in this selection yet.'}
        </p>
      )}
      <div className="form-actions">
        <button
          className="secondary small"
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          {ar ? 'السابق' : 'Previous'}
        </button>
        <button
          className="secondary small"
          disabled={next === null}
          onClick={() => setOffset(next!)}
        >
          {ar ? 'التالي' : 'Next'}
        </button>
      </div>
      {recipient && (
        <WhatsAppDraft
          merchantId={merchantId}
          lang={lang}
          recipient={{
            id: recipient.id,
            name: recipient.alias,
            rewards: recipient.availableRewards,
          }}
          onClose={() => setRecipient(null)}
        />
      )}
    </section>
  );
}
export function CustomerContact({
  merchantId,
  lang,
  onSaved,
}: {
  merchantId: string;
  lang: Language;
  onSaved: (whatsappConsentReset: boolean) => Promise<void>;
}) {
  const ar = lang === 'ar',
    [phone, setPhone] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    setLoading(true);
    void api<{ contactPhone: string }>('/me/merchants/' + merchantId + '/contact')
      .then((r) => {
        if (current) setPhone(r.contactPhone);
      })
      .catch((e) => {
        if (current) setError(errorText(e, lang));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [merchantId]);
  return (
    <form
      className="subpanel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError('');
        try {
          const r = await api<{ contactPhone: string; whatsappConsentReset: boolean }>(
            '/me/merchants/' + merchantId + '/contact',
            { method: 'PATCH', body: { contactPhone: phone } },
          );
          setPhone(r.contactPhone);
          setNotice(
            r.whatsappConsentReset
              ? ar
                ? 'الرقم اتحفظ. اختار موافقة واتساب من تحت لو حابب تتواصل على الرقم ده.'
                : 'Number saved. Opt into WhatsApp below if you want messages at this number.'
              : ar
                ? 'الرقم محفوظ.'
                : 'Number saved.',
          );
          await onSaved(r.whatsappConsentReset);
        } catch (e) {
          setError(errorText(e, lang));
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        {ar
          ? 'رقم واتساب للتواصل مع المحل (اختياري)'
          : 'WhatsApp number for this business (optional)'}
        <PhoneInput
          lang={lang}
          aria-label={
            ar
              ? 'رقم واتساب للتواصل مع المحل (اختياري)'
              : 'WhatsApp number for this business (optional)'
          }
          value={phone}
          disabled={busy || loading}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>
      <p className="muted">
        {ar
          ? 'لو غيّرت الرقم، موافقة واتساب بتتوقف لحد ما تختارها تاني للرقم الجديد.'
          : 'Changing the number clears WhatsApp consent until you choose it again for the new number.'}
      </p>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <button className="secondary small" disabled={busy || loading}>
        {ar ? 'حفظ الرقم' : 'Save number'}
      </button>
    </form>
  );
}
