import { useEffect } from 'react';
import { CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { useOrbit, type Toast } from '../../store/store';
import { cx } from '../ui/primitives';

function ToastItem({ t }: { t: Toast }) {
  const dismiss = useOrbit((s) => s.dismissToast);
  useEffect(() => {
    const id = setTimeout(() => dismiss(t.id), t.timeout ?? 5000);
    return () => clearTimeout(id);
  }, [t.id, t.timeout, dismiss]);
  const Icon = t.tone === 'danger' ? TriangleAlert : t.tone === 'success' ? CircleCheck : Info;
  return (
    <div
      role={t.tone === 'danger' ? 'alert' : 'status'}
      className="anim-pop pointer-events-auto flex max-w-[min(92vw,460px)] items-center gap-3 rounded-2xl border border-line-strong bg-raised py-2.5 pr-2 pl-3.5 text-sm shadow-panel"
    >
      <Icon size={18} className={cx('shrink-0', t.tone === 'danger' ? 'text-danger' : t.tone === 'success' ? 'text-teal' : 'text-accent-ink')} />
      <span className="flex-1 leading-snug">{t.text}</span>
      {t.action && (
        <button
          onClick={() => {
            t.action!.run();
            dismiss(t.id);
          }}
          className="shrink-0 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-accent-ink hover:bg-accent-soft"
        >
          {t.action.label}
        </button>
      )}
      <button onClick={() => dismiss(t.id)} className="shrink-0 rounded-lg p-1.5 text-faint hover:bg-surface-3 hover:text-text" aria-label="Dismiss">
        <X size={15} />
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useOrbit((s) => s.toasts);
  return (
    <div aria-live="polite" className="pointer-events-none absolute inset-x-0 bottom-[148px] z-40 flex flex-col items-center gap-2 px-3 md:bottom-[92px]">
      {toasts.map((t) => (
        <ToastItem key={t.id} t={t} />
      ))}
    </div>
  );
}
