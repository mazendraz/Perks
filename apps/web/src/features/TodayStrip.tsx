import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api } from '../api.js';
import { intlLocale } from '../locale.js';

export type TodayData = {
  pendingRequests: number;
  rewardsReady: number;
  today: { visits: number; stamps: number; redeemed: number };
  mine: { visits: number; stamps: number; redeemed: number; firstAt: string | null };
};

/** Polls /today while the page is visible. Errors keep the last good value. */
export function useToday(merchantId: string, everyMs = 15000) {
  const [data, setData] = useState<TodayData | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      if (document.hidden) return;
      api<TodayData>('/merchants/' + merchantId + '/today')
        .then((r) => live && setData(r))
        .catch(() => undefined);
    };
    load();
    const iv = setInterval(load, everyMs);
    return () => {
      live = false;
      clearInterval(iv);
    };
  }, [merchantId, everyMs]);
  return data;
}

/** Owner/manager: what needs attention right now, and today's totals so far. */
export function OwnerToday({
  merchantId,
  lang,
  onOpenOperations,
}: {
  merchantId: string;
  lang: Language;
  onOpenOperations: () => void;
}) {
  const ar = lang === 'ar',
    d = useToday(merchantId);
  if (!d) return null;
  return (
    <section className="panel today-strip" aria-label={ar ? 'النهارده' : 'Today'}>
      <h2>{ar ? 'النهارده' : 'Today'}</h2>
      {d.pendingRequests > 0 && (
        <p className="notice warning today-alert" role="status">
          {ar
            ? d.pendingRequests === 1
              ? 'في طلب ختم مستني الكاشير يوافق عليه.'
              : `في ${d.pendingRequests} طلبات ختم مستنية الكاشير يوافق عليها.`
            : `${d.pendingRequests} stamp ${d.pendingRequests === 1 ? 'request is' : 'requests are'} waiting for a cashier.`}
        </p>
      )}
      <div className="today-grid">
        <div>
          <strong>{d.today.visits}</strong>
          <small>{ar ? 'زيارة' : 'Visits'}</small>
        </div>
        <div>
          <strong>{d.today.stamps}</strong>
          <small>{ar ? 'ختم' : 'Stamps'}</small>
        </div>
        <div>
          <strong>{d.today.redeemed}</strong>
          <small>{ar ? 'مكافأة اتسلمت' : 'Rewards redeemed'}</small>
        </div>
        <div>
          <strong>{d.rewardsReady}</strong>
          <small>{ar ? 'مكافأة جاهزة للاستلام' : 'Rewards ready'}</small>
        </div>
      </div>
      <button className="text-button" onClick={onOpenOperations}>
        {ar ? 'شوف عمليات النهارده' : "See today's transactions"}
      </button>
    </section>
  );
}

/** Cashier: their own shift so far. */
export function ShiftSummary({ merchantId, lang }: { merchantId: string; lang: Language }) {
  const ar = lang === 'ar',
    d = useToday(merchantId, 20000);
  if (!d) return null;
  const m = d.mine;
  return (
    <section className="shift-summary" aria-label={ar ? 'ورديتك النهارده' : 'Your shift today'}>
      <h3>{ar ? 'ورديتك النهارده' : 'Your shift today'}</h3>
      {m.visits || m.redeemed ? (
        <p>
          {ar
            ? `${m.visits} زيارة · ${m.stamps} ختم · ${m.redeemed} مكافأة`
            : `${m.visits} visits · ${m.stamps} stamps · ${m.redeemed} rewards`}
          {m.firstAt && (
            <small className="muted">
              {' · '}
              {ar ? 'من ' : 'since '}
              {new Date(m.firstAt).toLocaleTimeString(intlLocale(lang), {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </small>
          )}
        </p>
      ) : (
        <p className="muted">
          {ar ? 'لسه مفيش عمليات منك النهارده.' : 'No transactions from you yet today.'}
        </p>
      )}
    </section>
  );
}
