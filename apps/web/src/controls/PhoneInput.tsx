import { useId, type InputHTMLAttributes } from 'react';
export function PhoneInput({
  lang,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'dir' | 'placeholder'> & {
  lang: 'ar' | 'en';
  'aria-label': string;
}) {
  const hint = useId();
  return (
    <>
      <input
        {...props}
        type="tel"
        dir="ltr"
        inputMode="tel"
        autoComplete="tel"
        placeholder="01012345678"
        className={'nq-phone-input ' + (props.className || '')}
        aria-describedby={[props['aria-describedby'], hint].filter(Boolean).join(' ')}
      />
      <small className="phone-format-hint" id={hint} dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        {lang === 'ar' ? 'مثال: ' : 'Example: '}
        <bdi dir="ltr">01012345678</bdi>
        {lang === 'ar' ? ' أو دولي: ' : ' or international: '}
        <bdi dir="ltr">+201012345678</bdi>
      </small>
    </>
  );
}
