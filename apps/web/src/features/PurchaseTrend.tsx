import type { Language } from '../../../../packages/contracts/src/index.js';
export interface TrendData {
  trend: { day: string; visits: number; buyers: number }[];
  period: { from: string; to: string; timezone: string };
}
export function PurchaseTrend({ data, lang }: { data: TrendData; lang: Language }) {
  const ar = lang === 'ar',
    format = new Intl.DateTimeFormat('en-CA', {
      timeZone: data.period.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }),
    start = format.format(new Date(data.period.from)),
    end = format.format(new Date(data.period.to)),
    indexed = new Map(data.trend.map((d) => [d.day, d])),
    rows: TrendData['trend'] = [];
  for (
    let day = Date.parse(start + 'T00:00:00Z'), i = 0;
    day <= Date.parse(end + 'T00:00:00Z') && i < 92;
    day += 864e5, i++
  ) {
    const key = new Date(day).toISOString().slice(0, 10);
    rows.push(indexed.get(key) || { day: key, visits: 0, buyers: 0 });
  }
  const max = Math.max(1, ...rows.map((r) => r.visits));
  return (
    <section className="panel">
      <h2>{ar ? 'اتجاه الزيارات اليومية' : 'Daily purchase trend'}</h2>
      <p className="muted">
        {ar
          ? 'زيارات شراء مؤكدة حسب توقيت النشاط. أول وآخر يوم ممكن يكونوا جزء من يوم. نسبة الرجوع = عملاء اشتروا قبل بداية الفترة ورجعوا خلالها ÷ كل العملاء اللي اشتروا خلالها.'
          : 'Confirmed purchases in the business timezone. Boundary days may be partial. Returning rate = buyers who also purchased before this period, divided by all buyers in this period.'}
      </p>
      <figure>
        <div
          className="trend-chart"
          role="img"
          aria-label={
            ar
              ? 'رسم الزيارات المؤكدة؛ الأرقام متاحة في جدول البيانات.'
              : 'Confirmed visit chart; exact values are available in the data table.'
          }
        >
          {rows.map((r) => (
            <span
              key={r.day}
              className="trend-bar"
              style={{ height: (100 * r.visits) / max + '%' }}
              title={r.day + ': ' + r.visits}
              aria-hidden="true"
            />
          ))}
        </div>
        <figcaption className="trend-axis">
          <bdi>{start}</bdi>
          <span>{data.period.timezone}</span>
          <bdi>{end}</bdi>
        </figcaption>
      </figure>
      <details>
        <summary>{ar ? 'اعرض بيانات الرسم' : 'Show chart data'}</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{ar ? 'اليوم' : 'Day'}</th>
                <th>{ar ? 'الزيارات' : 'Visits'}</th>
                <th>{ar ? 'عملاء اشتروا' : 'Purchasing customers'}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.day}>
                  <td>
                    <bdi>{r.day}</bdi>
                  </td>
                  <td>{r.visits}</td>
                  <td>{r.buyers}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
