import { useState } from 'react';
import { ChevronDown, Lock, Pause, Plus, Search, X } from 'lucide-react';
import { useOrbit } from '../../store/store';
import { colorHex } from '../../lib/colors';
import { fmtMinutes, toDateKey } from '../../lib/util';
import { Button, cx } from '../ui/primitives';
import { DueBadge, EnergyIcon, PriorityBars, ProgressRing, ProjectGlyph } from '../ui/visuals';
import { filterActive, useUniverseModel, type ProjectView, type TaskView } from './model';

/** Phone Universe: cards with large touch targets instead of a spatial canvas. */
export function UniverseCards({ onNewProject }: { onNewProject: () => void }) {
  const model = useUniverseModel();
  const groups = useOrbit((s) => s.groups);
  const filter = useOrbit((s) => s.filter);
  const setFilter = useOrbit((s) => s.setFilter);
  const expanded = useOrbit((s) => s.expanded);
  const canCreate = useOrbit((s) => !s.host);
  const dim = filterActive(filter);
  const visible = dim ? model.filter((pv) => pv.matches) : model;

  const sections = [
    ...groups.map((g) => ({ id: g.id, name: g.name, color: g.color, items: visible.filter((pv) => pv.project.groupId === g.id) })),
    { id: 'none', name: groups.length ? 'Deep space' : '', color: '', items: visible.filter((pv) => !pv.project.groupId || !groups.some((g) => g.id === pv.project.groupId)) },
  ].filter((s) => s.items.length);

  const chips: [keyof typeof filter, string][] = [
    ['dueSoon', 'Due soon'],
    ['highPriority', 'High priority'],
    ['parkedOnly', 'Parked'],
    ['showDone', 'Show done'],
  ];

  return (
    <div className="h-full overflow-y-auto pb-6">
      <div className="sticky top-0 z-10 space-y-2.5 bg-bg/85 px-4 pt-3 pb-3 backdrop-blur-xl">
        <div className="flex gap-2">
          <div className="flex h-11 flex-1 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 focus-within:border-accent">
            <Search size={17} className="text-faint" />
            <input value={filter.query} onChange={(e) => setFilter({ query: e.target.value })} placeholder="Filter projects and tasks" aria-label="Filter" className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" />
            {filter.query && (
              <button onClick={() => setFilter({ query: '' })} aria-label="Clear" className="p-1 text-faint">
                <X size={16} />
              </button>
            )}
          </div>
          {canCreate && (
            <Button variant="primary" size="lg" className="!h-11 !px-3.5" onClick={onNewProject} aria-label="New project">
              <Plus size={20} />
            </Button>
          )}
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
          {chips.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setFilter({ [k]: !filter[k] })}
              aria-pressed={!!filter[k]}
              className={cx('h-9 shrink-0 rounded-full border px-3.5 text-[13px] font-medium', filter[k] ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-surface-2 text-muted')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 && <p className="px-6 py-12 text-center text-sm text-muted">Nothing matches this filter.</p>}

      <div className="space-y-6 px-4">
        {sections.map((sec) => (
          <section key={sec.id}>
            {sec.name && (
              <h2 className="mb-2.5 flex items-center gap-2 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
                {sec.color && <span className="h-2 w-2 rounded-full" style={{ background: colorHex(sec.color) }} />}
                {sec.name}
              </h2>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              {sec.items.map((pv) => (
                <ProjectCard key={pv.project.id} pv={pv} open={expanded.includes(pv.project.id) || (!!filter.query.trim() && pv.queryHit)} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ProjectCard({ pv, open }: { pv: ProjectView; open: boolean }) {
  const toggleExpanded = useOrbit((s) => s.toggleExpanded);
  const select = useOrbit((s) => s.select);
  const createTask = useOrbit((s) => s.createTask);
  const [title, setTitle] = useState('');
  const { project, stats } = pv;
  const hex = colorHex(project.color);
  const next = pv.tasks.find((t) => t.task.status !== 'done');

  return (
    <article className={cx('overflow-hidden rounded-2xl border bg-surface transition-colors', pv.hasActive ? 'border-teal/60' : 'border-line')} style={{ boxShadow: `inset 3px 0 0 ${hex}` }}>
      <button onClick={() => toggleExpanded(project.id)} aria-expanded={open} className="flex w-full items-center gap-3.5 p-4 text-left">
        <ProgressRing value={stats.progress} size={52} stroke={4.5} color={hex} label={`${Math.round(stats.progress * 100)}% complete`}>
          <span className="flex h-9 w-9 items-center justify-center rounded-full" style={{ background: `${hex}26`, color: hex }}>
            <ProjectGlyph icon={project.icon} size={18} />
          </span>
        </ProgressRing>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-display text-[16px] font-semibold">{project.name}</span>
          <span className="tabular mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-muted">
            <span>{stats.open} open</span>
            {stats.parked > 0 && (
              <span className="inline-flex items-center gap-0.5 text-amber">
                <Pause size={11} strokeWidth={3} />
                {stats.parked}
              </span>
            )}
            {stats.overdue > 0 && <span className="text-danger">{stats.overdue} overdue</span>}
            {stats.openEffortMin > 0 && <span>{fmtMinutes(stats.openEffortMin)} left</span>}
          </span>
          {!open && next && <span className="mt-1 block truncate text-[13px] text-text/80">Next: {next.task.title}</span>}
        </span>
        <ChevronDown size={20} className={cx('shrink-0 text-faint transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="border-t border-line">
          <ul>
            {pv.tasks.map((tv) => (
              <TaskRow key={tv.task.id} tv={tv} onOpen={() => select({ type: 'task', id: tv.task.id })} />
            ))}
          </ul>
          {pv.canAdd && <form
            className="flex items-center gap-2 border-t border-line px-4 py-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (!title.trim()) return;
              createTask({ projectId: project.id, title });
              setTitle('');
            }}
          >
            <Plus size={18} className="text-faint" />
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task" aria-label={`Add a task to ${project.name}`} className="h-11 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint" />
            {title.trim() && (
              <Button type="submit" size="sm" variant="primary">
                Add
              </Button>
            )}
          </form>}
          <button onClick={() => select({ type: 'project', id: project.id })} className="w-full border-t border-line py-3 text-[13px] font-medium text-muted">
            Project details
          </button>
        </div>
      )}
    </article>
  );
}

function TaskRow({ tv, onOpen }: { tv: TaskView; onOpen: () => void }) {
  const { task } = tv;
  const today = toDateKey(Date.now());
  const done = task.status === 'done';
  return (
    <li>
      <button onClick={onOpen} className="flex min-h-[58px] w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-2">
        <span className="flex w-6 shrink-0 justify-center">
          {tv.active ? (
            <span className="anim-pulse h-3 w-3 rounded-full bg-teal shadow-[0_0_10px_var(--teal)]" />
          ) : task.status === 'parked' ? (
            <Pause size={16} className="text-amber" strokeWidth={2.6} />
          ) : tv.blocked ? (
            <Lock size={15} className="text-faint" />
          ) : (
            <span className={cx('h-4 w-4 rounded-full border-2', done ? 'border-teal bg-teal' : 'border-line-strong')} />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className={cx('block truncate text-[15px]', done && 'text-faint line-through')}>{task.title}</span>
          {!done && (
            <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <PriorityBars priority={task.priority} />
              {task.estimateMin && <span>{fmtMinutes(task.estimateMin)}</span>}
              <EnergyIcon energy={task.energy} size={14} />
              {task.due && <DueBadge due={task.due} today={today} />}
              {tv.progress > 0 && <span className="text-teal">{tv.progress}%</span>}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}
