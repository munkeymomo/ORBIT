import { useOrbit } from '../../store/store';
import { useOfferedVerses } from '../host/Wormholes';
import { cx } from '../ui/primitives';

/**
 * The verse switcher (hosted, and only when the host offers more than one verse): each verse's name with its plain
 * word under it, the one-line legend of the verse on screen, and the verse's own actions (the host's dialogs).
 * Switching keeps the camera on the same galaxy: the galaxy the person is in is the galaxy's wormhole.
 */
export function VerseBar({ ctxGalaxy, compact = false }: { ctxGalaxy: string | null; compact?: boolean }) {
  const verses = useOfferedVerses();
  const shown = useOrbit((s) => s.host?.shown ?? '');
  const { showVerse, hostAction } = useOrbit.getActions();
  if (verses.size < 2) return null;
  const list = [...verses.values()];
  const current = verses.get(shown);
  const actions = current?.actions ?? [];
  return (
    <div className="pointer-events-none flex flex-wrap items-center justify-center gap-2">
      <div role="group" aria-label="Views of the same records" className="pointer-events-auto flex items-stretch gap-0.5 rounded-xl border border-line bg-surface/80 p-1 shadow-panel backdrop-blur-xl">
        {list.map((v) => {
          const on = v.id === shown;
          return (
            <button
              key={v.id}
              data-verse={v.id}
              aria-pressed={on}
              title={`${v.name}: ${v.legend}`}
              onClick={() => !on && void showVerse(v.id, ctxGalaxy ? { galaxy: ctxGalaxy } : undefined)}
              className={cx(
                'flex min-w-[78px] flex-col items-center justify-center rounded-lg px-3 py-1 leading-tight transition-colors',
                on ? 'bg-[#b18cff]/20 text-text ring-1 ring-[#b18cff]/70' : 'text-muted hover:bg-surface-3 hover:text-text',
              )}
            >
              <span className="text-[13px] font-semibold">{v.name}</span>
              <span className={cx('text-[11px]', on ? 'text-[#d9c8ff]' : 'text-faint')}>{v.plain}</span>
            </button>
          );
        })}
      </div>
      {current && !compact && (
        <p className="pointer-events-auto max-w-[460px] truncate rounded-lg bg-surface/70 px-2.5 py-1 text-[12px] text-muted backdrop-blur-xl" title={current.legend}>
          {current.legend}
        </p>
      )}
      {actions.map((a) => (
        <button
          key={a.id}
          data-verse-action={a.id}
          onClick={() => void hostAction(a.id, { verse: shown, ...(ctxGalaxy ? { galaxy: ctxGalaxy } : {}) })}
          className="pointer-events-auto inline-flex h-9 items-center rounded-xl border border-line bg-surface/80 px-3 text-[13px] font-medium text-text shadow-panel backdrop-blur-xl hover:border-accent"
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
