import { PhoneInput } from '../controls/PhoneInput.js';
import { portalAssetUrl } from '../portals.js';
import { saveLogo } from '../controls/save-logo.js';
import { FileUpload } from '../controls/FileUpload.js';
import { Select } from '../controls/Select.js';
import { useEffect, useState } from 'react';
import type { CardData, Language } from '../../../../packages/contracts/src/index.js';
import {
  suggestedStamps,
  type CardTemplate,
  type StampShape,
  type StampIcon,
  type StampStyle,
  type LogoStyle,
} from '../../../../packages/contracts/src/branding.js';
import { api, errorText } from '../api.js';
import {
  ColorField,
  PalettePaste,
  TemplatePicker,
  StampControls,
  LogoStyleControl,
} from './BrandControls.js';
import { LoyaltyCard } from '../../../../packages/ui/src/LoyaltyCard.js';
interface Brand {
  id: string;
  name: string;
  revision: number;
  primary_color: string;
  accent_color: string;
  surface_color: string;
  template: CardTemplate;
  stamp_shape: StampShape;
  stamp_icon: StampIcon;
  stamp_style: StampStyle;
  logo_asset_id: string | null;
  logo_style: LogoStyle;
  logo_size: number;
  terms: string;
  contact_email: string;
  contact_phone: string;
}
interface Program {
  id: string;
  name: string;
  threshold: number;
  max_per_tx: number;
  reward_title: string;
  reward_terms: string;
  validity_days: number;
  ends_at: string | null;
  branch_ids: string[];
}
export function MerchantCardDesigner({
  merchantId,
  lang,
  onChanged,
  initialProgramId = '',
}: {
  merchantId: string;
  lang: Language;
  onChanged?: () => Promise<void>;
  initialProgramId?: string;
}) {
  const ar = lang === 'ar',
    [brand, setBrand] = useState<Brand | null>(null),
    [programs, setPrograms] = useState<Program[]>([]),
    [programId, setProgramId] = useState(initialProgramId),
    [count, setCount] = useState<number | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [countCommand, setCountCommand] = useState<{
      key: string;
      program: Program;
      threshold: number;
    } | null>(null);
  const base = '/merchants/' + merchantId;
  const load = async () => {
    try {
      const [m, p] = await Promise.all([
        api<{ merchant: Brand }>(base),
        api<{ programs: Program[] }>(base + '/programs'),
      ]);
      setBrand(m.merchant);
      setPrograms(p.programs);
    } catch (e) {
      setError(errorText(e, lang));
    }
  };
  useEffect(() => {
    void load();
  }, [merchantId]);
  const program = programs.find((p) => p.id === programId) || programs[0];
  const card: CardData | null = brand
    ? {
        id: 'admin-preview',
        merchant_id: merchantId,
        merchant_name: brand.name,
        alias: ar ? 'معاينة اسم العميل' : 'Customer name preview',
        program_name: program?.name || '',
        threshold: count ?? program?.threshold ?? 5,
        balance: 2,
        primary_color: brand.primary_color,
        accent_color: brand.accent_color,
        surface_color: brand.surface_color,
        template: brand.template,
        logo_style: brand.logo_style,
        logo_size: brand.logo_size,
        stamp_shape: brand.stamp_shape,
        stamp_icon: brand.stamp_icon,
        stamp_style: brand.stamp_style,
        logo_url: brand.logo_asset_id
          ? portalAssetUrl('/api/v1' + base + '/assets/' + brand.logo_asset_id)
          : undefined,
        reward_title: program?.reward_title || '',
        revision: brand.revision,
      }
    : null;
  if (!brand || !card)
    return <p role="status">{error || (ar ? 'بنفتح تصميم الكارت…' : 'Loading card design…')}</p>;
  const patch = (v: Partial<Brand>) => setBrand((b) => (b ? { ...b, ...v } : b));
  return (
    <>
      <p className="muted">
        {ar
          ? 'دي الهوية اللي العميل بيشوفها. التعديلات بتتحفظ للمحل نفسه، وكل نشر بيتسجل في سجل الإجراءات.'
          : 'This is what customers see. Changes update this business and are recorded in its audit history.'}
      </p>
      {notice && (
        <p className="notice success" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      <div className="wizard-layout">
        <form
          className="panel"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const r = await api<{ merchant: Brand }>(base + '/branding', {
                method: 'PATCH',
                revision: brand.revision,
                body: {
                  name: brand.name,
                  primaryColor: brand.primary_color,
                  accentColor: brand.accent_color,
                  surfaceColor: brand.surface_color,
                  template: brand.template,
                  stampShape: brand.stamp_shape,
                  stampIcon: brand.stamp_icon,
                  stampStyle: brand.stamp_style,
                  logoAssetId: brand.logo_asset_id,
                  logoStyle: brand.logo_style,
                  logoSize: brand.logo_size,
                  terms: brand.terms,
                  contactEmail: brand.contact_email || undefined,
                  contactPhone: brand.contact_phone,
                },
              });
              setBrand(r.merchant);
              setNotice(
                ar ? 'الكارت وبيانات التواصل اتحفظوا.' : 'Card design and contact details saved.',
              );
              await onChanged?.();
            } catch (e) {
              setError(errorText(e, lang));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="brand-savebar">
            <h2>{ar ? 'الكارت والهوية' : 'Card and branding'}</h2>
            <button className="primary small" type="submit" disabled={busy}>
              {ar ? 'حفظ التغييرات' : 'Save changes'}
            </button>
          </div>
          <label>
            {ar ? 'اسم المحل' : 'Business name'}
            <input
              required
              minLength={2}
              maxLength={120}
              value={brand.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </label>
          <label>
            {ar ? 'لوجو المحل' : 'Business logo'}
            <FileUpload
              aria-label={ar ? 'لوجو المحل' : 'Business logo'}
              accept="image/png,image/jpeg,image/webp"
              disabled={busy}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setBusy(true);
                try {
                  const r = await saveLogo<Brand>(merchantId, file, brand.revision);
                  patch({ logo_asset_id: r.asset.id, revision: r.merchant.revision });
                  setNotice(ar ? 'اللوجو اتحفظ وظهر على الكارت.' : 'Logo saved to your card.');
                } catch (e) {
                  setError(errorText(e, lang));
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          <LogoStyleControl
            lang={lang}
            logoUrl={card.logo_url}
            businessName={brand.name}
            surfaceColor={brand.surface_color}
            value={brand.logo_style}
            size={brand.logo_size}
            onSizeChange={(logo_size) => patch({ logo_size })}
            onChange={(logo_style) => patch({ logo_style })}
          />
          <div className="form-grid">
            {(
              [
                ['primary_color', ar ? 'الأساسي' : 'Primary'],
                ['accent_color', ar ? 'الثانوي' : 'Accent'],
                ['surface_color', ar ? 'الخلفية' : 'Surface'],
              ] as const
            ).map(([key, label]) => (
              <ColorField
                key={key}
                name={'admin-' + key}
                label={label}
                value={brand[key]}
                onChange={(value) => patch({ [key]: value })}
              />
            ))}
          </div>
          <PalettePaste
            lang={lang}
            onApply={([primary_color, accent_color, surface_color]) =>
              patch({ primary_color, accent_color, surface_color })
            }
          />
          <TemplatePicker
            lang={lang}
            card={card}
            onChange={(template) => {
              const s = suggestedStamps(template);
              patch({
                template,
                ...(s
                  ? {
                      stamp_shape: s.stampShape,
                      stamp_icon: s.stampIcon,
                      stamp_style: s.stampStyle,
                    }
                  : {}),
              });
            }}
          />
          {programs.length > 1 && (
            <label>
              {ar ? 'برنامج المعاينة' : 'Preview program'}
              <Select
                aria-label={ar ? 'برنامج المعاينة' : 'Preview program'}
                value={program?.id || ''}
                onChange={(e) => {
                  setProgramId(e.target.value);
                  setCount(null);
                }}
              >
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </label>
          )}
          <StampControls
            lang={lang}
            card={card}
            onChange={(s) =>
              patch({
                stamp_shape: s.stampShape,
                stamp_icon: s.stampIcon,
                stamp_style: s.stampStyle,
              })
            }
            onCountChange={program ? setCount : undefined}
            countAction={
              program && (
                <div className="count-publish">
                  <p>
                    {ar
                      ? 'العدد الجديد للتسجيلات الجديدة. الكروت الحالية تحتفظ بشروطها. نشر الهوية يحفظ التصميم فقط.'
                      : 'A new count applies to new enrollments. Existing cards keep their rules. Publishing branding saves the artwork only.'}
                  </p>
                  <button
                    type="button"
                    className="secondary small"
                    disabled={
                      busy ||
                      card.threshold === program.threshold ||
                      card.threshold < 2 ||
                      card.threshold > 50 ||
                      !Number.isInteger(card.threshold)
                    }
                    onClick={() =>
                      setCountCommand({
                        key: crypto.randomUUID(),
                        program: { ...program },
                        threshold: card.threshold,
                      })
                    }
                  >
                    {ar ? 'مراجعة ونشر العدد الجديد' : 'Review and publish stamp count'}
                  </button>
                </div>
              )
            }
          />
          <h3>{ar ? 'تواصل صاحب المحل' : 'Business contact'}</h3>
          <label>
            {ar ? 'إيميل التواصل' : 'Contact email'}
            <input
              type="email"
              dir="ltr"
              value={brand.contact_email}
              onChange={(e) => patch({ contact_email: e.target.value })}
            />
          </label>
          <label>
            {ar ? 'واتساب صاحب المحل' : 'Owner WhatsApp number'}
            <PhoneInput
              lang={lang}
              aria-label={ar ? 'واتساب صاحب المحل' : 'Owner WhatsApp number'}
              value={brand.contact_phone}
              onChange={(e) => patch({ contact_phone: e.target.value })}
            />
          </label>
          <label>
            {ar ? 'شروط التسجيل' : 'Enrollment terms'}
            <textarea
              required
              minLength={4}
              maxLength={3000}
              value={brand.terms}
              onChange={(e) => patch({ terms: e.target.value })}
            />
          </label>
          <button className="primary" disabled={busy}>
            {ar ? 'نشر الكارت وبيانات التواصل' : 'Publish card and contact details'}
          </button>
        </form>
        <aside>
          <span className="eyebrow">{ar ? 'معاينة الكارت' : 'Card preview'}</span>
          <LoyaltyCard card={card} lang={lang} />
        </aside>
      </div>
      {countCommand && (
        <div className="modal-backdrop">
          <form
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-count-title"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              const { program: p, threshold, key } = countCommand;
              try {
                await api(base + '/programs/' + p.id + '/versions', {
                  method: 'POST',
                  key,
                  body: {
                    name: p.name,
                    threshold,
                    maxPerTx: p.max_per_tx,
                    rewardTitle: p.reward_title,
                    rewardTerms: p.reward_terms,
                    validityDays: p.validity_days,
                    endsAt: p.ends_at,
                    branchIds: p.branch_ids,
                  },
                });
                setPrograms((all) =>
                  all.map((item) => (item.id === p.id ? { ...item, threshold } : item)),
                );
                setCount(null);
                setCountCommand(null);
                setNotice(
                  ar
                    ? 'العدد الجديد اتنشر. الكروت الحالية محفوظة.'
                    : 'New count published. Existing cards are preserved.',
                );
                await onChanged?.();
              } catch (e) {
                setError(errorText(e, lang));
              } finally {
                setBusy(false);
              }
            }}
          >
            <h2 id="admin-count-title">{ar ? 'نشر عدد جديد' : 'Publish a new stamp count'}</h2>
            <p>
              {program?.name} · {countCommand.threshold} {ar ? 'ختم للمكافأة' : 'stamps per reward'}
            </p>
            <p className="muted">
              {ar
                ? 'النسخة الجديدة تخص التسجيلات الجديدة، ولا تستأنف برنامجًا موقوفًا.'
                : 'This version applies to new enrollments and does not resume a paused program.'}
            </p>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                data-dialog-close
                onClick={() => setCountCommand(null)}
              >
                {ar ? 'إلغاء' : 'Cancel'}
              </button>
              <button className="primary" disabled={busy}>
                {ar ? 'نشر النسخة' : 'Publish version'}
              </button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
