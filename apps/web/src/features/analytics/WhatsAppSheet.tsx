import { useEffect, useRef, useState } from 'react';
import {
  fillWalletMessage,
  type WalletAudience,
} from '../../../../../packages/contracts/src/owner-plan.js';
import { segmentMessages } from '../../../../../packages/contracts/src/analytics-messages.js';
import type {
  SegmentCustomer,
  SegmentKey,
  SegmentPage,
} from '../../../../../packages/contracts/src/analytics.js';
import type { Language } from '../../../../../packages/contracts/src/index.js';
import { api, errorText } from '../../api.js';
import { Icon } from '../../../../../packages/ui/src/Icon.js';
import { pick, say } from './copy.js';
import { num } from './parts.js';
import './analytics.css';

const t = {
  title: { ar: 'ابعتلهم على واتساب', en: 'Message them on WhatsApp' },
  who: {
    ar: '{n} زبون موافقين يوصلهم كلام منك على واتساب',
    en: '{n} customers agreed to hear from you on WhatsApp',
  },
  how: {
    ar: 'دوس «واتساب» جنب كل اسم: هيفتحلك المحادثة والرسالة مكتوبة، وإنت اللي بتبعتها.',
    en: 'Tap WhatsApp next to each name: the chat opens with the message written, and you send it.',
  },
  message: { ar: 'الرسالة', en: 'Message' },
  hint: {
    ar: '{name} = اسم الزبون · {business} = اسم المحل',
    en: '{name} = customer name · {business} = your shop',
  },
  open: { ar: 'واتساب', en: 'WhatsApp' },
  opened: { ar: 'اتفتح', en: 'Opened' },
  more: { ar: 'اعرض أكتر', en: 'Show more' },
  loading: { ar: 'بنجيب الأسماء…', en: 'Loading names…' },
  close: { ar: 'إغلاق', en: 'Close' },
  all: { ar: 'ابعت للكل ({n})', en: 'Send to all ({n})' },
  next: { ar: 'افتح واتساب لـ{name}', en: 'Open WhatsApp for {name}' },
  progress: { ar: '{i} من {n}', en: '{i} of {n}' },
  queueHow: {
    ar: 'الرسالة هتكون مكتوبة باسمه. دوس «إرسال» في واتساب، وارجع هنا للي بعده.',
    en: 'The message is written with their name. Tap Send in WhatsApp, then come back for the next one.',
  },
  skip: { ar: 'فوّت', en: 'Skip' },
  stop: { ar: 'وقّف', en: 'Stop' },
  done: { ar: 'خلصت! فتحت المحادثة لكل الزباين.', en: 'Done! You opened a chat for everyone.' },
};

/**
 * WhatsApp when a Wallet message cannot reach a group (already messaged today, no Wallet card,
 * or no messages left). Only customers with a number and WhatsApp consent are listed; the server
 * checks consent again and logs each draft. Perks never sends: the owner's WhatsApp opens with
 * the text ready.
 */
export function WhatsAppSheet({
  merchantId,
  segment,
  audience,
  label,
  branchId,
  lang,
  onClose,
  initialBody,
}: {
  /** The owner's own words (e.g. typed for a Wallet message); else the ready text. */
  initialBody?: string;
  merchantId: string;
  segment: SegmentKey;
  audience: WalletAudience;
  label: string;
  branchId: string;
  lang: Language;
  onClose: () => void;
}) {
  const template = segmentMessages[audience];
  const [body, setBody] = useState(initialBody?.trim() || template?.[lang] || '');
  const [business, setBusiness] = useState('');
  const [page, setPage] = useState<SegmentPage | null>(null);
  const [rows, setRows] = useState<SegmentCustomer[]>([]);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // "Send to all": one customer after another, one tap each (WhatsApp needs the owner to send).
  const [queue, setQueue] = useState<SegmentCustomer[] | null>(null);
  const [step, setStep] = useState(0);
  const [loadingAll, setLoadingAll] = useState(false);
  const live = useRef(true);
  useEffect(
    () => () => {
      live.current = false;
    },
    [],
  );

  const load = async (cursor?: string) => {
    try {
      const params = new URLSearchParams({ whatsapp: '1' });
      if (cursor) params.set('cursor', cursor);
      if (branchId) params.set('branchId', branchId);
      const next = await api<SegmentPage>(
        '/merchants/' + merchantId + '/analytics/segments/' + segment + '?' + params,
      );
      if (!live.current) return;
      setPage(next);
      setRows((r) => (cursor ? [...r, ...next.customers] : next.customers));
    } catch (e) {
      if (live.current) setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
    api<{ merchantName: string }>('/merchants/' + merchantId + '/wallet-messages')
      .then((s) => live.current && setBusiness(s.merchantName))
      .catch(() => {});
  }, [merchantId, segment, branchId]);

  const openChat = async (c: SegmentCustomer) => {
    // Open the tab inside the tap, or the browser blocks it once we wait for the server.
    const tab = window.open('', '_blank');
    setBusy(c.profileId);
    setError('');
    try {
      const r = await api<{ url: string }>(
        '/merchants/' + merchantId + '/customer-outreach/' + c.profileId + '/whatsapp',
        {
          method: 'POST',
          body: { message: fillWalletMessage(body.trim(), c.alias, business) },
        },
      );
      if (tab) tab.location.href = r.url;
      else location.href = r.url;
      setOpened((s) => new Set(s).add(c.profileId));
      if (queue?.[step]?.profileId === c.profileId) setStep((i) => i + 1);
    } catch (e) {
      tab?.close();
      setError(errorText(e, lang));
    } finally {
      setBusy('');
    }
  };

  const startAll = async () => {
    if (!page) return;
    setLoadingAll(true);
    setError('');
    try {
      // Everyone, not only the first page on screen.
      let all = rows,
        cursor = page.nextCursor;
      while (cursor && all.length < 1000) {
        const params = new URLSearchParams({ whatsapp: '1', cursor });
        if (branchId) params.set('branchId', branchId);
        const next = await api<SegmentPage>(
          '/merchants/' + merchantId + '/analytics/segments/' + segment + '?' + params,
        );
        all = [...all, ...next.customers];
        cursor = next.nextCursor;
      }
      if (!live.current) return;
      setRows(all);
      setPage((p) => (p ? { ...p, nextCursor: cursor } : p));
      setQueue(all.filter((c) => !opened.has(c.profileId)));
      setStep(0);
    } catch (e) {
      if (live.current) setError(errorText(e, lang));
    } finally {
      if (live.current) setLoadingAll(false);
    }
  };
  const current = queue?.[step];

  return (
    <div className="modal-backdrop sheet-backdrop" onClick={onClose}>
      <div
        className="dialog an-sheet an-send an-whatsapp"
        role="dialog"
        aria-modal="true"
        aria-labelledby="an-wa-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="an-sheet-head">
          <div>
            <h2 id="an-wa-title">{pick(t.title, lang)}</h2>
            <p className="an-caption">
              <strong>{label}</strong>
              {page && (
                <>
                  {' · '}
                  {say(t.who, lang, { n: num(page.whatsappReady, lang) })}
                </>
              )}
            </p>
          </div>
          <button
            className="an-icon-button"
            data-dialog-close
            aria-label={pick(t.close, lang)}
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <p className="an-muted an-wa-how">{pick(t.how, lang)}</p>
        <label className="an-message">
          <span>{pick(t.message, lang)}</span>
          <textarea
            value={body}
            maxLength={1000}
            rows={3}
            dir="auto"
            onChange={(e) => setBody(e.target.value)}
          />
          <small className="an-muted">{pick(t.hint, lang)}</small>
        </label>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        {queue ? (
          <div className="an-wa-queue" aria-live="polite">
            {current ? (
              <>
                <span className="an-wa-progress">
                  {say(t.progress, lang, {
                    i: num(step + 1, lang),
                    n: num(queue.length, lang),
                  })}
                </span>
                <p className="an-muted">{pick(t.queueHow, lang)}</p>
                <button
                  type="button"
                  className="an-wa-button an-wa-next"
                  disabled={!body.trim() || busy === current.profileId}
                  onClick={() => void openChat(current)}
                >
                  <Icon name="message" size={18} />
                  {say(t.next, lang, { name: current.alias })}
                </button>
                <div className="an-wa-queue-actions">
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => setStep((i) => i + 1)}
                  >
                    {pick(t.skip, lang)}
                  </button>
                  <button type="button" className="text-button" onClick={() => setQueue(null)}>
                    {pick(t.stop, lang)}
                  </button>
                </div>
              </>
            ) : (
              <>
                <p>
                  <strong>{pick(t.done, lang)}</strong>
                </p>
                <button type="button" className="secondary" onClick={onClose}>
                  {pick(t.close, lang)}
                </button>
              </>
            )}
          </div>
        ) : !page ? (
          <p className="an-muted">{pick(t.loading, lang)}</p>
        ) : (
          <ul className="an-wa-list">
            {rows.map((c) => (
              <li key={c.profileId}>
                <span>{c.alias}</span>
                <button
                  type="button"
                  className={opened.has(c.profileId) ? 'secondary small' : 'an-wa-button'}
                  disabled={!body.trim() || busy === c.profileId}
                  onClick={() => void openChat(c)}
                >
                  <Icon name={opened.has(c.profileId) ? 'check' : 'message'} size={16} />
                  {pick(opened.has(c.profileId) ? t.opened : t.open, lang)}
                </button>
              </li>
            ))}
          </ul>
        )}
        {page && !queue && page.whatsappReady > 1 && (
          <button
            type="button"
            className="an-wa-button an-wa-all"
            disabled={!body.trim() || loadingAll}
            onClick={() => void startAll()}
          >
            <Icon name="message" size={18} />
            {say(t.all, lang, { n: num(page.whatsappReady, lang) })}
          </button>
        )}
        {!queue && page?.nextCursor && (
          <button className="text-button" onClick={() => void load(page.nextCursor!)}>
            {pick(t.more, lang)}
          </button>
        )}
      </div>
    </div>
  );
}
