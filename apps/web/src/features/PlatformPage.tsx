import { PhoneInput } from '../controls/PhoneInput.js';
import { portalAssetUrl } from '../portals.js';
import { FileUpload } from '../controls/FileUpload.js';
import { Select } from '../controls/Select.js';
import { BusinessPreview } from './BusinessPreview.js';
import { navigate } from '../useRoute.js';
import { suggestedStamps } from '../../../../packages/contracts/src/branding.js';
import {
  ColorField,
  PalettePaste,
  TemplatePicker,
  StampControls,
  LogoStyleControl,
} from './BrandControls.js';
import { MerchantWorkspace } from './MerchantWorkspace.js';
import { EnrollmentCodes } from './EnrollmentCodes.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';
import { FieldErrors, fieldProps } from '../FieldErrors.js';
import { useEffect, useState, type FormEvent } from 'react';
import type { Language, CardData } from '../../../../packages/contracts/src/index.js';
import type { ProvisioningInput } from '../../../../packages/contracts/src/provisioning.js';
import { LoyaltyCard } from '../../../../packages/ui/src/LoyaltyCard.js';
import { api, errorText, ApiError } from '../api.js';
type Merchant = {
  id: string;
  name: string;
  slug: string;
  status: string;
  primary_color: string;
  branch_count: number;
  staff_count: number;
  plan: string;
};
type Draft = {
  id: string;
  revision: number;
  status: string;
  data: ProvisioningInput;
  updated_at: string;
};
const normalize = (d: ProvisioningInput): ProvisioningInput => ({
  ...d,
  logoStyle: d.logoStyle || 'framed',
  logoSize: d.logoSize || 43,
  stampShape: d.stampShape || 'circle',
  stampIcon: d.stampIcon || 'check',
  stampStyle: d.stampStyle || 'solid',
  staff: d.staff.map((s) => ({ ...s, accessMode: s.accessMode || 'password' })),
});
const initial = (): ProvisioningInput => ({
  name: '',
  slug: '',
  contactEmail: '',
  contactPhone: '',
  timezone: 'Africa/Cairo',
  primaryColor: '#6F3F22',
  accentColor: '#E2A85B',
  surfaceColor: '#FBF5EE',
  template: 'classic',
  logoStyle: 'plain',
  logoSize: 43,
  stampShape: 'circle',
  stampIcon: 'check',
  stampStyle: 'solid',
  terms: 'ختم لكل عملية شراء مؤهلة. المكافأة حسب شروط البرنامج.',
  program: {
    name: '',
    threshold: 5,
    maxPerTx: 3,
    rewardTitle: '',
    rewardTerms: 'المكافأة صالحة30يوم من اكتسابها. لا تُستبدل نقدًا.',
    validityDays: 30,
    endsAt: null,
  },
  branches: [{ name: '', address: '' }],
  staff: [{ email: '', role: 'owner', branchIndexes: [0], maxQty: 3, accessMode: 'password' }],
  plan: 'growth',
});
type DraftRecovery = {
  editing: boolean;
  draft: Draft | null;
  data: ProvisioningInput;
  step: number;
  activation?: { id: string; revision: number } | null;
  attempt: { key: string; body: { data: ProvisioningInput } } | null;
};
export function PlatformPage({ lang, userId }: { lang: Language; userId: string }) {
  const storageKey = 'nuqta-provisioning-' + userId;
  const [recovered] = useState<DraftRecovery | null>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(storageKey) || 'null');
    } catch {
      return null;
    }
  });
  const [attempt, setAttempt] = useState(recovered?.attempt || null);
  const [activation, setActivation] = useState(recovered?.activation || null);
  const [mfaRequired, setMfaRequired] = useState(false),
    [mfaCode, setMfaCode] = useState('');
  const ar = lang === 'ar',
    [merchants, setMerchants] = useState<Merchant[]>([]),
    [drafts, setDrafts] = useState<Draft[]>([]),
    [editing, setEditing] = useState(recovered?.editing || false),
    [draft, setDraft] = useState<Draft | null>(recovered?.draft || null),
    [data, setData] = useState(recovered?.data ? normalize(recovered.data) : initial()),
    [step, setStep] = useState(recovered?.step || 0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [success, setSuccess] = useState<{ name: string; slug: string; id: string } | null>(null);
  const [statusChange, setStatusChange] = useState<Merchant | null>(null),
    [statusReason, setStatusReason] = useState('');
  const [passwords, setPasswords] = useState<Record<number, string>>({});
  const [savedEmails, setSavedEmails] = useState<string[]>([]);
  const [previewBusiness, setPreviewBusiness] = useState<string | null>(null),
    [workspaceTab, setWorkspaceTab] = useState('overview'),
    [workspaceProgram, setWorkspaceProgram] = useState('');
  const [workspace, setWorkspace] = useState<string | null>(() => {
    const id = new URLSearchParams(location.search).get('merchant');
    return id && /^[a-f0-9-]{36}$/.test(id) ? id : null;
  });
  useEffect(() => {
    setPasswords({});
    setSavedEmails([]);
    if (draft?.id && draft.status === 'draft')
      void api<{ emails: string[] }>('/platform/provisioning-drafts/' + draft.id + '/credentials')
        .then((r) => setSavedEmails(r.emails))
        .catch(showError);
  }, [draft?.id]);
  const [conflict, setConflict] = useState<Draft | null>(null);
  useEffect(() => {
    if (editing)
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ editing, draft, data, step, attempt, activation }),
      );
    else sessionStorage.removeItem(storageKey);
  }, [editing, draft, data, step, attempt, activation, storageKey]);
  const showError = (e: unknown) => {
    setValidation(e instanceof ApiError ? e : null);
    setError(errorText(e, lang));
    if (e instanceof ApiError && e.code === 'MFA_REQUIRED') setMfaRequired(true);
  };
  const reauth = mfaRequired && (
    <div className="modal-backdrop">
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reauth-title"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await api('/auth/mfa/verify', { method: 'POST', body: { code: mfaCode } });
            setMfaRequired(false);
            setMfaCode('');
            setError('');
            await load();
          } catch (e) {
            showError(e);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h2 id="reauth-title">{ar ? 'أكد هويتك عشان تكمّل' : 'Verify to continue'}</h2>
        <p>
          {ar
            ? 'تعديلاتك وخطوتك محفوظين. بعد التحقق كمّل من نفس المكان.'
            : 'Your inputs and current step are saved. Continue here after verification.'}
        </p>
        <label>
          {ar ? 'رمز تطبيق التحقق' : 'Authenticator code'}
          <input
            autoFocus
            type="password"
            inputMode="numeric"
            pattern="[0-9]{6}"
            required
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
          />
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={busy} aria-busy={busy}>
          {ar ? 'تحقق وكمل' : 'Verify and continue'}
        </button>
      </form>
    </div>
  );
  const [validation, setValidation] = useState<ApiError | null>(null);
  const steps = ar
    ? [
        'النشاط والتواصل',
        'الهوية والكارت',
        'قواعد البرنامج',
        'الفروع والفريق',
        'QR والمحفظة',
        'الخطة',
        'المراجعة والتفعيل',
      ]
    : [
        'Business',
        'Brand and card',
        'Program rules',
        'Branches and team',
        'QR and Wallet',
        'Plan',
        'Review and activate',
      ];
  const load = async () => {
    try {
      const [m, d] = await Promise.all([
        api<{ merchants: Merchant[] }>('/platform/merchants'),
        api<{ drafts: Draft[] }>('/platform/provisioning-drafts'),
      ]);
      setMerchants(m.merchants);
      setDrafts(d.drafts.filter((x) => x.status === 'draft'));
    } catch (e) {
      showError(e);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const patch = (v: Partial<ProvisioningInput>) => setData((d) => ({ ...d, ...v }));
  const save = async () => {
    let current = draft;
    if (!current) {
      const creation = attempt || { key: crypto.randomUUID(), body: { data } };
      setAttempt(creation);
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({ editing: true, draft: null, data, step, attempt: creation }),
      );
      const result = await api<{ draft: Draft }>('/platform/provisioning-drafts', {
        method: 'POST',
        body: creation.body,
        key: creation.key,
      });
      current = result.draft;
      setDraft(current);
      setAttempt(null);
      // A recovered create may contain an earlier snapshot. Apply unsaved edits
      // using its actual revision rather than silently dropping them.
      if (JSON.stringify(current.data) === JSON.stringify(data)) return current;
    }
    try {
      const result = await api<{ draft: Draft }>('/platform/provisioning-drafts/' + current.id, {
        method: 'PATCH',
        body: { data },
        revision: current.revision,
      });
      setDraft(result.draft);
      return result.draft;
    } catch (e) {
      if (e instanceof ApiError && e.code === 'REVISION_CONFLICT') {
        const list = await api<{ drafts: Draft[] }>('/platform/provisioning-drafts');
        const latest = list.drafts.find((d) => d.id === current.id);
        if (latest?.status === 'draft') {
          // Identical server content proves a lost save response. A genuinely
          // different revision requires an explicit review before overwriting.
          const same = (a: unknown, b: unknown): boolean => {
            if (a === b) return true;
            if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
            const left = Object.entries(a).sort(),
              right = Object.entries(b).sort();
            return (
              left.length === right.length &&
              left.every(([k, v], i) => k === right[i]?.[0] && same(v, right[i]?.[1]))
            );
          };
          if (same(latest.data, data)) {
            setDraft(latest);
            return latest;
          }
          setConflict(latest);
        }
      }
      throw e;
    }
  };
  const saveCredentials = async (current: Draft) => {
    const accounts = data.staff.flatMap((s, i) =>
      s.accessMode === 'password' && passwords[i]
        ? [{ email: s.email.toLowerCase(), password: passwords[i] }]
        : [],
    );
    if (accounts.length) {
      const r = await api<{ emails: string[] }>(
        '/platform/provisioning-drafts/' + current.id + '/credentials',
        { method: 'POST', body: { revision: current.revision, accounts } },
      );
      setSavedEmails((prev) => [...new Set([...prev, ...r.emails])]);
      setPasswords({});
    }
    const ready = [...savedEmails, ...accounts.map((a) => a.email)];
    if (
      data.staff.some((s) => s.accessMode === 'password' && !ready.includes(s.email.toLowerCase()))
    )
      throw new ApiError('STAFF_PASSWORD_REQUIRED', 422);
  };
  const uploadLogo = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      if (file.size > 2_000_000) throw new ApiError('ASSET_TOO_LARGE', 422);
      const current = await save();
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = '';
      for (const b of bytes) binary += String.fromCharCode(b);
      const r = await api<{ asset: { id: string } }>(
        '/platform/provisioning-drafts/' + current.id + '/logo',
        { method: 'POST', body: { base64: btoa(binary) } },
      );
      patch({ logoAssetId: r.asset.id });
    } catch (e) {
      showError(e);
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (step < 6) {
        const current = await save();
        if (step === 3) await saveCredentials(current);
        setStep(step + 1);
      } else {
        const d = activation || (await save());
        setActivation({ id: d.id, revision: d.revision });
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            editing: true,
            draft,
            data,
            step,
            attempt,
            activation: { id: d.id, revision: d.revision },
          }),
        );
        const result = await api<{ merchant: Merchant }>(
          '/platform/provisioning-drafts/' + d.id + '/activate',
          {
            method: 'POST',
            body: { draftRevision: d.revision },
            key: 'activate-' + d.id + '-' + d.revision,
          },
        );
        setActivation(null);
        setSuccess({
          name: result.merchant.name,
          slug: result.merchant.slug,
          id: result.merchant.id,
        });
        setEditing(false);
        await load();
      }
    } catch (e) {
      if (
        e instanceof ApiError &&
        e.status >= 400 &&
        e.status < 500 &&
        ![401, 403, 429].includes(e.status)
      )
        setActivation(null);
      if (
        e instanceof ApiError &&
        ['STAFF_PASSWORD_REQUIRED', 'ACCOUNT_EXISTS_USE_INVITATION'].includes(e.code)
      )
        setStep(3);
      showError(e);
    } finally {
      setBusy(false);
    }
  };
  const preview: CardData = {
    id: 'preview',
    merchant_id: 'preview',
    merchant_name: data.name || (ar ? 'اسم النشاط' : 'Business name'),
    alias: ar ? 'سارة م.' : 'Sara M.',
    program_name: data.program.name || (ar ? 'برنامج الولاء' : 'Loyalty program'),
    threshold: data.program.threshold,
    balance: Math.min(3, data.program.threshold - 1),
    primary_color: data.primaryColor,
    accent_color: data.accentColor,
    surface_color: data.surfaceColor,
    template: data.template,
    logo_style: data.logoStyle,
    logo_size: data.logoSize,
    stamp_shape: data.stampShape,
    stamp_icon: data.stampIcon,
    stamp_style: data.stampStyle,
    logo_url:
      data.logoAssetId && draft
        ? portalAssetUrl(
            '/api/v1/platform/provisioning-drafts/' + draft.id + '/logo/' + data.logoAssetId,
          )
        : undefined,
    reward_title: data.program.rewardTitle || (ar ? 'المكافأة' : 'Your reward'),
    revision: 1,
  };
  const newDraft = () => {
    setPasswords({});
    setSavedEmails([]);
    setAttempt(null);
    setActivation(null);
    setData(initial());
    setDraft(null);
    setStep(0);
    setEditing(true);
    setError('');
    setSuccess(null);
  };
  if (workspace)
    return (
      <MerchantWorkspace
        viewerId={userId}
        initialTab={workspaceTab}
        initialProgramId={workspaceProgram}
        merchantId={workspace}
        lang={lang}
        onBack={() => {
          setWorkspaceTab('overview');
          setWorkspace(null);
        }}
      />
    );
  if (editing)
    return (
      <>
        {reauth}
        {conflict && (
          <div className="modal-backdrop">
            <section
              className="dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="draft-conflict-title"
            >
              <h2 id="draft-conflict-title">
                {ar ? 'راجع النسخة اللي اتحدثت' : 'Review the changed draft'}
              </h2>
              <p>
                {ar
                  ? 'تعديلاتك محفوظة هنا. راجع النسختين قبل الحفظ فوق النسخة الجديدة.'
                  : 'Your edits are preserved here. Compare both versions before saving over the newer revision.'}
              </p>
              <details>
                <summary>{ar ? 'النسخة المحفوظة' : 'Saved version'}</summary>
                <pre className="operation-json">{JSON.stringify(conflict.data, null, 2)}</pre>
              </details>
              <details>
                <summary>{ar ? 'تعديلاتك الحالية' : 'Your current edits'}</summary>
                <pre className="operation-json">{JSON.stringify(data, null, 2)}</pre>
              </details>
              <div className="form-actions">
                <button className="secondary" data-dialog-close onClick={() => setConflict(null)}>
                  {ar ? 'رجوع' : 'Back'}
                </button>
                <button
                  className="primary"
                  onClick={() => {
                    setDraft(conflict);
                    setConflict(null);
                    setError('');
                  }}
                >
                  {ar ? 'راجعت وهكمل بتعديلاتي' : 'Reviewed: keep my edits'}
                </button>
              </div>
            </section>
          </div>
        )}
        <div className="page-heading">
          <div>
            <span className="eyebrow">{ar ? 'تاجر جديد' : 'New merchant'}</span>
            <h1>{steps[step]}</h1>
          </div>
          <button
            className="secondary"
            onClick={() => {
              setBusy(true);
              void save()
                .then(async (current) => {
                  if (step === 3) await saveCredentials(current);
                  setEditing(false);
                  return load();
                })
                .catch((e) => showError(e))
                .finally(() => setBusy(false));
            }}
            disabled={busy || !!activation}
            aria-busy={busy}
          >
            {ar ? 'احفظ واخرج' : 'Save and exit'}
          </button>
        </div>
        <div className="wizard-steps" aria-label={ar ? 'خطوات التجهيز' : 'Provisioning steps'}>
          {steps.map((s, i) => (
            <span
              key={s}
              aria-current={i === step ? 'step' : undefined}
              className={i === step ? 'current' : i < step ? 'done' : ''}
            >
              {i + 1}. {s}
            </span>
          ))}
        </div>
        <div className="wizard-layout">
          <form className="panel" onSubmit={(e) => void submit(e)}>
            <FieldErrors
              error={validation}
              lang={lang}
              onNavigate={(path) =>
                setStep(
                  path.startsWith('program.')
                    ? 2
                    : /^(staff|branches)/.test(path)
                      ? 3
                      : /Color$|template|^stamp/.test(path)
                        ? 1
                        : path === 'plan'
                          ? 5
                          : 0,
                )
              }
            />
            {step === 0 && (
              <>
                <label>
                  {ar ? 'اسم النشاط' : 'Business name'}
                  <input
                    required
                    {...fieldProps(validation, 'name')}
                    value={data.name}
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </label>
                <label>
                  {ar ? 'اسم رابط التسجيل' : 'Enrollment slug'}
                  <input
                    required
                    dir="ltr"
                    pattern="[a-z0-9][a-z0-9-]{1,62}"
                    placeholder="your-business"
                    {...fieldProps(validation, 'slug')}
                    value={data.slug}
                    onChange={(e) => patch({ slug: e.target.value.toLowerCase() })}
                  />
                </label>
                <label>
                  {ar ? 'بريد التواصل' : 'Contact email'}
                  <input
                    required
                    type="email"
                    dir="ltr"
                    {...fieldProps(validation, 'contactEmail')}
                    value={data.contactEmail}
                    onChange={(e) => patch({ contactEmail: e.target.value })}
                  />
                </label>
                <label>
                  {ar ? 'واتساب صاحب المحل (اختياري)' : 'Owner WhatsApp number (optional)'}
                  <PhoneInput
                    lang={lang}
                    aria-label={
                      ar ? 'واتساب صاحب المحل (اختياري)' : 'Owner WhatsApp number (optional)'
                    }
                    {...fieldProps(validation, 'contactPhone')}
                    value={data.contactPhone || ''}
                    onChange={(e) => patch({ contactPhone: e.target.value })}
                  />
                </label>
                <label>
                  {ar ? 'شروط التسجيل' : 'Enrollment terms'}
                  <textarea
                    required
                    {...fieldProps(validation, 'terms')}
                    value={data.terms}
                    onChange={(e) => patch({ terms: e.target.value })}
                  />
                </label>
              </>
            )}
            {step === 1 && (
              <>
                <label>
                  {ar ? 'لوجو المحل' : 'Business logo'}
                  <FileUpload
                    aria-label={ar ? 'لوجو المحل' : 'Business logo'}
                    accept="image/png,image/jpeg,image/webp"
                    disabled={busy}
                    onChange={(e) => void uploadLogo(e.target.files?.[0])}
                  />
                </label>
                <p className="muted">
                  {ar
                    ? 'PNG أو JPG أو WebP، لحد ٢ ميجا. هتشوفه على الكارت قبل التفعيل.'
                    : 'PNG, JPG or WebP, up to 2 MB. Preview your logo before activation.'}
                </p>
                {data.logoAssetId && (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => patch({ logoAssetId: null })}
                  >
                    {ar ? 'إزالة اللوجو' : 'Remove logo'}
                  </button>
                )}
                <LogoStyleControl
                  lang={lang}
                  logoUrl={preview.logo_url}
                  businessName={preview.merchant_name}
                  surfaceColor={data.surfaceColor}
                  value={data.logoStyle}
                  size={data.logoSize}
                  onSizeChange={(logoSize) => patch({ logoSize })}
                  onChange={(logoStyle) => patch({ logoStyle })}
                />
                <div className="form-grid">
                  {(
                    [
                      ['primaryColor', ar ? 'اللون الأساسي' : 'Primary color'],
                      ['accentColor', ar ? 'اللون الثانوي' : 'Accent color'],
                      ['surfaceColor', ar ? 'الخلفية' : 'Surface'],
                    ] as const
                  ).map(([k, label]) => (
                    <ColorField
                      key={k}
                      label={label}
                      name={k}
                      value={data[k]}
                      onChange={(v) => patch({ [k]: v })}
                    />
                  ))}
                </div>
                <PalettePaste
                  lang={lang}
                  onApply={([primaryColor, accentColor, surfaceColor]) =>
                    patch({ primaryColor, accentColor, surfaceColor })
                  }
                />
                <TemplatePicker
                  lang={lang}
                  card={preview}
                  onChange={(template) => patch({ template, ...suggestedStamps(template) })}
                />
                <StampControls
                  lang={lang}
                  card={preview}
                  onChange={patch}
                  onCountChange={(threshold) => patch({ program: { ...data.program, threshold } })}
                />
              </>
            )}
            {step === 2 && (
              <>
                <label>
                  {ar ? 'اسم البرنامج' : 'Program name'}
                  <input
                    required
                    {...fieldProps(validation, 'program.name')}
                    value={data.program.name}
                    onChange={(e) => patch({ program: { ...data.program, name: e.target.value } })}
                  />
                </label>
                <div className="form-grid">
                  <label>
                    {ar ? 'الأختام المطلوبة' : 'Stamps for reward'}
                    <input
                      type="number"
                      min={2}
                      max={50}
                      required
                      {...fieldProps(validation, 'program.threshold')}
                      value={data.program.threshold}
                      onChange={(e) =>
                        patch({ program: { ...data.program, threshold: Number(e.target.value) } })
                      }
                    />
                  </label>
                  <label>
                    {ar ? 'أقصى كمية في العملية' : 'Max per transaction'}
                    <input
                      type="number"
                      min={1}
                      max={100}
                      required
                      {...fieldProps(validation, 'program.maxPerTx')}
                      value={data.program.maxPerTx}
                      onChange={(e) =>
                        patch({ program: { ...data.program, maxPerTx: Number(e.target.value) } })
                      }
                    />
                  </label>
                </div>
                <label>
                  {ar ? 'وصف المكافأة' : 'Reward title'}
                  <input
                    required
                    {...fieldProps(validation, 'program.rewardTitle')}
                    value={data.program.rewardTitle}
                    onChange={(e) =>
                      patch({ program: { ...data.program, rewardTitle: e.target.value } })
                    }
                  />
                </label>
                <label>
                  {ar ? 'شروط المكافأة' : 'Reward terms'}
                  <textarea
                    required
                    {...fieldProps(validation, 'program.rewardTerms')}
                    value={data.program.rewardTerms}
                    onChange={(e) =>
                      patch({ program: { ...data.program, rewardTerms: e.target.value } })
                    }
                  />
                </label>
                <label>
                  {ar ? 'صلاحية المكافأة بالأيام' : 'Reward validity in days'}
                  <input
                    type="number"
                    min={1}
                    max={365}
                    {...fieldProps(validation, 'program.validityDays')}
                    value={data.program.validityDays}
                    onChange={(e) =>
                      patch({ program: { ...data.program, validityDays: Number(e.target.value) } })
                    }
                  />
                </label>
              </>
            )}
            {step === 3 && (
              <>
                <h2>{ar ? 'الفروع' : 'Branches'}</h2>
                {data.branches.map((b, i) => (
                  <div className="subpanel" key={i}>
                    <label>
                      {ar ? 'اسم الفرع' : 'Branch name'}
                      <input
                        required
                        {...fieldProps(validation, 'branches.' + i + '.name')}
                        value={b.name}
                        onChange={(e) =>
                          patch({
                            branches: data.branches.map((x, j) =>
                              j === i ? { ...x, name: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      {ar ? 'العنوان' : 'Address'}
                      <input
                        {...fieldProps(validation, 'branches.' + i + '.address')}
                        value={b.address}
                        onChange={(e) =>
                          patch({
                            branches: data.branches.map((x, j) =>
                              j === i ? { ...x, address: e.target.value } : x,
                            ),
                          })
                        }
                      />
                    </label>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary"
                  disabled={data.branches.length >= 10}
                  onClick={() => patch({ branches: [...data.branches, { name: '', address: '' }] })}
                >
                  {ar ? 'إضافة فرع' : 'Add branch'}
                </button>
                <h2>{ar ? 'المالك والفريق' : 'Owner and staff'}</h2>
                {data.staff.map((s, i) => (
                  <div className="subpanel" key={i}>
                    <label>
                      {ar ? 'البريد' : 'Email'}
                      <input
                        required
                        type="email"
                        dir="ltr"
                        {...fieldProps(validation, 'staff.' + i + '.email')}
                        value={s.email}
                        onChange={(e) =>
                          patch({
                            staff: data.staff.map((x, j) =>
                              i === j ? { ...x, email: e.target.value.toLowerCase() } : x,
                            ),
                          })
                        }
                      />
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={s.accessMode === 'invitation'}
                        onChange={(e) =>
                          patch({
                            staff: data.staff.map((x, j) =>
                              j === i
                                ? { ...x, accessMode: e.target.checked ? 'invitation' : 'password' }
                                : x,
                            ),
                          })
                        }
                      />
                      {ar
                        ? 'حساب موجود بالفعل؟ ابعت دعوة بدل إنشاء حساب'
                        : 'Existing account? Send an invitation instead'}
                    </label>
                    {s.accessMode !== 'invitation' && (
                      <label>
                        {ar ? 'باسورد الحساب' : 'Account password'}
                        <input
                          type="password"
                          aria-label={ar ? 'باسورد الحساب' : 'Account password'}
                          dir="ltr"
                          autoComplete="new-password"
                          minLength={10}
                          maxLength={128}
                          required={!savedEmails.includes(s.email.toLowerCase())}
                          value={passwords[i] || ''}
                          placeholder={
                            savedEmails.includes(s.email.toLowerCase())
                              ? ar
                                ? 'محفوظ — اكتب لتغييره قبل التفعيل'
                                : 'Saved — enter to replace before activation'
                              : ''
                          }
                          onChange={(e) => setPasswords((p) => ({ ...p, [i]: e.target.value }))}
                        />
                        <small className="muted">
                          {ar
                            ? '١٠ حروف أو أكتر. الحساب يقدر يدخل فور التفعيل.'
                            : 'At least 10 characters. The account can sign in immediately after activation.'}
                        </small>
                      </label>
                    )}
                    <div className="form-grid">
                      <label>
                        {ar ? 'الدور' : 'Role'}
                        <Select
                          {...fieldProps(validation, 'staff.' + i + '.role')}
                          value={s.role}
                          onChange={(e) =>
                            patch({
                              staff: data.staff.map((x, j) =>
                                i === j ? { ...x, role: e.target.value as typeof s.role } : x,
                              ),
                            })
                          }
                        >
                          <option value="owner">{ar ? 'مالك' : 'Owner'}</option>
                          <option value="manager">{ar ? 'مدير' : 'Manager'}</option>
                          <option value="cashier">{ar ? 'كاشير' : 'Cashier'}</option>
                        </Select>
                      </label>
                      <label>
                        {ar ? 'حد الأختام' : 'Stamp limit'}
                        <input
                          type="number"
                          min={1}
                          max={100}
                          {...fieldProps(validation, 'staff.' + i + '.maxQty')}
                          value={s.maxQty}
                          onChange={(e) =>
                            patch({
                              staff: data.staff.map((x, j) =>
                                i === j ? { ...x, maxQty: Number(e.target.value) } : x,
                              ),
                            })
                          }
                        />
                      </label>
                    </div>
                    <fieldset>
                      <legend>{ar ? 'الفروع المسموحة' : 'Allowed branches'}</legend>
                      {data.branches.map((b, j) => (
                        <label className="checkbox-label" key={j}>
                          <input
                            type="checkbox"
                            checked={s.branchIndexes.includes(j)}
                            onChange={() =>
                              patch({
                                staff: data.staff.map((x, k) =>
                                  k === i
                                    ? {
                                        ...x,
                                        branchIndexes: x.branchIndexes.includes(j)
                                          ? x.branchIndexes.filter((n) => n !== j)
                                          : [...x.branchIndexes, j],
                                      }
                                    : x,
                                ),
                              })
                            }
                          />
                          {b.name || (ar ? 'فرع' + (j + 1) : 'Branch ' + (j + 1))}
                        </label>
                      ))}
                    </fieldset>
                  </div>
                ))}
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    patch({
                      staff: [
                        ...data.staff,
                        {
                          email: '',
                          role: 'cashier',
                          branchIndexes: [0],
                          maxQty: 3,
                          accessMode: 'password',
                        },
                      ],
                    })
                  }
                >
                  {ar ? 'إضافة موظف' : 'Add staff member'}
                </button>
              </>
            )}
            {step === 4 && (
              <>
                {draft && (
                  <figure className="qr-preview">
                    <img
                      width="200"
                      height="200"
                      src={portalAssetUrl(
                        '/api/v1/platform/provisioning-drafts/' + draft.id + '/qr',
                      )}
                      alt={ar ? 'معاينة QR التسجيل' : 'Enrollment QR preview'}
                    />
                    <figcaption>
                      {ar
                        ? 'معاينة — الرابط يشتغل بعد التفعيل. كل فرع هيتولد له QR خاص.'
                        : 'Preview — active after activation. Each branch gets its own QR.'}
                    </figcaption>
                  </figure>
                )}
                <h2>{ar ? 'رابط تسجيل واحد بهوية النشاط' : 'One branded enrollment link'}</h2>
                <bdi className="url-box">
                  {location.origin}/join/{data.slug || 'your-business'}
                </bdi>
                <p>
                  {ar
                    ? 'QR الفرع وNFC بيفتحوا التسجيل. مفيش أختام بتتضاف تلقائيًا.'
                    : 'Branch QR and NFC open enrollment. They never award stamps automatically.'}
                </p>
                <div className="notice">
                  {ar
                    ? 'Apple Wallet وGoogle Wallet غير مفعّلين. كارت الويب مستقل وجاهز بعد التفعيل.'
                    : 'Apple Wallet and Google Wallet are not configured. The web card works independently.'}
                </div>
              </>
            )}
            {step === 5 && (
              <>
                <label>
                  {ar ? 'الخطة' : 'Plan'}
                  <Select
                    {...fieldProps(validation, 'plan')}
                    value={data.plan}
                    onChange={(e) => patch({ plan: e.target.value as ProvisioningInput['plan'] })}
                  >
                    <option value="starter">Starter ·1 branch /3 staff</option>
                    <option value="growth">Growth ·3 branches /10 staff</option>
                    <option value="pro">Pro ·10 branches /40 staff</option>
                  </Select>
                </label>
                <p className="muted">
                  {ar
                    ? 'الخطة بتحدد حدود الاستخدام. التحصيل الآلي غير مفعّل؛شروط الاشتراك باتفاق منفصل مع النشاط.'
                    : 'The plan sets usage limits. Automatic charging is not enabled; subscription terms are agreed separately.'}
                </p>
              </>
            )}
            {step === 6 && (
              <>
                <h2>{data.name}</h2>
                <dl className="review-list">
                  <dt>{ar ? 'الرابط' : 'Slug'}</dt>
                  <dd>
                    <bdi>{data.slug}</bdi>
                  </dd>
                  <dt>{ar ? 'البرنامج' : 'Program'}</dt>
                  <dd>
                    {data.program.name} ·{data.program.threshold}→{data.program.rewardTitle}
                  </dd>
                  <dt>{ar ? 'الفروع' : 'Branches'}</dt>
                  <dd>{data.branches.map((b) => b.name).join('، ')}</dd>
                  <dt>{ar ? 'الفريق' : 'Team'}</dt>
                  <dd>{data.staff.length}</dd>
                  <dt>{ar ? 'الخطة' : 'Plan'}</dt>
                  <dd>{data.plan}</dd>
                </dl>
                <p className="muted">
                  {ar
                    ? 'راجع صلاحيات الفروع وشروط المكافأة. تكرار التفعيل بيرجع نفس النشاط والدعوات.'
                    : 'Review branch permissions and reward terms. Retrying activation returns the same merchant and invitations.'}
                </p>
              </>
            )}
            {error && (
              <div className="notice error" role="alert">
                {error}
              </div>
            )}
            <div className="form-actions">
              {step > 0 && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy || !!activation}
                  aria-busy={busy}
                  onClick={() => setStep(step - 1)}
                >
                  {ar ? 'رجوع' : 'Back'}
                </button>
              )}
              <button className="primary" disabled={busy} aria-busy={busy}>
                {busy
                  ? ar
                    ? 'بنحفظ…'
                    : 'Saving…'
                  : activation
                    ? ar
                      ? 'تحقق من نفس التفعيل'
                      : 'Check activation'
                    : step === 6
                      ? ar
                        ? 'تفعيل النشاط'
                        : 'Activate merchant'
                      : ar
                        ? 'احفظ وكمّل'
                        : 'Save and continue'}
              </button>
            </div>
          </form>
          <aside>
            <span className="eyebrow">{ar ? 'معاينة الكارت' : 'Card preview'}</span>
            <LoyaltyCard card={preview} lang={lang} />
          </aside>
        </div>
      </>
    );
  return (
    <>
      {reauth}
      <div className="page-heading">
        <div>
          <span className="eyebrow">{ar ? 'نقطة للأعمال' : 'Nuqta for business'}</span>
          <h1>{ar ? 'التجار' : 'Merchants'}</h1>
        </div>
        <button className="primary" onClick={newDraft}>
          {ar ? 'تاجر جديد' : 'New merchant'}
        </button>
      </div>
      {error && (
        <div className="notice error" role="alert">
          {error}
        </div>
      )}
      {success && (
        <div className="notice success activation-result" role="status">
          <span>
            {ar ? 'اتفعّل النشاط: ' : 'Merchant activated: '}
            {success.name}
          </span>
          <button className="secondary" onClick={() => setWorkspace(success.id)}>
            {ar ? 'فتح ملف المحل' : 'Open business workspace'}
          </button>
          <button className="primary small" onClick={() => setPreviewBusiness(success.id)}>
            {ar ? 'معاينة المحل' : 'Preview business'}
          </button>
          <a href={'/join/' + success.slug}>{ar ? 'افتح التسجيل' : 'Open enrollment'}</a>
        </div>
      )}
      {success && <EnrollmentCodes merchantId={success.id} lang={lang} />}
      <div className="kpi-grid platform-metrics">
        <div className="kpi">
          <small>{ar ? 'التجار' : 'Merchants'}</small>
          <strong>{merchants.length}</strong>
        </div>
        <div className="kpi">
          <small>{ar ? 'نشطين' : 'Active'}</small>
          <strong>{merchants.filter((m) => m.status === 'active').length}</strong>
        </div>
        <div className="kpi">
          <small>{ar ? 'مسودات محفوظة' : 'Saved drafts'}</small>
          <strong>{drafts.length}</strong>
        </div>
      </div>
      {drafts.length > 0 && (
        <section className="panel">
          <h2>{ar ? 'كمّل تجهيز نشاط' : 'Resume provisioning'}</h2>
          {drafts.map((d) => (
            <div className="list-row" key={d.id}>
              <div>
                <strong>{d.data.name || (ar ? 'مسودة جديدة' : 'New draft')}</strong>
                <small className="muted">{new Date(d.updated_at).toLocaleDateString(lang)}</small>
              </div>
              <button
                className="secondary small"
                onClick={() => {
                  setDraft(d);
                  setData(normalize({ ...initial(), ...d.data }));
                  setStep(0);
                  setEditing(true);
                }}
              >
                {ar ? 'كمّل' : 'Resume'}
              </button>
            </div>
          ))}
        </section>
      )}
      {!merchants.length && (
        <section className="onboarding-empty">
          <div className="onboarding-illustration" aria-hidden="true">
            <div className="mini-membership">
              <span>NUQTA MEMBERSHIP</span>
              <strong>{ar ? 'حكاية جديدة' : 'A new beginning'}</strong>
              <div>● ● ● ◌ ◌</div>
            </div>
            <span className="onboarding-spark">
              <Icon name="spark" size={30} />
            </span>
          </div>
          <div>
            <span className="eyebrow">{ar ? 'أول نشاط. وأول علاقة.' : 'YOUR FIRST BUSINESS'}</span>
            <h2>{ar ? 'كل حكاية بتبدأ بنقطة.' : 'Every story starts with a Nuqta.'}</h2>
            <p>
              {ar
                ? 'جهّز هوية النشاط وبرنامج مكافآته، وادعُ المالك يبدأ مع فريقه.'
                : 'Set up the brand, shape its rewards, and invite the owner to bring their team.'}
            </p>
            <button className="primary" onClick={newDraft}>
              {ar ? 'جهّز أول نشاط' : 'Set up your first business'}
              <Icon name="arrow" size={17} />
            </button>
          </div>
        </section>
      )}
      <section className="panel merchant-register">
        <div className="section-heading">
          <h2>{ar ? 'الأنشطة المشتركة' : 'Your businesses'}</h2>
          <span className="badge">{merchants.length}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {(ar
                  ? ['النشاط', 'الحالة', 'الفروع', 'الفريق', 'الخطة', 'إجراء']
                  : ['Business', 'Status', 'Branches', 'Staff', 'Plan', 'Action']
                ).map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {merchants.map((m) => (
                <tr key={m.id}>
                  <td>
                    <button className="text-button" onClick={() => setWorkspace(m.id)}>
                      <strong>{m.name}</strong>
                    </button>
                    <small>
                      <bdi>{m.slug}</bdi>
                    </small>
                  </td>
                  <td>
                    <span className="badge">{m.status}</span>
                  </td>
                  <td>{m.branch_count}</td>
                  <td>{m.staff_count}</td>
                  <td>{m.plan || '—'}</td>
                  <td>
                    <button className="primary small" onClick={() => setPreviewBusiness(m.id)}>
                      {ar ? 'معاينة' : 'Preview'}
                    </button>
                    <button
                      className="secondary small"
                      onClick={() => navigate('/platform/merchants/' + m.id + '/owner-view')}
                    >
                      {ar ? 'عرض واجهة المالك' : 'View owner dashboard'}
                    </button>
                    <button
                      className="secondary small"
                      onClick={() => {
                        setWorkspaceTab('overview');
                        setWorkspace(m.id);
                      }}
                    >
                      {ar ? 'فتح ملف المحل' : 'Open workspace'}
                    </button>
                    <button
                      type="button"
                      role="switch"
                      className="business-status-switch"
                      aria-label={(ar ? 'تشغيل المحل: ' : 'Business active: ') + m.name}
                      aria-checked={m.status !== 'suspended'}
                      disabled={busy}
                      onClick={() => {
                        setStatusChange(m);
                        setStatusReason('');
                      }}
                    >
                      <span className="ios-switch-track" aria-hidden="true">
                        <span />
                      </span>
                      <span className="switch-caption">
                        {m.status === 'suspended'
                          ? ar
                            ? 'متوقف'
                            : 'Paused'
                          : ar
                            ? 'شغال'
                            : 'Active'}
                      </span>
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {previewBusiness && (
        <BusinessPreview
          merchantId={previewBusiness}
          lang={lang}
          onClose={() => setPreviewBusiness(null)}
          onOpen={(tab, programId) => {
            setWorkspaceProgram(programId || '');
            setWorkspaceTab(tab);
            setWorkspace(previewBusiness);
            setPreviewBusiness(null);
          }}
        />
      )}
      {statusChange && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="merchant-status"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              void api('/platform/merchants/' + statusChange.id + '/status', {
                method: 'POST',
                body: {
                  status: statusChange.status === 'suspended' ? 'active' : 'suspended',
                  reason: statusReason,
                },
              })
                .then(() => {
                  setStatusChange(null);
                  return load();
                })
                .catch((e) => showError(e))
                .finally(() => setBusy(false));
            }}
          >
            <h2 id="merchant-status">{statusChange.name}</h2>
            <label>
              {ar ? 'سبب تغيير الحالة' : 'Reason for status change'}
              <textarea
                required
                autoFocus
                minLength={4}
                maxLength={500}
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
              />
            </label>
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                onClick={() => setStatusChange(null)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button className="primary" disabled={busy} aria-busy={busy}>
                {ar ? 'تأكيد' : 'Confirm'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
