import { portalAssetUrl } from '../portals.js';
import { Select } from '../controls/Select.js';
import { useEffect, useState, useRef } from 'react';
import type { Grant, Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
interface Customer {
  id: string;
  alias: string;
  contact_email: string;
  created_at: string;
  last_purchase_at: string | null;
  visits: number;
  net_stamps: number;
  segment: string;
}
interface Export {
  id: string;
  status: string;
  row_count: number;
  expires_at: string;
  error_code: string | null;
}
export function Customers({ grant, lang }: { grant: Grant; lang: Language }) {
  const ar = lang === 'ar',
    base = '/merchants/' + grant.merchant_id,
    [saved, setSaved] = useState<
      { id: string; name: string; branch_id: string | null; segment: string; query?: string }[]
    >([]),
    [viewName, setViewName] = useState(''),
    [query, setQuery] = useState(''),
    [branch, setBranch] = useState(''),
    [segment, setSegment] = useState('all'),
    [offset, setOffset] = useState(0),
    [next, setNext] = useState<number | null>(null),
    [rows, setRows] = useState<Customer[]>([]),
    [exports, setExports] = useState<Export[]>([]),
    [detail, setDetail] = useState<{
      customer: Customer;
      memberships: { id: string; name: string; balance: number; threshold: number }[];
      activity: { public_reference: string; type: string; quantity: number; at: string }[];
    } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const serial = useRef(0);
  const load = async () => {
    const ticket = ++serial.current;
    try {
      const data = await api<{ customers: Customer[]; nextOffset: number | null }>(
        base +
          '/customers?segment=' +
          segment +
          '&offset=' +
          offset +
          (branch ? '&branchId=' + branch : '') +
          (query ? '&query=' + encodeURIComponent(query) : ''),
      );
      if (ticket !== serial.current) return;
      setRows(data.customers);
      setSaved((await api<{ segments: typeof saved }>(base + '/segments')).segments);
      setNext(data.nextOffset);
      if (grant.role === 'owner')
        setExports((await api<{ exports: Export[] }>(base + '/customer-exports')).exports);
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    const debounce = setTimeout(() => void load(), 250);
    const iv = setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    return () => {
      clearInterval(iv);
      clearTimeout(debounce);
      serial.current++;
    };
  }, [branch, segment, offset, query]);
  const open = async (id: string) => {
    try {
      setDetail(await api(base + '/customers/' + id + (branch ? '?branchId=' + branch : '')));
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  const requestExport = async () => {
    setBusy(true);
    try {
      await api(base + '/customer-exports', {
        method: 'POST',
        key: crypto.randomUUID(),
        body: { segment, ...(branch ? { branchId: branch } : {}), ...(query ? { query } : {}) },
      });
      await load();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section className="panel">
        <div className="section-heading">
          <h2>{ar ? 'العملاء والشرائح' : 'Customers and segments'}</h2>
          {grant.role === 'owner' && (
            <button className="secondary" disabled={busy} onClick={() => void requestExport()}>
              {ar ? 'تجهيز ملف CSV خاص' : 'Prepare private CSV'}
            </button>
          )}
        </div>
        {error && (
          <p role="alert" className="error-text">
            {error}
          </p>
        )}
        <label>
          {ar ? 'ابحث بالاسم أوالبريد' : 'Search name or email'}
          <input
            type="search"
            maxLength={80}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <div className="filter-row">
          <label>
            {ar ? 'الفرع' : 'Branch'}
            <Select
              value={branch}
              onChange={(e) => {
                setBranch(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">{ar ? 'الفروع المصرح بها' : 'Authorized branches'}</option>
              {grant.branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          </label>
          <label>
            {ar ? 'الشريحة' : 'Segment'}
            <Select
              value={segment}
              onChange={(e) => {
                setSegment(e.target.value);
                setOffset(0);
              }}
            >
              {[
                ['all', ar ? 'الكل' : 'All'],
                ['active', ar ? 'نشط آخر 30 يوم' : 'Active in 30 days'],
                ['inactive', ar ? 'آخر شراء أقدم من 30 يوم' : 'Inactive for over 30 days'],
                ['never_active', ar ? 'لم يشترِ بعد' : 'Never active'],
              ].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
          </label>
        </div>
        <p className="muted">
          {ar
            ? 'العميل بيتحسب مرة واحدة عبر البرامج. النشاط مبني على شراء مؤكد في الفروع المسموحة.'
            : 'Each customer is counted once across programs. Activity comes from confirmed purchases in authorized branches.'}
        </p>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            void api(base + '/segments', {
              method: 'POST',
              key: crypto.randomUUID(),
              body: {
                name: viewName,
                segment,
                ...(branch ? { branchId: branch } : {}),
                ...(query ? { query } : {}),
              },
            })
              .then(() => {
                setViewName('');
                return load();
              })
              .catch((e) => setError(errorText(e, lang)));
          }}
        >
          <label>
            {ar ? 'احفظ الفلتر باسم' : 'Save this filter as'}
            <input
              required
              minLength={2}
              maxLength={80}
              value={viewName}
              onChange={(e) => setViewName(e.target.value)}
            />
          </label>
          <button className="secondary">{ar ? 'حفظ الشريحة' : 'Save segment'}</button>
        </form>
        <div className="tabbar">
          {saved.map((v) => (
            <button
              key={v.id}
              onClick={() => {
                setBranch(v.branch_id || '');
                setSegment(v.segment);
                setQuery(v.query || '');
                setOffset(0);
              }}
            >
              {v.name}
            </button>
          ))}
        </div>
        <div className="table-wrap mobile-records">
          <table>
            <thead>
              <tr>
                {(ar
                  ? ['العميل', 'الزيارات', 'صافي الأختام', 'آخر شراء', 'الشريحة']
                  : ['Customer', 'Visits', 'Net stamps', 'Last purchase', 'Segment']
                ).map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label={ar ? 'العميل' : 'Customer'}>
                    <button className="text-button" onClick={() => void open(r.id)}>
                      {r.alias}
                    </button>
                    <small>
                      <bdi>{r.contact_email}</bdi>
                    </small>
                  </td>
                  <td data-label={ar ? 'الزيارات' : 'Visits'}>{r.visits}</td>
                  <td data-label={ar ? 'صافي الأختام' : 'Net stamps'}>{r.net_stamps}</td>
                  <td data-label={ar ? 'آخر شراء' : 'Last purchase'}>
                    {r.last_purchase_at
                      ? new Date(r.last_purchase_at).toLocaleDateString(lang)
                      : '—'}
                  </td>
                  <td data-label={ar ? 'الشريحة' : 'Segment'}>{r.segment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.length && (
          <p className="muted">{ar ? 'مفيش عملاء في النطاق ده.' : 'No customers in this scope.'}</p>
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
            onClick={() => next !== null && setOffset(next)}
          >
            {ar ? 'التالي' : 'Next'}
          </button>
        </div>
      </section>
      {exports.length > 0 && (
        <section className="panel">
          <h2>{ar ? 'ملفات التصدير' : 'Private exports'}</h2>
          <p className="muted">
            {ar
              ? 'الملف خاص بالمالك وصالح ساعة واحدة. الصلاحية بتتراجع عند التنزيل.'
              : 'Owner-only files expire in one hour. Authorization is checked again on download.'}
          </p>
          {exports.map((ex) => (
            <div className="list-row" key={ex.id}>
              <div>
                <strong>
                  {(
                    {
                      queued: ar ? 'بنجهّز الملف' : 'Preparing',
                      ready: ar ? 'جاهز' : 'Ready',
                      failed: ar ? 'تعذر تجهيز الملف' : 'Preparation failed',
                      revoked: ar ? 'رابط ملغي' : 'Revoked',
                      scope_changed: ar
                        ? 'صلاحيات الفروع اتغيرت؛ اطلب ملف جديد'
                        : 'Branch scope changed; request a new file',
                    } as Record<string, string>
                  )[ex.status] || ex.status}{' '}
                  {ex.row_count != null ? '· ' + ex.row_count : ''}
                </strong>
                <small>{new Date(ex.expires_at).toLocaleTimeString(lang)}</small>
              </div>
              {ex.status === 'ready' && new Date(ex.expires_at) > new Date() && (
                <a
                  className="secondary small"
                  href={portalAssetUrl(
                    '/api/v1' + base + '/customer-exports/' + ex.id + '/download',
                  )}
                >
                  {ar ? 'تنزيل' : 'Download'}
                </a>
              )}
              {ex.error_code && <span>{ex.error_code}</span>}
            </div>
          ))}
        </section>
      )}
      {detail && (
        <div className="modal-backdrop">
          <section
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="customer-title"
          >
            <div className="section-heading">
              <h2 id="customer-title">{detail.customer.alias}</h2>
              <button className="text-button" data-dialog-close onClick={() => setDetail(null)}>
                {ar ? 'إغلاق' : 'Close'}
              </button>
            </div>
            <bdi>{detail.customer.contact_email}</bdi>
            {detail.memberships.map((ms) => (
              <div className="list-row" key={ms.id}>
                <strong>{ms.name}</strong>
                <span>
                  {ms.balance}/{ms.threshold}
                </span>
              </div>
            ))}
            <h3>{ar ? 'العمليات المصرح بها' : 'Authorized activity'}</h3>
            {detail.activity.map((t) => (
              <div className="activity-row" key={t.public_reference}>
                <div>
                  <bdi>{t.public_reference}</bdi>
                  <small>{new Date(t.at).toLocaleString(lang)}</small>
                </div>
                <span>
                  {t.type} ·{t.quantity}
                </span>
              </div>
            ))}
          </section>
        </div>
      )}
    </>
  );
}
