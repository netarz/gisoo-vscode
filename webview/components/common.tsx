import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { t } from '../strings';
import { dispatch, useAppState } from '../store';

export function Icon({ name, spin, class: cls }: { name: string; spin?: boolean; class?: string }): JSX.Element {
  return <span class={`codicon codicon-${name}${spin ? ' codicon-modifier-spin' : ''}${cls ? ` ${cls}` : ''}`} aria-hidden="true" />;
}

export interface IconButtonProps {
  icon: string;
  label: string;
  onClick?: (event: MouseEvent) => void;
  class?: string;
  disabled?: boolean;
  active?: boolean;
  spin?: boolean;
  children?: ComponentChildren;
}

/** A compact toolbar button: icon only, or icon + short text. Always labelled for screen readers. */
export function IconButton({ icon, label, onClick, class: cls, disabled, active, spin, children }: IconButtonProps): JSX.Element {
  return (
    <button
      type="button"
      class={`icon-btn${children ? ' icon-btn-text' : ''}${active ? ' is-active' : ''}${cls ? ` ${cls}` : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} spin={spin} />
      {children ? <span class="icon-btn-label">{children}</span> : null}
    </button>
  );
}

export function Button({
  kind = 'secondary', onClick, children, disabled, title, class: cls, icon,
}: {
  kind?: 'primary' | 'secondary' | 'danger' | 'ghost';
  onClick?: () => void;
  children: ComponentChildren;
  disabled?: boolean;
  title?: string;
  class?: string;
  icon?: string;
}): JSX.Element {
  return (
    <button type="button" class={`btn btn-${kind}${cls ? ` ${cls}` : ''}`} onClick={onClick} disabled={disabled} title={title}>
      {icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}

/**
 * A panel below the header (or anchored at the bottom for `place="bottom"`) with a click-away
 * backdrop. Escape closes; focus moves inside on open and returns to the opener on close.
 */
export function Overlay({
  title, onClose, children, class: cls, place = 'top', initialFocus = true,
}: {
  title?: string;
  onClose: () => void;
  children: ComponentChildren;
  class?: string;
  place?: 'top' | 'bottom';
  initialFocus?: boolean;
}): JSX.Element {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    if (initialFocus) {
      const first = panel.current?.querySelector<HTMLElement>('input, button, [tabindex="0"]');
      first?.focus();
    }
    return () => {
      opener?.focus?.();
    };
  }, [initialFocus]);
  const onKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
    }
  };
  return (
    <div class={`overlay overlay-${place}`} onKeyDown={onKey}>
      <div class="overlay-backdrop" onClick={onClose} />
      <div class={`overlay-panel${cls ? ` ${cls}` : ''}`} role="dialog" aria-label={title} ref={panel}>
        {title ? (
          <div class="overlay-head">
            <span class="overlay-title">{title}</span>
            <IconButton icon="close" label={t('common.close')} onClick={onClose} />
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

/** Keyboard navigation for a vertical list of options: returns a key handler and clamps the index. */
export function listKeyHandler(
  count: number,
  index: number,
  setIndex: (i: number) => void,
  onPick: (i: number) => void,
  onClose?: () => void,
): (event: KeyboardEvent) => void {
  return (event) => {
    if (count === 0) {
      if (event.key === 'Escape' && onClose) {
        event.preventDefault();
        onClose();
      }
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setIndex((index + 1) % count);
        break;
      case 'ArrowUp':
        event.preventDefault();
        setIndex((index - 1 + count) % count);
        break;
      case 'Home':
        event.preventDefault();
        setIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setIndex(count - 1);
        break;
      case 'Enter':
      case 'Tab':
        event.preventDefault();
        onPick(index);
        break;
      case 'Escape':
        if (onClose) {
          event.preventDefault();
          onClose();
        }
        break;
      default:
        break;
    }
  };
}

export function Toasts(): JSX.Element | null {
  const { toasts } = useAppState();
  useEffect(() => {
    if (!toasts.length) {
      return;
    }
    const toast = toasts[0];
    const timer = setTimeout(() => dispatch({ type: 'ui.toast.dismiss', id: toast.id }), toast.level === 'error' ? 8000 : 4000);
    return () => clearTimeout(timer);
  }, [toasts]);
  if (!toasts.length) {
    return null;
  }
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div class={`toast toast-${toast.level}`} key={toast.id} dir="auto">
          <Icon name={toast.level === 'error' ? 'error' : toast.level === 'warning' ? 'warning' : 'info'} />
          <span class="toast-text">{toast.text}</span>
          <IconButton icon="close" label={t('toast.close')} onClick={() => dispatch({ type: 'ui.toast.dismiss', id: toast.id })} />
        </div>
      ))}
    </div>
  );
}

/** Scrolls the element into view when `active` becomes true (for keyboard-navigated lists). */
export function useScrollIntoView<T extends HTMLElement>(active: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (active) {
      ref.current?.scrollIntoView({ block: 'nearest' });
    }
  }, [active]);
  return ref;
}
