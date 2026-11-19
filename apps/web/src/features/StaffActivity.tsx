import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
import { intlLocale } from '../locale.js';
import { Select } from '../controls/Select.js';

type Row = {
  id: string;
  name: string;
  role: string;
  status: string;
  visits: number;
  stamps: number;
  rewards: number;
  last_at: string | null;
  peak_ten_minutes: number;
  approved: number;
  rejected: number;
};

/** Each cashier's work over a period, so the owner sees who did what and spots unusual bursts. */
export function StaffActivity({ merchantId, lang }: { merchantId: string; lang: Language }) {
  const ar = lang === 'ar',
    [days, setDays] = useState(7),
    [data, setData] = useState<{ staff: Row[]; burstThreshold: number } | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    setError('');
    void api<{ staff: Row[]; burstThreshold: number }>(
      '/merchants/' + merchantId + '/staff-activity?days=' + days,
    )
      .then((r) => live && setData(r))
      .catch((e) => live && setError(errorText(e, lang)));
    return () => {
      live = false;
    };
  }, [merchantId, days, lang]);
  const rows = (data?.staff || []).filter((r) => r.stamps || r.rewards || r.role !== 'owner');
  return (
    <section className="panel staff-activity">
      <div className="section-heading">
        <h2>{ar ? 'شغل الفريق' : 'Team activity'}</h2>
        <label className="inline-select">
          <span className="sr-only">{ar ? 'فترة شغل الفريق' : 'Team activity period'}</span>
          <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
            <option value="1">{ar ? 'آخر 24 ساعة' : 'Last 24 hours'}</option>
            <option value="7">{ar ? 'آخر 7 أيام' : 'Last 7 days'}</option>
            <option value="30">{ar ? 'آخر 30 يوم' : 'Last 30 days'}</option>
          </Select>
        </label>
      </div>
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {data && !rows.length && (
        <p className="muted">
          {ar ? 'لسه مفيش شغل في الفترة دي.' : 'No activity in this period yet.'}
        </p>
      )}
      {!!rows.length && (
        <div className="table-wrap mobile-records">
          <table>
            <thead>
              <tr>
                {(ar
                  ? ['الاسم', 'زيارات', 'أختام', 'مكافآت', 'رفض', 'آخر نشاط']
                  : ['Name', 'Visits', 'Stamps', 'Rewards', 'Rejected', 'Last activity']
                ).map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const burst = r.peak_ten_minutes > (data?.burstThreshold ?? 10);
                return (
                  <tr key={r.id} className={burst ? 'row-flag' : undefined}>
                    <td data-label={ar ? 'الاسم' : 'Name'}>
                      <bdi>{r.name}</bdi>
                      {r.status !== 'active' && (
                        <small className="muted"> · {ar ? 'موقوف' : 'Disabled'}</small>
                      )}
                      {burst && (
                        <small className="flag-note" role="note">
                          {ar
                            ? `${r.peak_ten_minutes} ختم في 10 دقايق، راجع العمليات دي.`
                            : `${r.peak_ten_minutes} stamps within 10 minutes. Worth a look.`}
                        </small>
                      )}
                    </td>
                    <td data-label={ar ? 'زيارات' : 'Visits'}>{r.visits}</td>
                    <td data-label={ar ? 'أختام' : 'Stamps'}>{r.stamps}</td>
                    <td data-label={ar ? 'مكافآت' : 'Rewards'}>{r.rewards}</td>
                    <td data-label={ar ? 'رفض' : 'Rejected'}>{r.rejected}</td>
                    <td data-label={ar ? 'آخر نشاط' : 'Last activity'}>
                      {r.last_at
                        ? new Date(r.last_at).toLocaleString(intlLocale(lang), {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          })
                        : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
