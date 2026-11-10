import {
  forwardRef,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useIsPhone } from '../../lib/hooks';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

/* ---------------- Buttons ---------------- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'teal' | 'amber';
type Size = 'sm' | 'md' | 'lg';

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:brightness-110 shadow-[0_6px_20px_-8px_var(--accent)]',
  secondary: 'bg-surface-2 text-text border border-line hover:bg-surface-3 hover:border-line-strong',
  ghost: 'text-muted hover:text-text hover:bg-surface-2',
  danger: 'bg-danger-soft text-danger hover:bg-danger hover:text-white',
  teal: 'bg-teal text-[#04201c] hover:brightness-110 shadow-[0_6px_20px_-8px_var(--teal)]',
  amber: 'bg-amber-soft text-amber hover:bg-amber hover:text-[#2a1a00]',
};
const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-[13px] gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-[15px] gap-2 rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: ReactNode }>(
  function Button({ variant = 'secondary', size = 'md', icon, className, children, type = 'button', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        className={cx(
          'inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-[background,filter,color,border] duration-150 select-none disabled:pointer-events-none disabled:opacity-45',
          variants[variant],
          sizes[size],
          className,
        )}
        {...rest}
      >
        {icon}
        {children}
      </button>
    );
  },
);

export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: Variant; size?: Size | 'xs'; active?: boolean }
>(function IconButton({ label, variant = 'ghost', size = 'md', active, className, children, type = 'button', ...rest }, ref) {
  const dim = size === 'xs' ? 'h-7 w-7 rounded-md' : size === 'sm' ? 'h-8 w-8 rounded-lg' : size === 'lg' ? 'h-12 w-12 rounded-xl' : 'h-10 w-10 rounded-xl';
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center transition-colors duration-150 disabled:pointer-events-none disabled:opacity-40',
        variants[variant],
        dim,
        active && 'bg-accent-soft text-accent-ink',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

/* ---------------- Form fields ---------------- */

const fieldBase =
  'w-full rounded-xl border border-line bg-surface-2 px-3 text-sm text-text placeholder:text-faint outline-none transition-colors focus:border-accent focus:bg-surface';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(fieldBase, 'h-10', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...rest }, ref) {
  return <textarea ref={ref} className={cx(fieldBase, 'min-h-[76px] resize-y py-2.5 leading-relaxed', className)} {...rest} />;
});

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(fieldBase, 'h-10 appearance-none bg-[length:12px] bg-[right_12px_center] bg-no-repeat pr-8', className)} style={{ backgroundImage: CHEVRON }} {...rest}>
      {children}
    </select>
  );
}
const CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23959cb0' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`;

/**
 * A labelled field. Wraps a single control in <label>; pass `group` when the
 * content is several controls (segmented buttons, input + button) so the label
 * names the group instead of leaking into each button's accessible name.
 */
export function Field({ label, hint, children, className, group }: { label: string; hint?: ReactNode; children: ReactNode; className?: string; group?: boolean }) {
  const id = useId();
  if (group)
    return (
      <div role="group" aria-labelledby={id} className={cx('block', className)}>
        <span id={id} className="mb-1.5 block text-xs font-medium tracking-wide text-muted">
          {label}
        </span>
        {children}
        {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
      </div>
    );
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-xs font-medium tracking-wide text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

/** Segmented control */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = 'md',
  label,
  className,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex rounded-xl border border-line bg-surface-2 p-0.5', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex items-center justify-center gap-1.5 rounded-[10px] font-medium transition-colors',
            size === 'sm' ? 'h-7 px-2.5 text-xs' : 'h-9 px-3 text-sm',
            o.value === value ? 'bg-raised text-text shadow-sm ring-1 ring-line-strong' : 'text-muted hover:text-text',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start justify-between gap-4 py-2">
      <div>
        <label htmlFor={id} className="text-sm font-medium text-text">
          {label}
        </label>
        {description && <div className="mt-0.5 text-xs text-muted">{description}</div>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-surface-3 ring-1 ring-line-strong')}
      >
        <span className={cx('absolute top-0.5 left-0 h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </button>
    </div>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line-strong bg-surface-2 px-1 font-sans text-[11px] font-medium text-muted">{children}</kbd>;
}

/* ---------------- Modal / bottom sheet ---------------- */

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  width = 'max-w-lg',
  labelledBy,
  initialFocus,
  hideTitle,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
  labelledBy?: string;
  initialFocus?: React.RefObject<HTMLElement | null>;
  hideTitle?: boolean;
}) {
  const phone = useIsPhone();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const restore = useRef<HTMLElement | null>(null);

  useLayoutEffect(() => {
    if (!open) return;
    restore.current = document.activeElement as HTMLElement | null;
    // Focus synchronously so keystrokes typed straight after a shortcut are not lost.
    const pick = () => initialFocus?.current ?? ref.current?.querySelector<HTMLElement>('[data-autofocus], input, textarea, button:not([data-close])');
    pick()?.focus();
    const t = setTimeout(() => {
      if (!ref.current?.contains(document.activeElement)) pick()?.focus();
    }, 30);
    return () => {
      clearTimeout(t);
      restore.current?.focus?.();
    };
  }, [open, initialFocus]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
      if (e.key === 'Tab' && ref.current) {
        const f = [...ref.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
          (x) => !x.hasAttribute('disabled') && x.offsetParent !== null,
        );
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div className={cx('fixed inset-0 z-50 flex', phone ? 'items-end' : 'items-start justify-center pt-[12vh]')}>
      <div className="anim-fade absolute inset-0 bg-black/55 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy ?? titleId}
        className={cx(
          'relative flex max-h-[88vh] w-full flex-col border border-line-strong bg-surface shadow-panel',
          phone ? 'anim-sheet safe-bottom rounded-t-3xl' : cx('anim-pop rounded-2xl', width),
        )}
      >
        {phone && <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-line-strong" aria-hidden />}
        <div className={cx('flex items-center justify-between gap-3 px-5 pt-4', hideTitle && 'sr-only')}>
          <h2 id={titleId} className="font-display text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <IconButton label="Close" size="sm" onClick={onClose} data-close>
            <X size={18} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pt-3 pb-5">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ---------------- Popover menu ---------------- */

export interface MenuItem {
  label: string;
  /** The full words, when the label may be cut to fit. */
  title?: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function Menu({ trigger, items, align = 'right', label }: { trigger: (p: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode; items: (MenuItem | 'sep')[]; align?: 'left' | 'right'; label: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', key);
    setTimeout(() => box.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus(), 10);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const els = [...(box.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    els[(i + (e.key === 'ArrowDown' ? 1 : -1) + els.length) % els.length]?.focus();
  };
  return (
    <div ref={box} className="relative inline-flex">
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKey}
          className={cx('anim-pop absolute top-full z-40 mt-1.5 max-w-[min(360px,90vw)] min-w-[200px] rounded-xl border border-line-strong bg-raised p-1 shadow-panel', align === 'right' ? 'right-0' : 'left-0')}
        >
          {items.map((it, i) =>
            it === 'sep' ? (
              <div key={i} className="my-1 h-px bg-line" />
            ) : (
              <button
                key={i}
                role="menuitem"
                type="button"
                disabled={it.disabled}
                title={it.title}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
                className={cx(
                  'flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm outline-none focus:bg-surface-3 disabled:opacity-40',
                  it.danger ? 'text-danger hover:bg-danger-soft' : 'text-text hover:bg-surface-3',
                )}
              >
                <span className="flex w-4 shrink-0 justify-center text-muted">{it.icon}</span>
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Misc ---------------- */

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="anim-fade mx-auto flex max-w-sm flex-col items-center px-6 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink">{icon}</div>
      <h3 className="font-display text-lg font-semibold">{title}</h3>
      {children && <div className="mt-1.5 text-sm leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function SectionTitle({ children, right, className }: { children: ReactNode; right?: ReactNode; className?: string }) {
  return (
    <div className={cx('mb-2.5 flex items-center justify-between gap-2', className)}>
      <h3 className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">{children}</h3>
      {right}
    </div>
  );
}
