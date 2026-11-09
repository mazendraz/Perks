import {
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type RefObject,
  type HTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';

export function isControlPopupTarget(owner: string | undefined, target: EventTarget | null) {
  return (
    !!owner &&
    target instanceof Element &&
    target.closest<HTMLElement>('[data-popup-owner]')?.dataset.popupOwner === owner
  );
}

export function ControlPopup({
  anchor,
  onClose,
  minWidth = 180,
  className = '',
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & {
  anchor: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  minWidth?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const nativePopover = typeof HTMLElement.prototype.showPopover === 'function';
  const [position, setPosition] = useState({ left: 0, top: 0, width: minWidth, maxHeight: 320 });
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const popup = ref.current,
      trigger = anchor.current;
    if (!popup || !trigger) return;
    popup.showPopover?.();
    const place = () => {
      const rect = trigger.getBoundingClientRect(),
        width = Math.min(Math.max(rect.width, minWidth), innerWidth - 24);
      const below = innerHeight - rect.bottom - 20,
        above = rect.top - 20;
      const flipped = below < Math.min(popup.scrollHeight, 240) && above > below;
      const maxHeight = Math.max(80, Math.min(340, flipped ? above : below));
      const height = Math.min(popup.scrollHeight, maxHeight);
      setPosition({
        left: Math.max(
          12,
          Math.min(
            document.documentElement.dir === 'rtl' ? rect.right - width : rect.left,
            innerWidth - width - 12,
          ),
        ),
        top: flipped ? Math.max(12, rect.top - height - 8) : rect.bottom + 8,
        width,
        maxHeight,
      });
    };
    place();
    const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    resize?.observe(trigger);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      resize?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchor, minWidth]);
  useEffect(() => {
    const id = anchor.current?.id;
    const outside = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node))
        close.current();
    };
    const other = (e: Event) => {
      if ((e as CustomEvent).detail !== id) close.current();
    };
    window.dispatchEvent(new CustomEvent('nuqta:open-control', { detail: id }));
    document.addEventListener('pointerdown', outside);
    window.addEventListener('nuqta:open-control', other);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('nuqta:open-control', other);
    };
  }, [anchor]);
  const content = (
    <div
      {...props}
      ref={ref}
      popover={nativePopover ? 'manual' : undefined}
      data-popup-owner={anchor.current?.id}
      className={'nq-popup ' + className}
      style={position}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          close.current();
          anchor.current?.focus();
        }
      }}
    >
      {children}
    </div>
  );
  return nativePopover ? content : createPortal(content, document.body);
}
