import { useState, useContext, type InputHTMLAttributes } from 'react';
import { ControlLocale } from './locale.js';
import { Icon } from '../../../../packages/ui/src/Icon.js';
export function FileUpload({
  onChange,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [filename, setFilename] = useState('');
  const ar = useContext(ControlLocale) === 'ar';
  return (
    <span className="nq-upload">
      <input
        {...props}
        type="file"
        onChange={(e) => {
          setFilename(e.target.files?.[0]?.name || '');
          onChange?.(e);
        }}
      />
      <span className="nq-upload-action" aria-hidden="true">
        <Icon name="upload" size={19} />
        {ar ? 'اختار صورة' : 'Choose image'}
      </span>
      <span className="nq-upload-name" aria-hidden="true">
        {filename || (ar ? 'PNG، JPG أو WebP' : 'PNG, JPG or WebP')}
      </span>
    </span>
  );
}
