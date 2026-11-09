import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
interface Stats {
  cardOpen: { samples: number; p95Ms: number | null };
  requests: {
    total: number;
    approved: number;
    closedWithoutApprovalRate: number | null;
    approval_p95_ms: number | null;
  };
  dailyLimitAttempts: number;
}
export function ExperienceStats({
  merchantId,
  branch,
  days,
  lang,
}: {
  merchantId: string;
  branch: string;
  days: number;
  lang: Language;
}) {
  const [stats, setStats] = useState<Stats | null>(null),
    [error, setError] = useState(''),
    ar = lang === 'ar';
  useEffect(() => {
    let alive = true;
    void api<Stats>(
      '/merchants/' +
        merchantId +
        '/experience?days=' +
        days +
        (branch ? '&branchId=' + branch : ''),
    )
      .then((value) => {
        if (alive) {
          setStats(value);
          setError('');
        }
      })
      .catch((error) => {
        if (alive) setError(errorText(error, lang));
      });
    return () => {
      alive = false;
    };
  }, [merchantId, branch, days]);
  const seconds = (ms: number | null) =>
    ms === null
      ? '—'
      : (ms / 1000).toLocaleString(lang, { maximumFractionDigits: 1 }) + (ar ? ' ث' : ' s');
  return (
    <section className="panel experience-stats">
      <h2>{ar ? 'رحلة العميل' : 'Customer experience'}</h2>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {stats ? (
        <>
          <dl className="experience-metrics">
            <div>
              <dt>{ar ? 'من السكان للكارت · p95' : 'Scan to card · p95'}</dt>
              <dd>{seconds(stats.cardOpen.p95Ms)}</dd>
            </div>
            <div>
              <dt>{ar ? 'من الطلب للاعتماد · p95' : 'Request to approval · p95'}</dt>
              <dd>{seconds(stats.requests.approval_p95_ms)}</dd>
            </div>
            <div>
              <dt>{ar ? 'طلبات انتهت من غير موافقة' : 'Requests closed without approval'}</dt>
              <dd>
                {stats.requests.closedWithoutApprovalRate === null
                  ? '—'
                  : stats.requests.closedWithoutApprovalRate.toLocaleString(lang) + '%'}
              </dd>
            </div>
          </dl>
          <p className="muted">
            {ar
              ? 'وقت فتح الكارت من قياس جهاز العميل، ووقت الاعتماد من السيرفر. الطلبات اللي لسه مفتوحة مش داخلة في نسبة الانتهاء.'
              : 'Card opening is reported by the customer device; approval time comes from the server. Pending requests are excluded from the closed-request rate.'}
          </p>
          <small>
            {ar ? 'عينات فتح الكارت: ' : 'Card opening samples: '}
            {stats.cardOpen.samples} ·{' '}
            {ar ? 'محاولات فوق الحد اليومي: ' : 'Attempts over the daily limit: '}
            {stats.dailyLimitAttempts}
          </small>
        </>
      ) : (
        !error && <p role="status">{ar ? 'بنراجع الرحلة…' : 'Loading customer experience…'}</p>
      )}
    </section>
  );
}
