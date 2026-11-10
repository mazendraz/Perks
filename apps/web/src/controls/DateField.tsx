import { useId } from 'react';
import type { Language } from '../../../../packages/contracts/src/index.js';
import { Select } from './Select.js';
export function DateField({
  label,
  value,
  onChange,
  lang,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  lang: Language;
  disabled?: boolean;
}) {
  const id = useId(),
    ar = lang === 'ar',
    [year, month, day] = value.split('-').map(Number),
    current = new Date().getFullYear();
  const y = year || current,
    m = month || 1,
    d = day || 1,
    days = new Date(y, m, 0).getDate();
  const change = (nextY: number, nextM: number, nextD: number) => {
    const capped = Math.min(nextD, new Date(nextY, nextM, 0).getDate());
    onChange(
      [
        String(nextY).padStart(4, '0'),
        String(nextM).padStart(2, '0'),
        String(capped).padStart(2, '0'),
      ].join('-'),
    );
  };
  const first = Math.min(current - 3, y),
    last = Math.max(current + 5, y);
  return (
    <fieldset className="date-field" disabled={disabled}>
      <legend>{label}</legend>
      <div className="date-parts">
        <label htmlFor={id + '-day'}>
          <span>{ar ? 'اليوم' : 'Day'}</span>
          <Select
            id={id + '-day'}
            aria-label={label + (ar ? ' · اليوم' : ' · Day')}
            value={String(d)}
            onChange={(e) => change(y, m, Number(e.target.value))}
          >
            {Array.from({ length: days }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </Select>
        </label>
        <label htmlFor={id + '-month'}>
          <span>{ar ? 'الشهر' : 'Month'}</span>
          <Select
            id={id + '-month'}
            aria-label={label + (ar ? ' · الشهر' : ' · Month')}
            value={String(m)}
            onChange={(e) => change(y, Number(e.target.value), d)}
          >
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {new Intl.DateTimeFormat(ar ? 'ar-EG' : 'en', { month: 'short' }).format(
                  new Date(2024, i, 1),
                )}
              </option>
            ))}
          </Select>
        </label>
        <label htmlFor={id + '-year'}>
          <span>{ar ? 'السنة' : 'Year'}</span>
          <Select
            id={id + '-year'}
            aria-label={label + (ar ? ' · السنة' : ' · Year')}
            value={String(y)}
            onChange={(e) => change(Number(e.target.value), m, d)}
          >
            {Array.from({ length: last - first + 1 }, (_, i) => (
              <option key={first + i} value={first + i}>
                {first + i}
              </option>
            ))}
          </Select>
        </label>
      </div>
    </fieldset>
  );
}
