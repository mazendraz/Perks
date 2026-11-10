import { Select } from '../controls/Select.js';
import { statusLabel } from '../business-labels.js';
import { useEffect, useState, type FormEvent } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
interface Ticket {
  id: string;
  subject: string;
  status: string;
  category: string;
  revision: number;
  merchant_name?: string;
}
export function Support({ lang, merchantId }: { lang: Language; merchantId?: string }) {
  const ar = lang === 'ar',
    [tickets, setTickets] = useState<Ticket[]>([]),
    [detail, setDetail] = useState<{
      ticket: Ticket;
      messages: { id: string; author_id: string; body: string; at: string }[];
    } | null>(null),
    [creating, setCreating] = useState(false),
    [subject, setSubject] = useState(''),
    [category, setCategory] = useState('other'),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const load = async () => {
    try {
      setTickets(
        (
          await api<{ tickets: Ticket[] }>(
            '/support/tickets' + (merchantId ? '?merchantId=' + merchantId : ''),
          )
        ).tickets,
      );
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  const open = async (id: string) => {
    try {
      setDetail(await api('/support/tickets/' + id));
      setMessage('');
      setCreating(false);
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
    const iv = setInterval(() => {
      if (!document.hidden) void load();
    }, 8000);
    return () => clearInterval(iv);
  }, [merchantId]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (creating) {
        const r = await api<{ ticket: Ticket }>('/support/tickets', {
          method: 'POST',
          key: crypto.randomUUID(),
          body: { merchantId, subject, category, message },
        });
        await open(r.ticket.id);
        setCreating(false);
      } else if (detail) {
        await api('/support/tickets/' + detail.ticket.id + '/messages', {
          method: 'POST',
          key: crypto.randomUUID(),
          body: { body: message },
        });
        await open(detail.ticket.id);
      }
      await load();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>{ar ? 'الدعم' : 'Support tickets'}</h2>
        {merchantId && (
          <button
            className="primary"
            onClick={() => {
              setCreating(true);
              setDetail(null);
              setMessage('');
              setSubject('');
            }}
          >
            {ar ? 'طلب دعم جديد' : 'New support ticket'}
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      {tickets.map((t) => (
        <div className="list-row" key={t.id}>
          <div>
            <button className="text-button" onClick={() => void open(t.id)}>
              {t.subject}
            </button>
            <small>
              {t.merchant_name} ·{t.category}
            </small>
          </div>
          <span className="badge">{statusLabel(t.status, lang)}</span>
        </div>
      ))}
      {!tickets.length && <p className="muted">{ar ? 'مفيش طلبات دعم.' : 'No support tickets.'}</p>}
      {(creating || detail) && (
        <section className="subpanel">
          {detail && (
            <>
              <div className="section-heading">
                <h3>{detail.ticket.subject}</h3>
                <Select
                  aria-label={ar ? 'حالة التذكرة' : 'Ticket status'}
                  value={detail.ticket.status}
                  onChange={(e) =>
                    void api('/support/tickets/' + detail.ticket.id, {
                      method: 'PATCH',
                      revision: detail.ticket.revision,
                      body: { status: e.target.value },
                    })
                      .then(() => open(detail.ticket.id))
                      .then(load)
                      .catch((e) => setError(errorText(e, lang)))
                  }
                >
                  {['open', 'waiting', 'resolved'].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </Select>
              </div>
              {detail.messages.map((m) => (
                <div className="support-message" key={m.id}>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{m.body}</p>
                  <small>{new Date(m.at).toLocaleString(lang)}</small>
                </div>
              ))}
            </>
          )}
          <form onSubmit={(e) => void submit(e)}>
            {creating && (
              <>
                <label>
                  {ar ? 'الموضوع' : 'Subject'}
                  <input
                    autoFocus
                    required
                    minLength={4}
                    maxLength={160}
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </label>
                <label>
                  {ar ? 'التصنيف' : 'Category'}
                  <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                    {['loyalty', 'access', 'materials', 'billing', 'other'].map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </Select>
                </label>
              </>
            )}
            <label>
              {ar ? 'الرسالة' : 'Message'}
              <textarea
                required
                minLength={creating ? 4 : 1}
                maxLength={4000}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
            </label>
            <button className="primary" disabled={busy}>
              {ar ? 'إرسال للدعم' : 'Save message'}
            </button>
          </form>
        </section>
      )}
    </section>
  );
}
