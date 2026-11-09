import { useId, useRef, useState, useEffect, useContext } from 'react';
import { ControlLocale } from './locale.js';
import { ControlPopup, isControlPopupTarget } from './ControlPopup.js';
import { hexToHsv, hsvToHex } from './color.js';
export function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId(),
    button = useRef<HTMLButtonElement>(null),
    ar = useContext(ControlLocale) === 'ar';
  const [open, setOpen] = useState(false),
    [hsv, setHsv] = useState(() => hexToHsv(value));
  useEffect(() => {
    setHsv((current) =>
      hsvToHex(current).toUpperCase() === value.toUpperCase() ? current : hexToHsv(value),
    );
  }, [value]);
  const change = (part: Partial<typeof hsv>) => {
    const next = { ...hsv, ...part };
    setHsv(next);
    onChange(hsvToHex(next));
  };
  return (
    <span
      className="nq-color"
      data-control
      data-open={open}
      onBlur={(e) => {
        if (
          !e.currentTarget.contains(e.relatedTarget) &&
          !isControlPopupTarget(button.current?.id, e.relatedTarget)
        )
          setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(false);
          button.current?.focus();
        }
      }}
    >
      <button
        id={'color-' + id}
        ref={button}
        type="button"
        className="nq-color-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? 'palette-' + id : undefined}
        onClick={() => setOpen(!open)}
        style={{ backgroundColor: value }}
      >
        <span aria-hidden="true" />
      </button>
      {open && (
        <ControlPopup
          anchor={button}
          onClose={() => setOpen(false)}
          minWidth={286}
          id={'palette-' + id}
          className="nq-color-panel"
          role="group"
          aria-label={ar ? 'اختيار اللون' : 'Choose color'}
        >
          <div className="nq-color-heading">
            <strong>{ar ? 'اختار درجة اللون' : 'Find your color'}</strong>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setOpen(false);
                button.current?.focus();
              }}
            >
              {ar ? 'تم' : 'Done'}
            </button>
          </div>
          <div
            className="nq-color-gradient"
            aria-hidden="true"
            style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
          />
          {(['h', 's', 'v'] as const).map((part, index) => (
            <label key={part} className="nq-color-slider">
              <span>
                {
                  (ar ? ['الدرجة', 'التشبع', 'الإضاءة'] : ['Hue', 'Saturation', 'Brightness'])[
                    index
                  ]
                }
                <bdi>
                  {Math.round(hsv[part])}
                  {part === 'h' ? '°' : '%'}
                </bdi>
              </span>
              <input
                type="range"
                min={0}
                max={part === 'h' ? 359 : 100}
                step={1}
                value={hsv[part]}
                aria-label={label + ' ' + ['hue', 'saturation', 'brightness'][index]}
                onChange={(e) => change({ [part]: Number(e.target.value) })}
              />
            </label>
          ))}
          <div className="nq-color-swatches">
            {[
              '#204C41',
              '#D4AD68',
              '#F9F5EA',
              '#33251D',
              '#C27854',
              '#161D26',
              '#FFFFFF',
              '#000000',
            ].map((color) => (
              <button
                type="button"
                key={color}
                style={{ backgroundColor: color }}
                aria-label={color}
                aria-pressed={value.toUpperCase() === color}
                onClick={() => {
                  setHsv(hexToHsv(color));
                  onChange(color);
                }}
              />
            ))}
          </div>
          <bdi className="nq-color-value">{value.toUpperCase()}</bdi>
        </ControlPopup>
      )}
    </span>
  );
}
