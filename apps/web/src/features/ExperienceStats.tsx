import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
import { intlLocale } from '../locale.js';
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
      : (ms / 1000).toLocaleString(intlLocale(lang), { maximumFractionDigits: 1 }) +
        (ar ? ' ث' : ' s');
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
          {(stats.requests.closedWithoutApprovalRate ?? 0) >= 30 && (
            <p className="notice warning" role="status">
              {ar
                ? `${stats.requests.closedWithoutApprovalRate}% من طلبات الأختام خلصت من غير ما الكاشير يوافق. اتأكد إن موبايل الكاشير مفتوح على صفحة الكاشير والصوت شغال.`
                : `${stats.requests.closedWithoutApprovalRate}% of stamp requests ended without the cashier approving. Make sure the cashier keeps the cashier page open with sound on.`}
            </p>
          )}
          <dl className="experience-metrics">
            <div>
              <dt>{ar ? 'وقت فتح الكارت بعد المسح' : 'Time to open the card after a scan'}</dt>
              <dd>{seconds(stats.cardOpen.p95Ms)}</dd>
            </div>
            <div>
              <dt>{ar ? 'وقت موافقة الكاشير' : 'Time for the cashier to approve'}</dt>
              <dd>{seconds(stats.requests.approval_p95_ms)}</dd>
            </div>
            <div>
              <dt>{ar ? 'طلبات انتهت من غير موافقة' : 'Requests closed without approval'}</dt>
              <dd>
                {stats.requests.closedWithoutApprovalRate === null
                  ? '—'
                  : stats.requests.closedWithoutApprovalRate.toLocaleString(intlLocale(lang)) + '%'}
              </dd>
            </div>
          </dl>
          <p className="muted">
            {ar
              ? 'الأوقات دي لـ 95% من الحالات (أغلب العملاء خدوا وقت أقل). الطلبات اللي لسه مفتوحة مش داخلة في النسبة.'
              : 'Times cover 95% of cases (most customers took less). Requests still open are not counted in the rate.'}
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
