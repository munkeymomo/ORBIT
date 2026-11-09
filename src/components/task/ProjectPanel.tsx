import { useMemo, useState } from 'react';
import { Lock, MoreHorizontal, Pause, Plus, Trash2, X } from 'lucide-react';
import { useOrbit } from '../../store/store';
import { colorHex } from '../../lib/colors';
import { isBlocked, taskProgress } from '../../lib/scoring';
import { actualMinutesByTask, projectStats } from '../../store/selectors';
import { fmtMinutes, toDateKey } from '../../lib/util';
import { Field, IconButton, Input, Menu, SectionTitle, Textarea, cx } from '../ui/primitives';
import { DueBadge, EnergyIcon, PriorityBars, ProgressRing, ProjectGlyph } from '../ui/visuals';
import { ColorPicker, GroupSelect, IconPicker } from '../universe/ProjectForm';
import { useDraft } from './actions';

export function ProjectPanel({ id }: { id: string }) {
  const project = useOrbit((s) => s.projects.find((p) => p.id === id))!;
  const tasks = useOrbit((s) => s.tasks);
  const sessions = useOrbit((s) => s.sessions);
  const activeId = useOrbit((s) => s.focus?.taskId ?? null);
  const updateProject = useOrbit((s) => s.updateProject);
  const createTask = useOrbit((s) => s.createTask);
  const select = useOrbit((s) => s.select);
  const confirm = useOrbit((s) => s.confirm);
  const deleteProject = useOrbit((s) => s.deleteProject);
  const [newTitle, setNewTitle] = useState('');
  const [showDone, setShowDone] = useState(false);
  const [editing, setEditing] = useState(false);
  const today = toDateKey(Date.now());

  const name = useDraft(project.name, (v) => v.trim() && updateProject(id, { name: v.trim() }), 500);
  const desc = useDraft(project.description, (v) => updateProject(id, { description: v }));
  const stats = useMemo(() => projectStats(id, tasks, today), [id, tasks, today]);
  const own = useMemo(
    () =>
      tasks
        .filter((t) => t.projectId === id)
        .sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || Number(b.status === 'parked') - Number(a.status === 'parked') || b.priority - a.priority || a.createdAt - b.createdAt),
    [tasks, id],
  );
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);
  const actual = useMemo(() => {
    const m = actualMinutesByTask(sessions);
    return own.reduce((s, t) => s + (m.get(t.id) ?? 0), 0);
  }, [sessions, own]);
  const hex = colorHex(project.color);
  const visible = showDone ? own : own.filter((t) => t.status !== 'done');

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-5 py-3">
        <span className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">Project</span>
        <div className="flex-1" />
        <Menu
          label="Project actions"
          trigger={(p) => (
            <IconButton {...p} label="More actions" size="sm">
              <MoreHorizontal size={18} />
            </IconButton>
          )}
          items={[
            { label: editing ? 'Done editing appearance' : 'Edit colour, icon and galaxy', onSelect: () => setEditing((e) => !e) },
            { label: 'Show in the Universe', onSelect: () => { useOrbit.getActions().setView('universe'); useOrbit.getActions().requestFlight('system', id); } },
            'sep',
            {
              label: 'Delete project',
              icon: <Trash2 size={15} />,
              danger: true,
              onSelect: () =>
                confirm({
                  title: `Delete “${project.name}”?`,
                  body: `This removes the project and its ${own.length} task${own.length === 1 ? '' : 's'}, with their checkpoints and day-plan entries. Focus history stays in Insights. This cannot be undone — export a backup first if unsure.`,
                  confirmLabel: 'Delete project',
                  danger: true,
                  onConfirm: () => deleteProject(id),
                }),
            },
          ]}
        />
        <IconButton label="Close (Esc)" size="sm" onClick={() => select(null)}>
          <X size={18} />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <div className="flex items-center gap-4">
          <ProgressRing value={stats.progress} size={72} stroke={6} color={hex} label={`${Math.round(stats.progress * 100)}% complete`}>
            <button onClick={() => setEditing((e) => !e)} className="flex h-12 w-12 items-center justify-center rounded-full" style={{ background: `${hex}2a`, color: hex }} title="Change colour and icon">
              <ProjectGlyph icon={project.icon} size={22} />
            </button>
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <input
              value={name.value}
              onChange={(e) => name.onChange(e.target.value)}
              onBlur={name.flush}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              aria-label="Project name"
              className="w-full bg-transparent font-display text-[22px] font-semibold tracking-tight outline-none"
            />
            <p className="tabular text-sm text-muted">{Math.round(stats.progress * 100)}% of estimated work done</p>
          </div>
        </div>

        <dl className="grid grid-cols-4 gap-2 text-center">
          {[
            ['Open', stats.open],
            ['Parked', stats.parked],
            ['Done', stats.done],
            ['Left', stats.openEffortMin ? fmtMinutes(stats.openEffortMin) : '—'],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-xl bg-surface-2 px-2 py-2.5">
              <dd className="tabular font-display text-lg font-semibold">{v}</dd>
              <dt className="text-[11px] text-muted">{k}</dt>
            </div>
          ))}
        </dl>
        {actual > 0 && <p className="-mt-3 text-xs text-muted">{fmtMinutes(actual)} of focus time recorded on this project.</p>}

        {editing && (
          <section className="anim-fade space-y-4 rounded-2xl border border-line p-4">
            <Field group label="Colour">
              <ColorPicker value={project.color} onChange={(color) => updateProject(id, { color })} />
            </Field>
            <Field group label="Icon">
              <IconPicker value={project.icon} onChange={(icon) => updateProject(id, { icon })} color={project.color} />
            </Field>
            <Field group label="Galaxy">
              <GroupSelect value={project.groupId} onChange={(groupId) => updateProject(id, { groupId })} />
            </Field>
          </section>
        )}

        <Textarea value={desc.value} onChange={(e) => desc.onChange(e.target.value)} onBlur={desc.flush} placeholder="What is this project for? (optional)" rows={2} aria-label="Project description" />

        <section>
          <SectionTitle
            right={
              stats.done > 0 && (
                <button className="text-xs text-muted hover:text-text" onClick={() => setShowDone((x) => !x)}>
                  {showDone ? 'Hide done' : `Show ${stats.done} done`}
                </button>
              )
            }
          >
            Tasks
          </SectionTitle>
          <form
            className="mb-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newTitle.trim()) return;
              createTask({ projectId: id, title: newTitle });
              setNewTitle('');
            }}
          >
            <Input data-quick-add value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Add a task — Enter to add, keep typing for more" aria-label="New task title" />
            <IconButton label="Add task" type="submit" variant="primary" disabled={!newTitle.trim()}>
              <Plus size={18} />
            </IconButton>
          </form>
          {visible.length === 0 && <p className="py-4 text-center text-sm text-muted">{own.length ? 'All done here.' : 'No tasks yet. Add the first one above.'}</p>}
          <ul className="space-y-1">
            {visible.map((t) => {
              const blocked = t.status !== 'done' && isBlocked(t, byId).length > 0;
              const prog = taskProgress(t);
              return (
                <li key={t.id}>
                  <button onClick={() => select({ type: 'task', id: t.id })} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-surface-2">
                    <span className="flex w-4 justify-center">
                      {t.id === activeId ? (
                        <span className="anim-pulse h-2.5 w-2.5 rounded-full bg-teal" />
                      ) : t.status === 'parked' ? (
                        <Pause size={14} className="text-amber" strokeWidth={2.6} />
                      ) : blocked ? (
                        <Lock size={13} className="text-faint" />
                      ) : (
                        <span className={cx('h-3 w-3 rounded-full border-2', t.status === 'done' ? 'border-teal bg-teal' : 'border-line-strong')} />
                      )}
                    </span>
                    <span className={cx('min-w-0 flex-1 truncate text-sm', t.status === 'done' && 'text-faint line-through')}>{t.title}</span>
                    {t.status !== 'done' && (
                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                        {prog > 0 && <span className="text-teal">{prog}%</span>}
                        {t.due && <DueBadge due={t.due} today={today} />}
                        {t.estimateMin && <span>{fmtMinutes(t.estimateMin)}</span>}
                        <EnergyIcon energy={t.energy} size={13} />
                        <PriorityBars priority={t.priority} />
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      </div>
    </div>
  );
}
