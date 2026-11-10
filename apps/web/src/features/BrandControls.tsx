import { ColorPicker } from '../controls/ColorPicker.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';
import { Select } from '../controls/Select.js';
import { StampFrame, StampSymbol } from '../../../../packages/ui/src/StampSymbol.js';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  cardTemplates,
  templateNames,
  type CardTemplate,
  stampShapes,
  stampIcons,
  stampShapeNames,
  stampIconNames,
  templateCategory,
  categoryNames,
  suggestedStamps,
  type TemplateCategory,
  type StampShape,
  type StampIcon,
  type StampStyle,
  type LogoStyle,
} from '../../../../packages/contracts/src/branding.js';
import type { CardData, Language } from '../../../../packages/contracts/src/index.js';
import { LoyaltyCard, cardInk } from '../../../../packages/ui/src/LoyaltyCard.js';
export function LogoStyleControl({
  lang,
  value = 'framed',
  onChange,
  logoUrl,
  businessName = '',
  size = 43,
  onSizeChange,
  surfaceColor = '#F5F1E7',
}: {
  lang: Language;
  value?: LogoStyle;
  onChange: (v: LogoStyle) => void;
  logoUrl?: string;
  businessName?: string;
  size?: number;
  onSizeChange?: (size: number) => void;
  surfaceColor?: string;
}) {
  const ar = lang === 'ar';
  return (
    <fieldset className="logo-controls">
      <legend>{ar ? 'خلفية عرض اللوجو' : 'Logo background'}</legend>
      <div className="logo-choices">
        {(['plain', 'framed'] as const).map((style) => (
          <button
            type="button"
            key={style}
            aria-pressed={value === style}
            aria-label={
              style === 'plain'
                ? ar
                  ? 'بدون خلفية'
                  : 'No background'
                : ar
                  ? 'داخل إطار'
                  : 'Framed'
            }
            onClick={() => onChange(style)}
          >
            <span
              className={'logo-style-example ' + style}
              aria-hidden="true"
              style={style === 'framed' ? { backgroundColor: surfaceColor } : undefined}
            >
              {logoUrl ? (
                <img src={logoUrl} alt="" />
              ) : businessName ? (
                <span className="logo-initial">{Array.from(businessName)[0]}</span>
              ) : (
                <Icon name="shop" size={24} />
              )}
            </span>
            <span>
              {style === 'plain'
                ? ar
                  ? 'بدون خلفية'
                  : 'No background'
                : ar
                  ? 'داخل إطار'
                  : 'Framed'}
            </span>
            <span className="logo-choice-check" aria-hidden="true">
              {value === style && <Icon name="check" size={15} />}
            </span>
          </button>
        ))}
      </div>
      {onSizeChange && (
        <label className="logo-size-control">
          <span>
            {ar ? 'حجم اللوجو' : 'Logo size'}
            <output>{Math.round((size / 43) * 100)}%</output>
          </span>
          <input
            type="range"
            min={32}
            max={72}
            step={1}
            value={size}
            onChange={(e) => onSizeChange(Number(e.target.value))}
            aria-label={ar ? 'حجم اللوجو' : 'Logo size'}
          />
          <span className="logo-size-ends">
            <small>{ar ? 'أصغر' : 'Smaller'}</small>
            <small>{ar ? 'أكبر' : 'Larger'}</small>
          </span>
        </label>
      )}
      <small className="muted">
        {ar
          ? 'اختار طريقة العرض وشوف اللوجو على الكارت قبل النشر.'
          : 'Choose the presentation and preview your logo on the card before publishing.'}
      </small>
    </fieldset>
  );
}
export function ColorField({
  label,
  name,
  value,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const edit = (raw: string) => {
    setText(raw);
    const hex = '#' + raw.trim().replace(/^#/, '');
    if (/^#[a-f0-9]{6}$/i.test(hex)) onChange(hex.toUpperCase());
  };
  return (
    <div className="color-field">
      <label htmlFor={name + '-hex'}>{label}</label>
      <div className="color-inputs">
        <ColorPicker label={label + ' picker'} value={value} onChange={onChange} />
        <input
          id={name + '-hex'}
          name={name}
          dir="ltr"
          aria-label={label + ' HEX'}
          value={text}
          placeholder="#1F4D42"
          pattern="#?[a-fA-F0-9]{3}([a-fA-F0-9]{3})?"
          required
          onChange={(e) => edit(e.target.value)}
          onBlur={() => {
            const raw = text.trim().replace(/^#/, '');
            if (/^[a-f0-9]{3}$/i.test(raw)) {
              onChange(
                '#' +
                  raw
                    .split('')
                    .map((c) => c + c)
                    .join('')
                    .toUpperCase(),
              );
            } else if (/^[a-f0-9]{6}$/i.test(raw)) setText('#' + raw.toUpperCase());
          }}
        />
      </div>
    </div>
  );
}
export function PalettePaste({
  lang,
  onApply,
}: {
  lang: Language;
  onApply: (colors: string[]) => void;
}) {
  const [value, setValue] = useState(''),
    [error, setError] = useState(false),
    ar = lang === 'ar';
  return (
    <div className="palette-paste">
      <label>
        {ar ? 'ألوان الهوية مرة واحدة (٣ أكواد HEX)' : 'Paste brand palette (3 HEX codes)'}
        <input
          dir="ltr"
          value={value}
          placeholder="#1F4D42 #D4A65A #F8F4EC"
          onChange={(e) => setValue(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="secondary small"
        onClick={() => {
          const codes = value
            .trim()
            .split(/[\s,;]+/)
            .map((v) => '#' + v.replace(/^#/, ''));
          if (codes.length !== 3 || codes.some((v) => !/^#[a-f0-9]{6}$/i.test(v))) {
            setError(true);
            return;
          }
          onApply(codes);
          setError(false);
        }}
      >
        {ar ? 'تطبيق الألوان' : 'Apply palette'}
      </button>
      {error && (
        <p role="alert" className="error-text">
          {ar ? 'اكتب ٣ أكواد من ٦ حروف أو أرقام لكل لون.' : 'Enter three 6-digit HEX colors.'}
        </p>
      )}
    </div>
  );
}
export function TemplatePicker({
  lang,
  card,
  onChange,
}: {
  lang: Language;
  card: CardData;
  onChange: (v: CardTemplate) => void;
}) {
  const ar = lang === 'ar',
    [category, setCategory] = useState<'all' | TemplateCategory>('all');
  return (
    <div className="template-picker">
      <label>
        {ar ? 'قالب الكارت' : 'Card template'}
        <Select
          name="template"
          aria-label={ar ? 'قالب الكارت' : 'Card template'}
          value={card.template}
          onChange={(e) => onChange(e.target.value as CardTemplate)}
        >
          {cardTemplates.map((t) => (
            <option key={t} value={t}>
              {templateNames[t][lang]}
            </option>
          ))}
        </Select>
      </label>
      <div className="template-filters" aria-label={ar ? 'نوع النشاط' : 'Business category'}>
        {(['all', 'general', 'cafe', 'restaurant', 'barber'] as const).map((c) => (
          <button
            type="button"
            key={c}
            aria-pressed={category === c}
            onClick={() => setCategory(c)}
          >
            {c === 'all' ? (ar ? 'كل القوالب' : 'All templates') : categoryNames[c][lang]}
          </button>
        ))}
      </div>
      <p className="muted template-help">
        {ar
          ? 'قوالب الأنشطة فيها أختام مقترحة. تقدر تغيّر شكل الختم ورمزه من تحت.'
          : 'Business templates include suggested stamps. Customize their shape and symbol below.'}
      </p>
      <div className="template-gallery">
        {cardTemplates
          .filter((t) => category === 'all' || templateCategory(t) === category)
          .map((t) => (
            <button
              type="button"
              key={t}
              aria-pressed={card.template === t}
              className="template-choice"
              onClick={() => onChange(t)}
            >
              <TemplateThumbnail
                card={{
                  ...card,
                  id: 'template-' + t,
                  template: t,
                  logo_asset_id: undefined,
                  logo_url: undefined,
                  threshold: 5,
                  balance: 2,
                  stamp_shape: suggestedStamps(t)?.stampShape || card.stamp_shape,
                  stamp_icon: suggestedStamps(t)?.stampIcon || card.stamp_icon,
                  stamp_style: suggestedStamps(t)?.stampStyle || card.stamp_style,
                }}
                lang={lang}
              />
              <span>
                {templateNames[t][lang]}
                {card.template === t ? ' ✓' : ''}
                <small className="template-category">
                  {categoryNames[templateCategory(t)][lang]}
                </small>
              </span>
            </button>
          ))}
      </div>
    </div>
  );
}

function TemplateThumbnail({ card, lang }: { card: CardData; lang: Language }) {
  const frame = useRef<HTMLSpanElement>(null);
  const [size, setSize] = useState({ scale: 0.38, height: 148 });
  useLayoutEffect(() => {
    const outer = frame.current;
    const inner = outer?.firstElementChild as HTMLSpanElement | null;
    if (!outer || !inner) return;
    let alive = true;
    const measure = () => {
      if (!alive || !outer.clientWidth) return;
      const scale = outer.clientWidth / 340;
      const height = Math.ceil(inner.offsetHeight * scale);
      setSize((previous) =>
        previous.scale === scale && previous.height === height ? previous : { scale, height },
      );
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(outer);
    observer?.observe(inner);
    window.addEventListener('resize', measure);
    void document.fonts?.ready.then(measure);
    return () => {
      alive = false;
      observer?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [card, lang]);
  return (
    <span className="template-thumb" aria-hidden="true" ref={frame} style={{ height: size.height }}>
      <span style={{ transform: `scale(${size.scale})` }}>
        <LoyaltyCard card={card} lang={lang} />
      </span>
    </span>
  );
}

export function StampControls({
  lang,
  card,
  onChange,
  onCountChange,
  countAction,
}: {
  lang: Language;
  card: CardData;
  onCountChange?: (value: number) => void;
  countAction?: React.ReactNode;
  onChange: (settings: {
    stampShape: StampShape;
    stampIcon: StampIcon;
    stampStyle: StampStyle;
  }) => void;
}) {
  const ar = lang === 'ar',
    shape = card.stamp_shape || 'circle',
    symbol = card.stamp_icon || 'check',
    style = card.stamp_style || 'solid';
  const patch = (
    value: Partial<{ stampShape: StampShape; stampIcon: StampIcon; stampStyle: StampStyle }>,
  ) => onChange({ stampShape: shape, stampIcon: symbol, stampStyle: style, ...value });
  return (
    <section className="stamp-customizer">
      <div className="section-heading">
        <div>
          <span className="eyebrow">{ar ? 'تفاصيل الكارت' : 'CARD DETAILS'}</span>
          <h3>{ar ? 'صمّم أختامك' : 'Make the stamps yours'}</h3>
        </div>
        <span
          className={'stamp-sample loyalty-card stamp-shape-' + shape + ' stamp-style-' + style}
          aria-hidden="true"
          style={
            {
              '--brand': card.primary_color,
              '--card-ink': cardInk(card.primary_color),
              '--accent': card.accent_color,
              '--accent-ink': cardInk(card.accent_color),
            } as React.CSSProperties
          }
        >
          <span className="stamp-dots">
            <span className="filled">
              <StampFrame shape={shape} />
              <StampSymbol symbol={symbol} />
            </span>
          </span>
        </span>
      </div>
      <details className="mobile-stamp-preview" open>
        <summary>{ar ? 'معاينة الكارت' : 'Card preview'}</summary>
        <LoyaltyCard card={card} lang={lang} />
      </details>
      {onCountChange && (
        <div className="stamp-count-control">
          <label>
            {ar ? 'عدد الأختام للمكافأة' : 'Number of stamps'}
            <input
              type="number"
              aria-label={ar ? 'عدد الأختام للمكافأة' : 'Number of stamps'}
              min={2}
              max={50}
              step={1}
              required
              value={card.threshold}
              onChange={(e) => onCountChange(Number(e.target.value))}
            />
          </label>
          <div className="stamp-count-presets">
            {[5, 6, 8, 10, 12].map((n) => (
              <button
                type="button"
                key={n}
                aria-pressed={card.threshold === n}
                onClick={() => onCountChange(n)}
              >
                {n}
              </button>
            ))}
          </div>
          <small className="muted">
            {ar
              ? 'من ٢ لـ٥٠ ختم. العدد ده هو المطلوب عشان العميل يكسب المكافأة.'
              : '2–50 stamps. This is how many a customer needs to earn the reward.'}
          </small>
          {countAction}
        </div>
      )}
      <div className="form-grid">
        <label>
          {ar ? 'شكل الختم' : 'Stamp shape'}
          <Select
            aria-label={ar ? 'شكل الختم' : 'Stamp shape'}
            value={shape}
            onChange={(e) => patch({ stampShape: e.target.value as StampShape })}
          >
            {stampShapes.map((s) => (
              <option key={s} value={s}>
                {stampShapeNames[s][lang]}
              </option>
            ))}
          </Select>
        </label>
        <label>
          {ar ? 'طريقة الختم' : 'Stamp finish'}
          <Select
            aria-label={ar ? 'طريقة الختم' : 'Stamp finish'}
            value={style}
            onChange={(e) => patch({ stampStyle: e.target.value as StampStyle })}
          >
            <option value="solid">{ar ? 'ممتلئ' : 'Solid'}</option>
            <option value="outline">{ar ? 'محدد' : 'Outline'}</option>
          </Select>
        </label>
      </div>
      <fieldset className="stamp-symbol-picker">
        <legend>{ar ? 'رمز الختم' : 'Stamp symbol'}</legend>
        <div className="stamp-symbol-options">
          {stampIcons.map((s) => (
            <button
              type="button"
              key={s}
              aria-label={stampIconNames[s][lang]}
              aria-pressed={s === symbol}
              onClick={() => patch({ stampIcon: s })}
            >
              <StampSymbol symbol={s} className="symbol-option" />
              <span>{stampIconNames[s][lang]}</span>
            </button>
          ))}
        </div>
      </fieldset>
      <p className="muted">
        {ar
          ? 'اللون من اللون الثانوي للهوية. تغيير الشكل بيغيّر التصميم بس؛ أختام العميل ومكافآته محفوظة.'
          : 'Stamps use the brand accent color. Design changes preserve customer stamps and rewards.'}
      </p>
    </section>
  );
}
