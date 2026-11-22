import { useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon } from '../../../../packages/ui/src/Icon.js';

/**
 * A labelled password input with a show/hide (eye) button. Every secret field in the app uses
 * this so people can always check what they typed. The eye sits in its own grid column
 * (see `.password-control` in design.css) so it never covers text in RTL or LTR.
 */
export function PasswordField({
  label,
  lang,
  hint,
  className,
  ...input
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string;
  lang: 'ar' | 'en';
  /** Helper text shown under the field, inside the label. */
  hint?: ReactNode;
}) {
  const ar = lang === 'ar',
    [visible, setVisible] = useState(false),
    name = ar ? label : label.toLowerCase();
  return (
    <label className={className}>
      {label}
      <span className="password-control">
        <input
          aria-label={label}
          dir="ltr"
          maxLength={128}
          {...input}
          type={visible ? 'text' : 'password'}
        />
        <button
          type="button"
          className="password-reveal"
          aria-label={(ar ? (visible ? 'إخفاء ' : 'إظهار ') : visible ? 'Hide ' : 'Show ') + name}
          onClick={() => setVisible(!visible)}
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} size={19} />
        </button>
      </span>
      {hint}
    </label>
  );
}
