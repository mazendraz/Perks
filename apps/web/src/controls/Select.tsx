import {
  Children,
  isValidElement,
  Fragment,
  useId,
  useRef,
  useState,
  useEffect,
  useContext,
  type ReactNode,
  type OptionHTMLAttributes,
  type AriaAttributes,
} from 'react';
import { Icon } from '../../../../packages/ui/src/Icon.js';
import { ControlPopup, isControlPopupTarget } from './ControlPopup.js';
import { ControlLocale } from './locale.js';

type Choice = { value: string; label: string; disabled: boolean };
const text = (node: ReactNode): string =>
  Children.toArray(node)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : String(child),
    )
    .join('');
function choices(children: ReactNode): Choice[] {
  return Children.toArray(children).flatMap((child) => {
    if (!isValidElement<OptionHTMLAttributes<HTMLOptionElement>>(child)) return [];
    if (child.type === Fragment) return choices(child.props.children);
    const label = text(child.props.children);
    return [{ value: String(child.props.value ?? label), label, disabled: !!child.props.disabled }];
  });
}
export function Select({
  children,
  value,
  onChange,
  disabled,
  className = '',
  id: suppliedId,
  name,
  required,
  ...aria
}: AriaAttributes & {
  children: ReactNode;
  value?: string | number;
  onChange: (e: { target: { value: string } }) => void;
  disabled?: boolean;
  className?: string;
  id?: string;
  name?: string;
  required?: boolean;
}) {
  const generatedId = useId(),
    id = suppliedId || 'select-' + generatedId;
  const lang = useContext(ControlLocale);
  const button = useRef<HTMLButtonElement>(null),
    list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false),
    [active, setActive] = useState(0);
  const search = useRef({ text: '', at: 0 });
  const options = choices(children),
    selected = options.findIndex((o) => o.value === String(value));
  const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
  const unavailable = disabled || !enabled.length;
  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);
  useEffect(() => {
    const menu = list.current,
      item = menu?.querySelector<HTMLElement>('[data-index="' + active + '"]');
    if (menu && item) {
      if (item.offsetTop < menu.scrollTop) menu.scrollTop = item.offsetTop;
      else if (item.offsetTop + item.offsetHeight > menu.scrollTop + menu.clientHeight)
        menu.scrollTop = item.offsetTop + item.offsetHeight - menu.clientHeight;
    }
  }, [active, open]);
  const show = () => {
    setActive(enabled.includes(selected) ? selected : (enabled[0] ?? 0));
    setOpen(true);
  };
  const choose = (index: number) => {
    const item = options[index];
    if (!item || item.disabled) return;
    onChange({ target: { value: item.value } });
    setOpen(false);
    button.current?.focus();
  };
  return (
    <span
      className={'nq-select ' + className}
      data-control
      data-open={open}
      onBlur={(e) => {
        if (
          !e.currentTarget.contains(e.relatedTarget) &&
          !isControlPopupTarget(id, e.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <button
        {...aria}
        id={id}
        ref={button}
        name={name}
        type="button"
        role="combobox"
        className="nq-select-trigger"
        disabled={unavailable}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id + '-list' : undefined}
        aria-activedescendant={open ? id + '-option-' + active : undefined}
        aria-required={required || undefined}
        data-value={value}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            setOpen(false);
            return;
          }
          if (e.key === 'Escape' && open) {
            e.preventDefault();
            e.stopPropagation();
            setOpen(false);
            return;
          }
          if (['Enter', ' '].includes(e.key)) {
            e.preventDefault();
            if (open) choose(active);
            else show();
            return;
          }
          if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            if (!open) {
              show();
              if (e.key === 'End') setActive(enabled.at(-1) ?? 0);
              return;
            }
            const index = enabled.indexOf(active);
            setActive(
              e.key === 'Home'
                ? (enabled[0] ?? 0)
                : e.key === 'End'
                  ? (enabled.at(-1) ?? 0)
                  : (enabled[
                      Math.max(
                        0,
                        Math.min(enabled.length - 1, index + (e.key === 'ArrowDown' ? 1 : -1)),
                      )
                    ] ?? 0),
            );
            return;
          }
          if (e.key.length === 1 && !e.altKey && !e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            const now = Date.now(),
              previous = now - search.current.at < 700 ? search.current.text : '';
            const query = previous + e.key.toLocaleLowerCase();
            search.current = { text: query, at: now };
            const match = enabled.find((i) =>
              options[i]!.label.toLocaleLowerCase().startsWith(query),
            );
            if (match !== undefined) {
              if (!open) setOpen(true);
              setActive(match);
            }
          }
        }}
      >
        <span>
          {options[selected]?.label ||
            (value === undefined ? options[0]?.label : lang === 'ar' ? 'اختار…' : 'Choose…')}
        </span>
        <Icon name="chevronDown" size={17} />
      </button>
      {open && (
        <ControlPopup
          anchor={button}
          onClose={() => setOpen(false)}
          id={id + '-list'}
          role="listbox"
          aria-labelledby={id}
          className="nq-select-menu"
        >
          <div ref={list} className="nq-select-options">
            {options.map((o, i) => (
              <div
                key={o.value}
                id={id + '-option-' + i}
                role="option"
                aria-selected={i === selected}
                aria-disabled={o.disabled || undefined}
                data-value={o.value}
                data-index={i}
                className={'nq-option' + (i === active ? ' is-active' : '')}
                onPointerMove={() => {
                  if (!o.disabled) setActive(i);
                }}
                onPointerDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  choose(i);
                }}
              >
                <span>{o.label}</span>
                {i === selected && <Icon name="check" size={17} />}
              </div>
            ))}
          </div>
        </ControlPopup>
      )}
    </span>
  );
}
