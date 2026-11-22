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
}: {
  merchantId: string;
  segment: SegmentKey;
  audience: WalletAudience;
  label: string;
  branchId: string;
  lang: Language;
  onClose: () => void;
}) {
  const template = segmentMessages[audience];
  const [body, setBody] = useState(template?.[lang] ?? '');
  const [business, setBusiness] = useState('');
  const [page, setPage] = useState<SegmentPage | null>(null);
  const [rows, setRows] = useState<SegmentCustomer[]>([]);
  const [opened, setOpened] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
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
    } catch (e) {
      tab?.close();
      setError(errorText(e, lang));
    } finally {
      setBusy('');
    }
  };

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
        {!page ? (
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
        {page?.nextCursor && (
          <button className="text-button" onClick={() => void load(page.nextCursor!)}>
            {pick(t.more, lang)}
          </button>
        )}
      </div>
    </div>
  );
}
