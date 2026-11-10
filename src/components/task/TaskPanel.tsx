import { useMemo, useState } from 'react';
import {
  Check,
  CircleCheck,
  ExternalLink,
  GitBranch,
  History,
  Link2,
  Lock,
  MoreHorizontal,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  SquareParking,
  Trash2,
  X,
} from 'lucide-react';
import { useOrbit } from '../../store/store';
import type { Energy, Priority, Task } from '../../types';
import { colorHex } from '../../lib/colors';
import { taskProgress } from '../../lib/scoring';
import { actualMinutesByTask, sessionsForTask } from '../../store/selectors';
import { elapsedMs, remainingMs } from '../../lib/timer';
import { useNow } from '../../lib/hooks';
import { fmtClock, fmtMinutes, fmtTimeOfDay, normaliseUrl, relativeTime, toDateKey, uid } from '../../lib/util';
import { Button, Field, IconButton, Input, Menu, SectionTitle, Segmented, Select, Textarea, cx } from '../ui/primitives';
import { DueBadge, ENERGY_META, PRIORITY_META, PriorityBars, ProjectChip } from '../ui/visuals';
import { PlanTodayButton, StartFocusButton, useDraft } from './actions';
import { KeptBy, LinkedItems } from './HostPanels';
import { useAbilities } from '../../host/useAbilities';
import { may, mayWork } from '../../host/caps';

export function TaskPanel({ id }: { id: string }) {
  const task = useOrbit((s) => s.tasks.find((t) => t.id === id))!;
  const project = useOrbit((s) => s.projects.find((p) => p.id === task.projectId));
  const updateTask = useOrbit((s) => s.updateTask);
  const select = useOrbit((s) => s.select);
  const isActive = useOrbit((s) => s.focus?.taskId === id);
  const today = toDateKey(Date.now());
  const up = (patch: Partial<Task>) => updateTask(id, patch);
  const can = useAbilities();
  // A host's task is edited only where the host allows it (never, in the read-only stage).
  const editable = may(can, task.host, 'edit');

  const title = useDraft(task.title, (v) => v.trim() && up({ title: v.trim() }), 500);
  const notes = useDraft(task.notes, (v) => up({ notes: v }));
  const hex = colorHex(project?.color ?? 'violet');
  const done = task.status === 'done';

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-5 py-3">
        <button onClick={() => project && select({ type: 'project', id: project.id })} className="flex min-w-0 items-center gap-2 rounded-lg py-1 pr-2 text-sm text-muted hover:text-text" title="Open project">
          {project && <ProjectChip color={project.color} icon={project.icon} size={24} />}
          <span className="truncate">{project?.name}</span>
        </button>
        <div className="flex-1" />
        <StatusPill task={task} active={isActive} />
        {(may(can, task.host, 'delete') || (!task.host && can.personal)) && <TaskMenu task={task} />}
        <IconButton label="Close (Esc)" size="sm" onClick={() => select(null)}>
          <X size={18} />
        </IconButton>
      </header>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <div>
          <textarea
            value={title.value}
            onChange={(e) => title.onChange(e.target.value.replace(/\n/g, ''))}
            onBlur={title.flush}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), (e.target as HTMLTextAreaElement).blur())}
            rows={1}
            readOnly={!editable}
            aria-label="Task title"
            className={cx('field-sizing-content w-full resize-none bg-transparent font-display text-[22px] leading-snug font-semibold tracking-tight outline-none', done && 'text-muted line-through')}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
            {task.due && !done && <DueBadge due={task.due} today={today} />}
            {task.estimateMin && <span>~{fmtMinutes(task.estimateMin)}</span>}
            <span className="inline-flex items-center gap-1">
              <PriorityBars priority={task.priority} /> {PRIORITY_META[task.priority].label}
            </span>
          </div>
        </div>

        {task.host?.note && <p className="rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-muted">{task.host.note}</p>}
        {task.host && <KeptBy refOf={task.host} />}
        <PrimaryActions task={task} active={isActive} />
        {task.status === 'parked' && <ParkedSummary taskId={id} />}

        {task.host && <LinkedItems taskId={id} />}
        {task.host?.facts?.length ? (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
            {task.host.facts.map((f) => (
              <div key={f.label} className="contents">
                <dt className="text-muted">{f.label}</dt>
                <dd>{f.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {editable && <section className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Field group label="Priority" className="col-span-2">
            <Segmented<Priority>
              label="Priority"
              value={task.priority}
              onChange={(priority) => up({ priority })}
              className="w-full [&>button]:flex-1"
              options={([1, 2, 3, 4] as Priority[]).map((p) => ({ value: p, label: PRIORITY_META[p].label }))}
            />
          </Field>
          <Field group label="Energy needed" className="col-span-2">
            <Segmented<Energy>
              label="Energy needed"
              value={task.energy}
              onChange={(energy) => up({ energy })}
              className="w-full [&>button]:flex-1"
              options={(['low', 'medium', 'high'] as Energy[]).map((e) => {
                const M = ENERGY_META[e];
                return { value: e, label: <><M.Icon size={15} className={M.cls} /> {e[0].toUpperCase() + e.slice(1)}</> };
              })}
            />
          </Field>
          <Field group label="Estimate">
            <EstimateInput value={task.estimateMin} onChange={(estimateMin) => up({ estimateMin })} />
          </Field>
          <Field group label="Due">
            <div className="flex gap-1.5">
              <Input type="date" value={task.due ?? ''} onChange={(e) => up({ due: e.target.value || null })} aria-label="Due date" className="min-w-0" />
              {task.due && (
                <IconButton label="Clear due date" size="md" variant="secondary" onClick={() => up({ due: null })}>
                  <X size={15} />
                </IconButton>
              )}
            </div>
          </Field>
          <Field label={task.subtasks.length ? `Progress · from subtasks` : `Progress · ${task.progress}%`} className="col-span-2">
            {task.subtasks.length ? (
              <div className="flex items-center gap-3">
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full rounded-full bg-teal transition-[width]" style={{ width: `${taskProgress(task)}%` }} />
                </div>
                <span className="tabular text-sm text-muted">{taskProgress(task)}%</span>
              </div>
            ) : (
              <input type="range" min={0} max={100} step={5} value={task.progress} onChange={(e) => up({ progress: Number(e.target.value) })} className="w-full" aria-label="Progress" disabled={done} />
            )}
          </Field>
          <Field label="Project" className="col-span-2">
            <ProjectSelect value={task.projectId} onChange={(projectId) => up({ projectId })} />
          </Field>
        </section>}

        {/* subtasks, dependencies and links are ORBIT's own working state: not for a host's tasks yet */}
        {!task.host && (
          <>
            <Subtasks task={task} />
            <Dependencies task={task} />
            <Links task={task} />
          </>
        )}

        {editable ? (
          <section>
            <SectionTitle>Notes</SectionTitle>
            <Textarea value={notes.value} onChange={(e) => notes.onChange(e.target.value)} onBlur={notes.flush} placeholder="Anything worth remembering about this task" rows={4} />
          </section>
        ) : (
          task.notes && (
            <section>
              <SectionTitle>Notes</SectionTitle>
              <p className="text-sm whitespace-pre-wrap text-text">{task.notes}</p>
            </section>
          )
        )}

        <Checkpoints taskId={id} />
        <SessionHistory task={task} color={hex} />
      </div>
    </div>
  );
}

function StatusPill({ task, active }: { task: Task; active: boolean }) {
  if (active) return <span className="rounded-full bg-teal-soft px-2.5 py-1 text-xs font-semibold text-teal">In focus</span>;
  if (task.status === 'parked') return <span className="rounded-full bg-amber-soft px-2.5 py-1 text-xs font-semibold text-amber">Parked</span>;
  if (task.host?.dropped) return <span className="rounded-full bg-surface-3 px-2.5 py-1 text-xs font-semibold text-muted">Dropped</span>;
  if (task.status === 'done') return <span className="rounded-full bg-surface-3 px-2.5 py-1 text-xs font-semibold text-muted">Done</span>;
  return null;
}

function TaskMenu({ task }: { task: Task }) {
  const confirm = useOrbit((s) => s.confirm);
  const deleteTask = useOrbit((s) => s.deleteTask);
  const createTask = useOrbit((s) => s.createTask);
  const select = useOrbit((s) => s.select);
  return (
    <Menu
      label="Task actions"
      trigger={(p) => (
        <IconButton {...p} label="More actions" size="sm">
          <MoreHorizontal size={18} />
        </IconButton>
      )}
      items={[
        {
          label: 'Duplicate',
          icon: <Plus size={15} />,
          onSelect: () => {
            const { id: _id, createdAt: _c, updatedAt: _u, status: _s, completedAt: _ca, parkedAt: _pa, ...rest } = task;
            const t = createTask({ ...rest, title: `${task.title} (copy)`, subtasks: task.subtasks.map((s) => ({ ...s, id: uid(), done: false })) });
            select({ type: 'task', id: t.id });
          },
        },
        'sep',
        {
          label: 'Delete task',
          icon: <Trash2 size={15} />,
          danger: true,
          onSelect: () =>
            confirm({
              title: 'Delete this task?',
              body: `“${task.title}”, its checkpoints and its place on any day plan will be removed. Focus history stays in Insights.`,
              confirmLabel: 'Delete task',
              danger: true,
              onConfirm: () => deleteTask(task.id),
            }),
        },
      ]}
    />
  );
}

function PrimaryActions({ task, active }: { task: Task; active: boolean }) {
  const focus = useOrbit((s) => s.focus);
  const pauseFocus = useOrbit((s) => s.pauseFocus);
  const resumeFocus = useOrbit((s) => s.resumeFocus);
  const openPark = useOrbit((s) => s.openPark);
  const openResume = useOrbit((s) => s.openResume);
  const completeTask = useOrbit((s) => s.completeTask);
  const reopenTask = useOrbit((s) => s.reopenTask);
  const setView = useOrbit((s) => s.setView);
  const now = useNow(active ? 1000 : null);
  const can = useAbilities();
  const status = may(can, task.host, 'status');
  const work = mayWork(can, task.host);
  if (!status && !work) return null;

  if (task.status === 'done')
    return !status ? null : (
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" icon={<RotateCcw size={15} />} onClick={() => reopenTask(task.id)}>
          Reopen
        </Button>
      </div>
    );

  if (active && focus) {
    const r = remainingMs(focus, now);
    const running = focus.runningSince != null;
    return (
      <div className="rounded-2xl border border-teal/40 bg-teal-soft p-3.5">
        <button onClick={() => setView('focus')} className="mb-3 flex w-full items-center gap-2 text-left text-sm">
          <span className={cx('h-2 w-2 rounded-full bg-teal', running && 'anim-pulse')} />
          <span className="font-medium">{running ? 'Focusing' : 'Paused'}</span>
          <span className="tabular ml-auto font-display text-lg font-semibold">{r != null ? (r <= 0 ? `+${fmtClock(-r)}` : fmtClock(r)) : fmtClock(elapsedMs(focus, now))}</span>
        </button>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" icon={running ? <Pause size={14} /> : <Play size={14} />} onClick={running ? pauseFocus : resumeFocus}>
            {running ? 'Pause' : 'Resume'}
          </Button>
          <Button variant="amber" size="sm" icon={<SquareParking size={15} />} onClick={() => openPark({ taskId: task.id })}>
            Park
          </Button>
          <Button variant="secondary" size="sm" icon={<CircleCheck size={15} />} onClick={() => completeTask(task.id)}>
            Complete
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {task.status === 'parked' ? (
        <Button variant="teal" icon={<Play size={16} fill="currentColor" />} onClick={() => openResume(task.id)}>
          Resume
        </Button>
      ) : (
        <StartFocusButton taskId={task.id} />
      )}
      <PlanTodayButton taskId={task.id} />
      {task.status !== 'parked' && work && (
        <Button variant="secondary" icon={<SquareParking size={15} />} onClick={() => openPark({ taskId: task.id })} title="Save where you are without focusing">
          Park
        </Button>
      )}
      {status && (
        <Button variant="secondary" icon={<CircleCheck size={15} />} onClick={() => completeTask(task.id)}>
          Complete
        </Button>
      )}
    </div>
  );
}

function ParkedSummary({ taskId }: { taskId: string }) {
  const cp = useOrbit((s) => s.checkpoints.filter((c) => c.taskId === taskId).sort((a, b) => b.createdAt - a.createdAt)[0]);
  const openPark = useOrbit((s) => s.openPark);
  if (!cp) return null;
  const empty = !cp.stoppedAt && !cp.nextAction && !cp.doing && !cp.notes;
  return (
    <div className="rounded-2xl border border-amber/30 bg-amber-soft p-4 text-sm">
      <div className="mb-2 flex items-center justify-between text-xs text-muted">
        <span>Parked {relativeTime(cp.createdAt, Date.now())}{cp.timer ? ` · ${fmtClock(cp.timer.elapsedMs)} on the clock` : ''}</span>
        <button onClick={() => openPark({ taskId, checkpointId: cp.id })} className="inline-flex items-center gap-1 font-medium text-amber hover:underline">
          <Pencil size={12} /> {empty ? 'Add a note' : 'Edit'}
        </button>
      </div>
      {empty ? (
        <p className="text-muted">No note was saved. Add one so resuming is effortless.</p>
      ) : (
        <dl className="space-y-1.5">
          {cp.stoppedAt && (
            <div>
              <dt className="text-xs text-muted">Stopped at</dt>
              <dd>{cp.stoppedAt}</dd>
            </div>
          )}
          {cp.nextAction && (
            <div>
              <dt className="text-xs text-muted">Next action</dt>
              <dd className="font-semibold">{cp.nextAction}</dd>
            </div>
          )}
        </dl>
      )}
    </div>
  );
}

function EstimateInput({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  return (
    <div className="flex gap-1.5">
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} aria-label="Estimate">
        <option value="">None</option>
        {[5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480].map((m) => (
          <option key={m} value={m}>
            {fmtMinutes(m)}
          </option>
        ))}
        {value && ![5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 480].includes(value) && <option value={value}>{fmtMinutes(value)}</option>}
      </Select>
    </div>
  );
}

export function ProjectSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const projects = useOrbit((s) => s.projects);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Project">
      {projects.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </Select>
  );
}

function Subtasks({ task }: { task: Task }) {
  const updateTask = useOrbit((s) => s.updateTask);
  const [title, setTitle] = useState('');
  const set = (subtasks: Task['subtasks']) => updateTask(task.id, { subtasks });
  const done = task.subtasks.filter((s) => s.done).length;
  return (
    <section>
      <SectionTitle right={task.subtasks.length ? <span className="tabular text-xs text-muted">{done}/{task.subtasks.length}</span> : null}>Subtasks</SectionTitle>
      <ul className="space-y-0.5">
        {task.subtasks.map((s) => (
          <li key={s.id} className="group flex items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-surface-2">
            <button
              role="checkbox"
              aria-checked={s.done}
              aria-label={s.title}
              onClick={() => set(task.subtasks.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)))}
              className={cx('flex h-5 w-5 shrink-0 items-center justify-center rounded-md border-2', s.done ? 'border-teal bg-teal text-[#04201c]' : 'border-line-strong')}
            >
              {s.done && <Check size={13} strokeWidth={3} />}
            </button>
            <span className={cx('flex-1 text-sm', s.done && 'text-muted line-through')}>{s.title}</span>
            <IconButton label="Remove subtask" size="xs" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => set(task.subtasks.filter((x) => x.id !== s.id))}>
              <X size={14} />
            </IconButton>
          </li>
        ))}
      </ul>
      <form
        className="mt-1.5 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return;
          set([...task.subtasks, { id: uid(), title: title.trim(), done: false }]);
          setTitle('');
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a subtask" aria-label="New subtask" className="h-9" />
        <IconButton label="Add subtask" type="submit" variant="secondary" size="sm" className="!h-9 !w-9" disabled={!title.trim()}>
          <Plus size={16} />
        </IconButton>
      </form>
    </section>
  );
}

function Dependencies({ task }: { task: Task }) {
  const tasks = useOrbit((s) => s.tasks);
  const projects = useOrbit((s) => s.projects);
  const updateTask = useOrbit((s) => s.updateTask);
  const select = useOrbit((s) => s.select);
  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  // Candidates exclude this task and anything that (transitively) depends on it, to prevent cycles.
  const candidates = useMemo(() => {
    const dependents = new Set<string>([task.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const t of tasks) if (!dependents.has(t.id) && t.dependsOn.some((d) => dependents.has(d))) (dependents.add(t.id), (grew = true));
    }
    return tasks.filter((t) => !dependents.has(t.id) && !task.dependsOn.includes(t.id) && t.status !== 'done');
  }, [tasks, task]);
  const blocks = tasks.filter((t) => t.dependsOn.includes(task.id));
  const pName = (id: string) => projects.find((p) => p.id === id)?.name ?? '';

  return (
    <section>
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5">
          <GitBranch size={13} /> Dependencies
        </span>
      </SectionTitle>
      {task.dependsOn.length > 0 && (
        <ul className="mb-2 space-y-1">
          {task.dependsOn.map((d) => {
            const t = byId.get(d);
            if (!t) return null;
            const ok = t.status === 'done';
            return (
              <li key={d} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-sm">
                {ok ? <Check size={15} className="text-teal" /> : <Lock size={14} className="text-amber" />}
                <button className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => select({ type: 'task', id: t.id })}>
                  <span className="text-muted">{ok ? 'Was waiting on' : 'Waiting on'} </span>
                  {t.title}
                </button>
                <IconButton label="Remove dependency" size="xs" onClick={() => updateTask(task.id, { dependsOn: task.dependsOn.filter((x) => x !== d) })}>
                  <X size={14} />
                </IconButton>
              </li>
            );
          })}
        </ul>
      )}
      {blocks.length > 0 && (
        <p className="mb-2 text-xs text-muted">
          Blocks:{' '}
          {blocks.map((b, i) => (
            <span key={b.id}>
              <button className="text-text hover:underline" onClick={() => select({ type: 'task', id: b.id })}>
                {b.title}
              </button>
              {i < blocks.length - 1 ? ', ' : ''}
            </span>
          ))}
        </p>
      )}
      <Select
        value=""
        onChange={(e) => e.target.value && updateTask(task.id, { dependsOn: [...task.dependsOn, e.target.value] })}
        aria-label="Add a task this one waits on"
        disabled={!candidates.length}
      >
        <option value="">{candidates.length ? 'Waits on another task…' : 'No other open tasks'}</option>
        {candidates.map((t) => (
          <option key={t.id} value={t.id}>
            {t.title} — {pName(t.projectId)}
          </option>
        ))}
      </Select>
    </section>
  );
}

export function LinkList({ links, onChange }: { links: Task['links']; onChange: (l: Task['links']) => void }) {
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  return (
    <div>
      {links.length > 0 && (
        <ul className="mb-2 space-y-1">
          {links.map((l) => (
            <li key={l.id} className="flex items-center gap-2 rounded-lg bg-surface-2 px-2.5 py-2 text-sm">
              <Link2 size={14} className="shrink-0 text-faint" />
              <a href={l.url} target="_blank" rel="noreferrer noopener" className="min-w-0 flex-1 truncate text-accent-ink hover:underline" title={l.url}>
                {l.label || l.url}
              </a>
              <ExternalLink size={13} className="shrink-0 text-faint" />
              <IconButton label="Remove link" size="xs" onClick={() => onChange(links.filter((x) => x.id !== l.id))}>
                <X size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!url.trim()) return;
          onChange([...links, { id: uid(), url: normaliseUrl(url), label: label.trim() }]);
          setUrl('');
          setLabel('');
        }}
      >
        <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Paste a link or file path" aria-label="Link URL" className="h-9 min-w-0 flex-[2]" />
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" aria-label="Link label" className="h-9 min-w-0 flex-1" />
        <IconButton label="Add link" type="submit" variant="secondary" size="sm" className="!h-9 !w-9" disabled={!url.trim()}>
          <Plus size={16} />
        </IconButton>
      </form>
    </div>
  );
}

function Links({ task }: { task: Task }) {
  const updateTask = useOrbit((s) => s.updateTask);
  return (
    <section>
      <SectionTitle>Links and references</SectionTitle>
      <LinkList links={task.links} onChange={(links) => updateTask(task.id, { links })} />
    </section>
  );
}

function Checkpoints({ taskId }: { taskId: string }) {
  const all = useOrbit((s) => s.checkpoints);
  const openPark = useOrbit((s) => s.openPark);
  const list = useMemo(() => all.filter((c) => c.taskId === taskId).sort((a, b) => b.createdAt - a.createdAt), [all, taskId]);
  if (!list.length) return null;
  const now = Date.now();
  return (
    <section>
      <SectionTitle>
        <span className="inline-flex items-center gap-1.5">
          <History size={13} /> Checkpoints
        </span>
      </SectionTitle>
      <ol className="relative space-y-3 border-l border-line pl-4">
        {list.map((c, i) => (
          <li key={c.id} className="relative text-sm">
            <span className={cx('absolute top-1.5 -left-[21px] h-2.5 w-2.5 rounded-full ring-4 ring-surface', c.resumedAt ? 'bg-faint' : 'bg-amber')} />
            <div className="flex items-center gap-2 text-xs text-muted">
              <span>{relativeTime(c.createdAt, now)}</span>
              {c.auto && <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold uppercase">Auto</span>}
              {c.resumedAt && <span>· resumed {relativeTime(c.resumedAt, now)}</span>}
              {i === 0 && (
                <button className="ml-auto text-accent-ink hover:underline" onClick={() => openPark({ taskId, checkpointId: c.id })}>
                  Edit
                </button>
              )}
            </div>
            {c.doing && <p className="mt-0.5 text-muted">Doing: {c.doing}</p>}
            {c.stoppedAt && <p className="mt-0.5">Stopped at: {c.stoppedAt}</p>}
            {c.nextAction && <p className="mt-0.5 font-medium">Next: {c.nextAction}</p>}
            {c.notes && <p className="mt-0.5 whitespace-pre-wrap text-muted">{c.notes}</p>}
            {!c.doing && !c.stoppedAt && !c.nextAction && !c.notes && <p className="mt-0.5 text-faint">No note{c.timer ? ` · timer saved at ${fmtClock(c.timer.elapsedMs)}` : ''}</p>}
          </li>
        ))}
      </ol>
    </section>
  );
}

function SessionHistory({ task, color }: { task: Task; color: string }) {
  const sessions = useOrbit((s) => s.sessions);
  const list = useMemo(() => sessionsForTask(sessions, task.id), [sessions, task.id]);
  const actual = useMemo(() => actualMinutesByTask(sessions).get(task.id) ?? 0, [sessions, task.id]);
  if (!list.length) return null;
  const est = task.estimateMin;
  const max = Math.max(actual, est ?? 0, 1);
  return (
    <section>
      <SectionTitle>Focus time</SectionTitle>
      <div className="mb-3 space-y-1.5 text-xs">
        <div className="flex items-center gap-2">
          <span className="w-16 text-muted">Actual</span>
          <div className="h-2 flex-1 rounded-full bg-surface-3">
            <div className="h-full rounded-full" style={{ width: `${(actual / max) * 100}%`, background: color }} />
          </div>
          <span className="tabular w-14 text-right">{fmtMinutes(actual)}</span>
        </div>
        {est != null && (
          <div className="flex items-center gap-2">
            <span className="w-16 text-muted">Estimate</span>
            <div className="h-2 flex-1 rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-faint" style={{ width: `${(est / max) * 100}%` }} />
            </div>
            <span className="tabular w-14 text-right">{fmtMinutes(est)}</span>
          </div>
        )}
      </div>
      <ul className="divide-y divide-line text-sm">
        {list.slice(0, 8).map((s) => (
          <li key={s.id} className="flex items-center gap-3 py-2">
            <span className="text-muted">{new Date(s.startedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}</span>
            <span className="text-muted">{fmtTimeOfDay(s.startedAt)}</span>
            <span className="tabular ml-auto font-medium">{s.endedAt ? fmtMinutes(s.activeMs / 60000) : 'running'}</span>
            <span className="w-20 text-right text-xs text-faint">{s.endReason ?? ''}</span>
          </li>
        ))}
      </ul>
      {list.some((s) => s.notes) && (
        <div className="mt-2 space-y-1.5">
          {list
            .filter((s) => s.notes)
            .slice(0, 4)
            .map((s) => (
              <p key={s.id} className="rounded-lg bg-surface-2 px-3 py-2 text-xs whitespace-pre-wrap text-muted">
                {s.notes}
              </p>
            ))}
        </div>
      )}
    </section>
  );
}
