import { portalAssetUrl } from '../portals.js';
import { Select } from '../controls/Select.js';
import { useEffect, useState, type FormEvent } from 'react';
import type { Grant, Language } from '../../../../packages/contracts/src/index.js';
import { api, errorText } from '../api.js';
import { navigate } from '../useRoute.js';
interface Placement {
  id: string;
  label: string;
  kind: string;
  status: string;
  branch_name: string;
  branch_id: string;
  revision: number;
  url: string;
  qrUrl: string;
  nfcUrl: string;
}
export function PlacementPage({ code, lang }: { code: string; lang: Language }) {
  const ar = lang === 'ar',
    [data, setData] = useState<{
      slug: string;
      merchantName: string;
      branchName: string;
      branchId: string;
    } | null>(null),
    [error, setError] = useState('');
  useEffect(() => {
    void api<NonNullable<typeof data>>('/public/placements/' + encodeURIComponent(code))
      .then(setData)
      .catch((e) => setError(errorText(e, lang)));
  }, [code]);
  return (
    <main id="main" className="join-page">
      <section className="panel">
        {error ? (
          <div role="alert" className="notice error">
            {error}
          </div>
        ) : data ? (
          <>
            <h1>{data.merchantName}</h1>
            <p>{data.branchName}</p>
            <p className="muted">
              {ar
                ? 'الرابط ده بيفتح كارت الولاء. الأختام محتاجة شراء واعتماد من الكاشير.'
                : 'This link opens loyalty enrollment. Stamps require a purchase and cashier approval.'}
            </p>
            <button
              className="primary full"
              onClick={() =>
                navigate(
                  '/join/' +
                    data.slug +
                    '?b=' +
                    data.branchId +
                    '&src=' +
                    (new URLSearchParams(location.search).get('src') === 'nfc' ? 'nfc' : 'qr'),
                )
              }
            >
              {ar ? 'افتح كارت الولاء' : 'Open loyalty card'}
            </button>
          </>
        ) : (
          <p role="status">{ar ? 'بنفتح الفرع…' : 'Loading branch…'}</p>
        )}
      </section>
    </main>
  );
}
export function Materials({ grant, lang }: { grant: Grant; lang: Language }) {
  const ar = lang === 'ar',
    base = '/merchants/' + grant.merchant_id,
    [rows, setRows] = useState<Placement[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [create, setCreate] = useState(false),
    [branch, setBranch] = useState(grant.branches[0]?.id || ''),
    [label, setLabel] = useState(''),
    [kind, setKind] = useState('stand'),
    [action, setAction] = useState<{
      p: Placement;
      type: 'replace' | 'revoked' | 'installed' | 'verified';
    } | null>(null),
    [reason, setReason] = useState(''),
    [device, setDevice] = useState('');
  const load = async () => {
    try {
      setRows((await api<{ placements: Placement[] }>(base + '/placements')).placements);
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
  }, [grant.id]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (create) {
        await api(base + '/placements', {
          method: 'POST',
          key: crypto.randomUUID(),
          body: { branchId: branch, label, kind },
        });
        setCreate(false);
        setLabel('');
      } else if (action) {
        await api(
          base +
            '/placements/' +
            action.p.id +
            '/' +
            (action.type === 'replace' ? 'replace' : 'transition'),
          {
            method: 'POST',
            key: crypto.randomUUID(),
            revision: action.p.revision,
            body:
              action.type === 'replace'
                ? { reason }
                : {
                    status: action.type,
                    reason,
                    ...(action.type === 'verified' ? { deviceDescription: device } : {}),
                  },
          },
        );
        setAction(null);
      }
      await load();
    } catch (e) {
      setError(errorText(e, lang));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel">
      <div className="section-heading">
        <h2>{ar ? 'مواد QR وNFC' : 'QR and NFC materials'}</h2>
        {grant.role === 'owner' && (
          <button
            className="primary"
            onClick={() => {
              setCreate(true);
              setAction(null);
            }}
          >
            {ar ? 'طلب قطعة' : 'Request a piece'}
          </button>
        )}
      </div>
      <p className="muted">
        {ar
          ? 'كل قطعة لها رابط مستقل. NFC بيحتاج تاج وكاتب متوافقين. اكتب رابط NFC كـNDEF URI، وجربه على جهاز تاني. تنزيل QR مش إثبات طباعة أوتركيب.'
          : 'Each piece has an independent link. NFC requires a compatible tag and writer. Write the NFC URL as an NDEF URI and test on another device. Downloading a QR does not verify printing or installation.'}
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {rows.map((p) => (
        <div className="subpanel" key={p.id}>
          <div className="section-heading">
            <h3>{p.label}</h3>
            <span className="badge">{p.status}</span>
          </div>
          <p>
            {p.branch_name} ·{p.kind}
          </p>
          {p.status !== 'revoked' && (
            <>
              <img
                className="placement-qr"
                width="200"
                height="200"
                src={portalAssetUrl('/api/v1' + base + '/placements/' + p.id + '/qr?preview=1')}
                alt={(ar ? 'QR تسجيل ' : 'Enrollment QR for ') + p.branch_name}
              />
              <a
                className="secondary small"
                href={portalAssetUrl('/api/v1' + base + '/placements/' + p.id + '/qr?format=svg')}
                download
              >
                {ar ? 'تحميل SVG للطباعة' : 'Download SVG for print'}
              </a>
              <a className="url-box" dir="ltr" href={p.qrUrl}>
                {p.qrUrl}
              </a>
              <small>
                NFC ·<bdi>{p.nfcUrl}</bdi>
              </small>
              <div className="form-actions">
                <a
                  className="secondary small"
                  href={portalAssetUrl('/api/v1' + base + '/placements/' + p.id + '/qr')}
                >
                  {ar ? 'تنزيل QR للطباعة' : 'Download print QR'}
                </a>
                {grant.role === 'owner' &&
                  (
                    [
                      'replace',
                      'revoked',
                      ...(p.status === 'shipped'
                        ? ['installed']
                        : p.status === 'installed'
                          ? ['verified']
                          : []),
                    ] as const
                  ).map((type) => (
                    <button
                      className="text-button"
                      key={type}
                      onClick={() => {
                        setCreate(false);
                        setAction({ p, type: type as NonNullable<typeof action>['type'] });
                        setReason('');
                        setDevice('');
                      }}
                    >
                      {
                        (
                          {
                            replace: ar ? 'استبدال القطعة' : 'Replace piece',
                            revoked: ar ? 'إلغاء الرابط' : 'Revoke link',
                            installed: ar ? 'تسجيل التركيب' : 'Record installation',
                            verified: ar ? 'تسجيل تجربة فعلية' : 'Record physical test',
                          } as Record<string, string>
                        )[type]
                      }
                    </button>
                  ))}
              </div>
            </>
          )}
        </div>
      ))}
      {!rows.length && <p className="muted">{ar ? 'لسه مفيش قطع.' : 'No pieces requested yet.'}</p>}
      {(create || action) && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="material-title"
            onSubmit={(e) => void submit(e)}
          >
            <h2 id="material-title">
              {create ? (ar ? 'طلب قطعة' : 'Request a piece') : action?.p.label}
            </h2>
            {create ? (
              <>
                <label>
                  {ar ? 'وصف القطعة' : 'Piece label'}
                  <input
                    autoFocus
                    required
                    minLength={2}
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </label>
                <label>
                  {ar ? 'الفرع' : 'Branch'}
                  <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
                    {grant.branches.map((b) => (
                      <option value={b.id} key={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </label>
                <label>
                  {ar ? 'النوع' : 'Type'}
                  <Select value={kind} onChange={(e) => setKind(e.target.value)}>
                    <option value="stand">Stand</option>
                    <option value="sticker">Sticker</option>
                    <option value="nfc">NFC tag</option>
                  </Select>
                </label>
              </>
            ) : (
              <>
                <label>
                  {ar ? 'السبب أوتفاصيل التنفيذ' : 'Reason or execution notes'}
                  <textarea
                    autoFocus
                    required
                    minLength={4}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                {action?.type === 'verified' && (
                  <>
                    <p>
                      {ar
                        ? 'سجل تجربة نفذتها فعلًا بقطعة وجهاز حقيقيين. ده إقرار المشغّل، مش فحص آلي من الخادم.'
                        : 'Record a test you actually performed with a physical piece and device. This is an operator attestation, not an automated server hardware check.'}
                    </p>
                    <label>
                      {ar ? 'الجهاز والنظام ونتيجة التجربة' : 'Device, OS and observed result'}
                      <textarea
                        required
                        minLength={5}
                        value={device}
                        onChange={(e) => setDevice(e.target.value)}
                      />
                    </label>
                  </>
                )}
              </>
            )}
            <div className="form-actions">
              <button
                className="secondary"
                type="button"
                data-dialog-close
                onClick={() => {
                  setCreate(false);
                  setAction(null);
                }}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button className="primary" disabled={busy}>
                {ar ? 'حفظ' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
