import { portalAssetUrl } from '../portals.js';
import { ActionLabel } from '../../../../packages/ui/src/Icon.js';
import {
  enrollmentPlacementLabel,
  placementDisplayLabel,
} from '../../../../packages/domain/src/placement-labels.js';
import { Select } from '../controls/Select.js';
import { useEffect, useState } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
export function EnrollmentCodes({ merchantId, lang }: { merchantId: string; lang: Language }) {
  const [branches, setBranches] = useState<{ id: string; name: string; status: string }[]>([]),
    [branch, setBranch] = useState(''),
    [creating, setCreating] = useState(false),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState<{
      key: string;
      body: { branchId: string; label: string; kind: string };
    } | null>(null);
  const ar = lang === 'ar',
    [rows, setRows] = useState<
      { id: string; label: string; branch_name: string; qrUrl: string; status: string }[]
    >([]),
    [error, setError] = useState(''),
    [copied, setCopied] = useState('');
  const load = async () =>
    setRows(
      (await api<{ placements: typeof rows }>('/merchants/' + merchantId + '/placements'))
        .placements,
    );
  useEffect(() => {
    void api<{ branches: typeof branches }>('/merchants/' + merchantId)
      .then((r) => {
        setBranches(r.branches);
        setBranch(r.branches.find((b) => b.status === 'active')?.id || '');
      })
      .catch((e) => setError(errorText(e, lang)));
  }, [merchantId]);
  useEffect(() => {
    void api<{ placements: typeof rows }>('/merchants/' + merchantId + '/placements')
      .then((r) => setRows(r.placements))
      .catch((e) => setError(errorText(e, lang)));
  }, [merchantId]);
  return (
    <section className="panel enrollment-codes">
      <h2>{ar ? 'أكواد تسجيل العملاء' : 'Customer enrollment codes'}</h2>
      <p className="muted">
        {ar
          ? 'كل فرع له QR جاهز للمسح والتحميل. بيفتح التسجيل فقط؛ الأختام من الكاشير بعد الشراء.'
          : 'Each branch has a QR ready to scan or download. It opens enrollment; the cashier awards stamps after a purchase.'}
      </p>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
      <button
        className="secondary"
        onClick={() => {
          setCreating(true);
          setAttempt(null);
        }}
      >
        <ActionLabel icon="qr">{ar ? 'توليد QR لفرع' : 'Generate branch QR'}</ActionLabel>
      </button>
      {creating && (
        <form
          className="subpanel"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            const command = attempt || {
              key: crypto.randomUUID(),
              body: {
                branchId: branch,
                label: enrollmentPlacementLabel(
                  branches.find((b) => b.id === branch)?.name || '',
                  lang,
                ),
                kind: 'stand',
              },
            };
            setAttempt(command);
            void api('/merchants/' + merchantId + '/placements', { method: 'POST', ...command })
              .then(async () => {
                setCreating(false);
                setAttempt(null);
                await load();
              })
              .catch((e) => setError(errorText(e, lang)))
              .finally(() => setBusy(false));
          }}
        >
          <label>
            {ar ? 'الفرع' : 'Branch'}
            <Select value={branch} disabled={!!attempt} onChange={(e) => setBranch(e.target.value)}>
              {branches
                .filter((b) => b.status === 'active')
                .map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
            </Select>
          </label>
          <div className="form-actions">
            <button className="primary" disabled={busy || !branch}>
              <ActionLabel icon="qr">{ar ? 'توليد الكود' : 'Generate code'}</ActionLabel>
            </button>
            <button type="button" className="secondary" onClick={() => setCreating(false)}>
              {ar ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </form>
      )}
      <div className="qr-gallery">
        {rows
          .filter((p) => p.status !== 'revoked')
          .map((p) => {
            const base = '/api/v1/merchants/' + merchantId + '/placements/' + p.id + '/qr';
            return (
              <article className="qr-sheet" key={p.id}>
                <h3>{p.branch_name}</h3>
                <small>{placementDisplayLabel(p.label, p.branch_name, lang)}</small>
                <img
                  width="220"
                  height="220"
                  src={portalAssetUrl(base + '?preview=1')}
                  alt={(ar ? 'QR تسجيل ' : 'Enrollment QR for ') + p.branch_name}
                />
                <div className="form-actions">
                  <a className="secondary small" href={portalAssetUrl(base)} download>
                    <ActionLabel icon="download">PNG</ActionLabel>
                  </a>
                  <a
                    className="secondary small"
                    href={portalAssetUrl(base + '?format=svg')}
                    download
                  >
                    <ActionLabel icon="download">SVG</ActionLabel>
                  </a>
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      if (!navigator.clipboard?.writeText) {
                        setError(ar ? 'انسخ الرابط من تحت.' : 'Select the link below to copy it.');
                        return;
                      }
                      void navigator.clipboard
                        .writeText(p.qrUrl)
                        .then(() => setCopied(p.id))
                        .catch(() =>
                          setError(
                            ar
                              ? 'تعذّر النسخ. انسخ الرابط من تحت.'
                              : 'Copy failed. Select the link below.',
                          ),
                        );
                    }}
                  >
                    <ActionLabel icon={copied === p.id ? 'check' : 'copy'}>
                      {copied === p.id
                        ? ar
                          ? 'اتنسخ'
                          : 'Copied'
                        : ar
                          ? 'نسخ الرابط'
                          : 'Copy link'}
                    </ActionLabel>
                  </button>
                </div>
                <a className="url-box" dir="ltr" href={p.qrUrl}>
                  {p.qrUrl}
                </a>
              </article>
            );
          })}
      </div>
      {!rows.length && !error && (
        <p>
          {ar
            ? 'لسه مفيش أكواد للفرع. اختار الفرع وولّد الكود من هنا.'
            : 'No branch codes yet. Select a branch and generate its code here.'}
        </p>
      )}
    </section>
  );
}
