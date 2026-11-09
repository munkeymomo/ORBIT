import { useMemo, useState } from 'react';
import { CornerDownLeft, Search } from 'lucide-react';
import { useOrbit } from '../../store/store';
import { Modal, cx } from '../ui/primitives';
import { ProjectChip } from '../ui/visuals';
import { colorHex } from '../../lib/colors';

type Result = { kind: 'project' | 'task'; id: string; title: string; sub: string; color: string; icon: string; done?: boolean };

export function SearchPalette() {
  const open = useOrbit((s) => s.searchOpen);
  const setOpen = useOrbit((s) => s.setSearchOpen);
  return open ? <Palette onClose={() => setOpen(false)} /> : null;
}

function Palette({ onClose }: { onClose: () => void }) {
  const projects = useOrbit((s) => s.projects);
  const tasks = useOrbit((s) => s.tasks);
  const select = useOrbit((s) => s.select);
  const toggleExpanded = useOrbit((s) => s.toggleExpanded);
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);

  const results = useMemo<Result[]>(() => {
    const query = q.trim().toLowerCase();
    const pById = new Map(projects.map((p) => [p.id, p]));
    const score = (text: string) => {
      const t = text.toLowerCase();
      if (!query) return 1;
      if (t.startsWith(query)) return 3;
      if (t.includes(` ${query}`)) return 2;
      return t.includes(query) ? 1 : 0;
    };
    const ps: (Result & { s: number })[] = projects
      .map((p) => ({ kind: 'project' as const, id: p.id, title: p.name, sub: 'Project', color: p.color, icon: p.icon, s: score(p.name) + 0.5 }))
      .filter((r) => r.s > 0.5);
    const ts: (Result & { s: number })[] = tasks
      .map((t) => {
        const p = pById.get(t.projectId);
        const s = Math.max(score(t.title), query && t.notes.toLowerCase().includes(query) ? 0.8 : 0);
        return {
          kind: 'task' as const,
          id: t.id,
          title: t.title,
          sub: `${p?.name ?? 'Project'}${t.status === 'parked' ? ' · parked' : t.status === 'done' ? ' · done' : ''}`,
          color: p?.color ?? 'violet',
          icon: p?.icon ?? 'orbit',
          done: t.status === 'done',
          s: s - (t.status === 'done' ? 0.4 : 0) + (t.status === 'parked' ? 0.2 : 0),
        };
      })
      .filter((r) => r.s > 0);
    return [...ps, ...ts].sort((a, b) => b.s - a.s).slice(0, query ? 30 : 12);
  }, [q, projects, tasks]);

  const go = (r: Result | undefined) => {
    if (!r) return;
    const projectId = r.kind === 'task' ? tasks.find((x) => x.id === r.id)?.projectId : r.id;
    if (projectId) {
      toggleExpanded(projectId, true);
      // In the Universe, fly to the system that holds it.
      if (useOrbit.getActions().view === 'universe') useOrbit.getActions().requestFlight('system', projectId);
    }
    select({ type: r.kind, id: r.id });
    onClose();
  };

  return (
    <Modal open onClose={onClose} title="Search" width="max-w-xl" hideTitle>
      <div className="-mx-5 -mt-3 border-b border-line px-5 pb-3">
        <div className="flex items-center gap-2.5">
          <Search size={18} className="text-faint" />
          <input
            data-autofocus
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setI(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setI((x) => Math.min(results.length - 1, x + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setI((x) => Math.max(0, x - 1));
              } else if (e.key === 'Enter') {
                e.preventDefault();
                go(results[i]);
              }
            }}
            placeholder="Search projects and tasks…"
            aria-label="Search projects and tasks"
            className="h-11 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
          />
        </div>
      </div>
      <ul role="listbox" aria-label="Results" className="-mx-2 mt-2 max-h-[50vh] overflow-y-auto">
        {results.length === 0 && <li className="px-3 py-8 text-center text-sm text-muted">{q ? 'Nothing matches.' : 'No projects yet.'}</li>}
        {results.map((r, idx) => (
          <li key={r.kind + r.id} role="option" aria-selected={idx === i}>
            <button
              onMouseEnter={() => setI(idx)}
              onClick={() => go(r)}
              className={cx('flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left', idx === i && 'bg-surface-3')}
            >
              {r.kind === 'project' ? (
                <ProjectChip color={r.color} icon={r.icon} size={28} />
              ) : (
                <span className="flex h-7 w-7 items-center justify-center">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorHex(r.color), opacity: r.done ? 0.4 : 1 }} />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className={cx('block truncate text-sm font-medium', r.done && 'text-muted line-through')}>{r.title}</span>
                <span className="block truncate text-xs text-muted">{r.sub}</span>
              </span>
              {idx === i && <CornerDownLeft size={15} className="text-faint" />}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
