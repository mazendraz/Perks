import { useState } from 'react';
import type {
  AnalyticsResponse,
  HealthPart,
} from '../../../../../packages/contracts/src/analytics.js';
import type { Language } from '../../../../../packages/contracts/src/index.js';
import { intlLocale } from '../../locale.js';
import { copy, daysText, pick, say } from './copy.js';
import { num } from './parts.js';

/** The value of returning visits: counted visits, and money only if the owner wants it — on this device. */
export function ValueCard({
  data,
  lang,
  merchantId,
}: {
  data: AnalyticsResponse;
  lang: Language;
  merchantId: string;
}) {
  const storageKey = 'perks.avgTicket.' + merchantId;
  const [avg, setAvg] = useState(() => {
    try {
      return localStorage.getItem(storageKey) ?? '';
    } catch {
      return '';
    }
  });
  const remember = (value: string) => {
    setAvg(value);
    try {
      if (value) localStorage.setItem(storageKey, value);
      else localStorage.removeItem(storageKey);
    } catch {
      // Private mode or storage off: the number simply is not remembered.
    }
  };
  const amount = Number(avg) > 0 ? data.value.returningVisits * Number(avg) : null;
  return (
    <section className="an-card an-value" aria-labelledby="an-value-title">
      <h2 id="an-value-title" className="an-value-eyebrow">
        {pick(copy.valueEyebrow, lang)}
      </h2>
      <p className="an-value-big">
        <strong className="an-num">{num(data.value.returningVisits, lang)}</strong>
        <span>{pick(copy.valueUnit, lang)}</span>
      </p>
      <p>{say(copy.valueText, lang, { days: daysText(data.period.days, lang) })}</p>
      {data.value.visitsAfterMessages > 0 && (
        <p className="an-value-sub">
          {say(copy.valueMessages, lang, { n: num(data.value.visitsAfterMessages, lang) })}
        </p>
      )}
      <details className="an-calc" open={!!avg}>
        <summary>{pick(copy.calcTitle, lang)}</summary>
        <label>
          {pick(copy.calcLabel, lang)}
          <input
            type="number"
            inputMode="decimal"
            min={1}
            max={100000}
            value={avg}
            placeholder="150"
            onChange={(e) => remember(e.target.value)}
          />
        </label>
        {amount !== null && (
          <p className="an-calc-result">
            {say(copy.calcResult, lang, {
              amount: new Intl.NumberFormat(intlLocale(lang), {
                style: 'currency',
                currency: 'EGP',
                maximumFractionDigits: 0,
              }).format(amount),
            })}
          </p>
        )}
        <small>{pick(copy.calcPrivate, lang)}</small>
      </details>
    </section>
  );
}

export function HealthBody({
  score,
  weakest,
  parts,
  lang,
}: {
  score: number;
  weakest: HealthPart['key'];
  parts: HealthPart[];
  lang: Language;
}) {
  const verdict = copy.healthVerdict.find((v) => score >= v.min)!.t;
  return (
    <div className="an-health">
      <div className="an-health-score">
        <span className="an-ring" style={{ '--p': score } as React.CSSProperties}>
          <strong className="an-num">{score}</strong>
        </span>
        <div>
          <p className="an-note">
            <strong>{pick(verdict, lang)}</strong>{' '}
            {say(copy.healthWeakest, lang, { part: pick(copy.healthParts[weakest]!, lang) })}
          </p>
          <p className="an-caption">{pick(copy.healthTips[weakest]!, lang)}</p>
        </div>
      </div>
      <ul className="an-health-parts">
        {parts.map((p) => (
          <li key={p.key} className={p.key === weakest ? 'weak' : ''}>
            <div className="an-funnel-row">
              <span>{pick(copy.healthParts[p.key]!, lang)}</span>
              <span className="an-muted">
                <bdi dir="ltr">{p.value}%</bdi> · {pick(copy.healthTarget, lang)}{' '}
                <bdi dir="ltr">{p.target}%</bdi>
              </span>
            </div>
            <div className="an-track" aria-hidden="true">
              <span style={{ width: Math.min(100, (100 * p.value) / p.target) + '%' }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Cohorts({
  rows,
  lang,
}: {
  rows: { month: string; first: number; back30: number }[];
  lang: Language;
}) {
  const month = (m: string) =>
    new Intl.DateTimeFormat(intlLocale(lang), {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(m + '-01T00:00:00Z'));
  const current = new Date().toISOString().slice(0, 7);
  return (
    <>
      <ul className="an-cohorts">
        {rows.map((r) => {
          const rate = r.first ? Math.round((100 * r.back30) / r.first) : 0;
          return (
            <li key={r.month}>
              <span className="an-cohort-month">{month(r.month)}</span>
              <div className="an-track" aria-hidden="true">
                <span style={{ width: rate + '%' }} />
              </div>
              <span className="an-cohort-rate">
                <strong>
                  <bdi dir="ltr">{rate}%</bdi>
                </strong>{' '}
                <small className="an-muted">
                  {say(copy.cohortsRow, lang, {
                    back: num(r.back30, lang),
                    first: num(r.first, lang),
                  })}
                </small>
              </span>
            </li>
          );
        })}
      </ul>
      {rows.at(-1)?.month === current && (
        <p className="an-caption">{pick(copy.cohortsPartial, lang)}</p>
      )}
    </>
  );
}

/** A spreadsheet of the page's numbers (no names, no contacts), made in the browser. */
export function downloadCsv(data: AnalyticsResponse, lang: Language) {
  const ar = lang === 'ar';
  const rows: (string | number)[][] = [
    [ar ? 'الفترة' : 'Period', data.period.from + ' → ' + data.period.to],
    [],
    [ar ? 'الرقم' : 'Metric', ar ? 'القيمة' : 'Value', ar ? 'الفترة اللي قبلها' : 'Previous'],
    [pick(copy.kpis.active, lang), data.kpis.active, data.kpis.previous.active],
    [pick(copy.kpis.visits, lang), data.kpis.visits, data.kpis.previous.visits],
    [pick(copy.kpis.newCustomers, lang), data.kpis.newCustomers, data.kpis.previous.newCustomers],
    [
      pick(copy.kpis.returnRate, lang),
      data.kpis.returnRate ?? '',
      data.kpis.previous.returnRate ?? '',
    ],
    [pick(copy.kpis.customers, lang), data.kpis.customers, ''],
    [],
    [ar ? 'الشريحة' : 'Group', ar ? 'العدد' : 'Customers'],
    ...Object.entries(data.segments).map(([k, n]) => [
      pick(copy.segments[k as keyof typeof copy.segments], lang),
      n,
    ]),
    [],
    [ar ? 'اليوم' : 'Day', ar ? 'زيارات' : 'Visits'],
    ...data.trend.map((d) => [d.day, d.visits]),
  ];
  if (data.branches.length) {
    rows.push(
      [],
      [
        pick(copy.branchCols.name, lang),
        pick(copy.branchCols.visits, lang),
        pick(copy.branchCols.newCustomers, lang),
        pick(copy.branchCols.returnRate, lang),
      ],
    );
    for (const b of data.branches)
      rows.push([b.name, b.visits, b.newCustomers, b.returnRate ?? '']);
  }
  const cell = (v: string | number) => {
    const s = String(v);
    // Never let a cell start a spreadsheet formula.
    const safe = /^[=+\-@]/.test(s) && typeof v === 'string' ? "'" + s : s;
    return /[",\n]/.test(safe) ? '"' + safe.replaceAll('"', '""') + '"' : safe;
  };
  const csv = '﻿' + rows.map((r) => r.map(cell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'perks-analytics-' + data.period.to + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
