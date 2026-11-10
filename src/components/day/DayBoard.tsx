import { useMemo, useState } from 'react';
import { localGet, localSet } from '../../lib/local';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Check, ChevronLeft, ChevronRight, CircleCheck, Clock, GripVertical, MoreHorizontal, Pause, Play, Plus, Search, X } from 'lucide-react';
import { useOrbit } from '../../store/store';
import type { DayItem, DaySlot, Project, Task } from '../../types';
import { colorHex } from '../../lib/colors';
import { taskProgress } from '../../lib/scoring';
import { useIsDesktop, useIsPhone } from '../../lib/hooks';
import { SLOTS, addDays, addMinutesToHHMM, currentSlot, fmtMinutes, friendlyDay, toDateKey } from '../../lib/util';
import { Button, IconButton, Input, Menu, Toggle, cx } from '../ui/primitives';
import { DueBadge, EnergyIcon, PriorityBars } from '../ui/visuals';
import { useSuggestions } from '../next/useSuggestions';

type Entry = { item: DayItem; task: Task; project: Project | undefined };

export function DayBoard() {
  const date = useOrbit((s) => s.dayDate);
  const dayItems = useOrbit((s) => s.dayItems);
  const tasks = useOrbit((s) => s.tasks);
  const projects = useOrbit((s) => s.projects);
  const { setDayDate, planTask, moveDayItem, unplan } = useOrbit.getActions();
  const desktop = useIsDesktop();
  const phone = useIsPhone();
  const [blocks, setBlocks] = useState(() => localGet('orbit-timeblocks') === '1');
  const [activeDrag, setActiveDrag] = useState<string | null>(null);
  const [trayOpen, setTrayOpen] = useState(false);
  const today = toDateKey(Date.now());

  const entries = useMemo(() => {
    const tById = new Map(tasks.map((t) => [t.id, t]));
    const pById = new Map(projects.map((p) => [p.id, p]));
    const bySlot: Record<DaySlot, Entry[]> = { morning: [], afternoon: [], evening: [], later: [] };
    for (const item of dayItems) {
      if (item.date !== date) continue;
      const task = tById.get(item.taskId);
      if (!task) continue;
      bySlot[item.slot].push({ item, task, project: pById.get(task.projectId) });
    }
    for (const k of Object.keys(bySlot) as DaySlot[]) bySlot[k].sort((a, b) => a.item.order - b.item.order);
    return bySlot;
  }, [dayItems, tasks, projects, date]);

  const all = SLOTS.flatMap((s) => entries[s.id]);
  const plannedMin = all.reduce((s, e) => s + (e.task.estimateMin ?? 0), 0);
  const doneMin = all.filter((e) => e.task.status === 'done').reduce((s, e) => s + (e.task.estimateMin ?? 0), 0);
  const doneCount = all.filter((e) => e.task.status === 'done').length;
  const unestimated = all.filter((e) => !e.task.estimateMin && e.task.status !== 'done').length;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const slotOf = (id: string): DaySlot | 'tray' | null => {
    if (id.startsWith('slot:')) return id.slice(5) as DaySlot;
    if (id === 'tray') return 'tray';
    if (id.startsWith('item:')) return dayItems.find((d) => d.id === id.slice(5))?.slot ?? null;
    return null;
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveDrag(null);
    const a = String(e.active.id);
    const o = e.over ? String(e.over.id) : null;
    if (!o) return;
    const target = slotOf(o);
    if (!target) return;
    if (target === 'tray') {
      if (a.startsWith('item:')) unplan(a.slice(5));
      return;
    }
    const list = entries[target];
    let index = list.length;
    if (o.startsWith('item:')) {
      const j = list.findIndex((x) => x.item.id === o.slice(5));
      if (j >= 0) index = j;
    }
    if (a.startsWith('task:')) planTask(a.slice(5), date, target, index);
    else if (a.startsWith('item:')) moveDayItem(a.slice(5), target, index);
  };
  const onDragStart = (e: DragStartEvent) => setActiveDrag(String(e.active.id));

  const overlay = useMemo(() => {
    if (!activeDrag) return null;
    if (activeDrag.startsWith('item:')) {
      const e = all.find((x) => x.item.id === activeDrag.slice(5));
      return e ? <CardFace task={e.task} project={e.project} item={e.item} showBlocks={false} overlay /> : null;
    }
    const t = tasks.find((x) => x.id === activeDrag.slice(5));
    return t ? <CardFace task={t} project={projects.find((p) => p.id === t.projectId)} overlay showBlocks={false} /> : null;
  }, [activeDrag, all, tasks, projects]);

  const setBlocksPersist = (v: boolean) => {
    setBlocks(v);
    localSet('orbit-timeblocks', v ? '1' : '0');
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveDrag(null)}>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 md:px-6">
          <div className="flex items-center gap-1">
            <IconButton label="Previous day" size="sm" onClick={() => setDayDate(addDays(date, -1))}>
              <ChevronLeft size={18} />
            </IconButton>
            <button onClick={() => setDayDate(today)} className="min-w-[120px] rounded-lg px-2 py-1 text-center font-display text-[15px] font-semibold hover:bg-surface-2" title="Jump to today">
              {friendlyDay(date, today)}
            </button>
            <IconButton label="Next day" size="sm" onClick={() => setDayDate(addDays(date, 1))}>
              <ChevronRight size={18} />
            </IconButton>
          </div>
          <div className="flex min-w-[220px] flex-1 items-center gap-3">
            <div className="h-2 max-w-[260px] flex-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={all.length ? Math.round((doneCount / all.length) * 100) : 0} aria-valuemin={0} aria-valuemax={100} aria-label="Day progress">
              <div className="h-full rounded-full bg-gradient-to-r from-accent to-teal transition-[width] duration-500" style={{ width: `${all.length ? (doneCount / all.length) * 100 : 0}%` }} />
            </div>
            <span className="tabular text-sm text-muted">
              <strong className="font-semibold text-text">{doneCount}</strong>/{all.length} done · <strong className="font-semibold text-text">{fmtMinutes(plannedMin)}</strong> planned
              {doneMin > 0 && <> · {fmtMinutes(doneMin)} finished</>}
              {unestimated > 0 && <span className="text-faint"> · {unestimated} without estimate</span>}
            </span>
          </div>
          <div className="w-[180px]">
            <Toggle label="Time blocks" checked={blocks} onChange={setBlocksPersist} />
          </div>
          {!desktop && (
            <Button variant="primary" size="sm" icon={<Plus size={15} />} onClick={() => setTrayOpen((x) => !x)} aria-expanded={trayOpen}>
              Add tasks
            </Button>
          )}
        </div>

        <div className={cx('min-h-0 flex-1', desktop ? 'grid grid-cols-[minmax(0,1fr)_300px]' : 'overflow-y-auto')}>
          <div className={cx(desktop ? 'grid min-h-0 grid-cols-4 gap-3 overflow-x-auto p-4' : 'space-y-4 p-4')}>
            {!desktop && trayOpen && (
              <div className="rounded-2xl border border-line bg-surface p-3">
                <Tray date={date} compact onClose={() => setTrayOpen(false)} />
              </div>
            )}
            {SLOTS.map((s) => (
              <SlotColumn key={s.id} slot={s.id} label={s.label} hint={s.hint} entries={entries[s.id]} showBlocks={blocks} isNow={date === today && currentSlot(Date.now()) === s.id} desktop={desktop} phone={phone} date={date} />
            ))}
          </div>
          {desktop && (
            <aside className="min-h-0 border-l border-line bg-surface/40 p-4">
              <Tray date={date} />
            </aside>
          )}
        </div>
      </div>
      <DragOverlay dropAnimation={null}>{overlay}</DragOverlay>
    </DndContext>
  );
}

function SlotColumn({ slot, label, hint, entries, showBlocks, isNow, desktop, phone, date }: { slot: DaySlot; label: string; hint: string; entries: Entry[]; showBlocks: boolean; isNow: boolean; desktop: boolean; phone: boolean; date: string }) {
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${slot}` });
  const mins = entries.filter((e) => e.task.status !== 'done').reduce((s, e) => s + (e.task.estimateMin ?? 0), 0);
  return (
    <section
      ref={setNodeRef}
      aria-label={`${label}, ${entries.length} tasks`}
      className={cx('flex flex-col rounded-2xl border transition-colors', desktop && 'min-h-0', isOver ? 'border-accent bg-accent-soft' : 'border-line bg-surface/60')}
    >
      <header className="flex items-baseline gap-2 px-3.5 pt-3 pb-2">
        <h2 className="font-display text-[15px] font-semibold">{label}</h2>
        {isNow && <span className="rounded-full bg-teal-soft px-2 py-0.5 text-[10px] font-bold tracking-wide text-teal uppercase">Now</span>}
        <span className="text-xs text-faint">{hint}</span>
        <span className="tabular ml-auto text-xs text-muted">{mins ? fmtMinutes(mins) : ''}</span>
      </header>
      <SortableContext items={entries.map((e) => `item:${e.item.id}`)} strategy={verticalListSortingStrategy}>
        <ul className={cx('flex-1 space-y-2 px-2.5 pb-3', desktop && 'overflow-y-auto')}>
          {entries.map((e) => (
            <SortableCard key={e.item.id} entry={e} showBlocks={showBlocks} phone={phone} date={date} />
          ))}
          {entries.length === 0 && <li className={cx('rounded-xl border border-dashed border-line px-3 text-center text-xs text-faint', desktop ? 'py-8' : 'py-4')}>{desktop ? 'Drag tasks here' : 'Nothing planned'}</li>}
        </ul>
      </SortableContext>
    </section>
  );
}

function SortableCard({ entry, showBlocks, phone, date }: { entry: Entry; showBlocks: boolean; phone: boolean; date: string }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `item:${entry.item.id}` });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} className={cx(isDragging && 'opacity-30')}>
      <CardFace task={entry.task} project={entry.project} item={entry.item} showBlocks={showBlocks} handle={{ ...attributes, ...listeners }} phone={phone} date={date} />
    </li>
  );
}

function CardFace({
  task,
  project,
  item,
  showBlocks,
  handle,
  overlay,
  phone,
  date,
}: {
  task: Task;
  project: Project | undefined;
  item?: DayItem;
  showBlocks: boolean;
  handle?: Record<string, unknown>;
  overlay?: boolean;
  phone?: boolean;
  date?: string;
}) {
  const active = useOrbit((s) => s.focus?.taskId === task.id);
  const { select, startFocus, completeTask, reopenTask, moveDayItem, unplan, setDayItemStart, openResume, planTask } = useOrbit.getActions();
  const hex = colorHex(project?.color ?? 'violet');
  const done = task.status === 'done';
  const prog = taskProgress(task);
  const today = toDateKey(Date.now());
  return (
    <div
      className={cx(
        'group relative overflow-hidden rounded-xl border bg-raised transition-shadow',
        active ? 'border-teal shadow-[0_0_0_1px_var(--teal),0_8px_24px_-10px_var(--teal)]' : 'border-line hover:border-line-strong',
        overlay && 'w-[260px] rotate-[1.5deg] shadow-panel',
        done && 'opacity-60',
      )}
    >
      <span className="absolute inset-y-0 left-0 w-1" style={{ background: hex }} />
      <div className="flex items-start gap-1.5 py-2.5 pr-2 pl-3">
        {handle && (
          <button {...handle} aria-label={`Move “${task.title}”`} className="-ml-1 cursor-grab touch-none rounded-md p-0.5 text-faint hover:text-text active:cursor-grabbing">
            <GripVertical size={15} />
          </button>
        )}
        <button className="min-w-0 flex-1 text-left" onClick={() => !overlay && select({ type: 'task', id: task.id })}>
          {item?.start && (
            <span className="tabular mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-accent-ink">
              <Clock size={11} /> {item.start}
              {task.estimateMin ? `–${addMinutesToHHMM(item.start, task.estimateMin)}` : ''}
            </span>
          )}
          <span className={cx('line-clamp-2 text-[13.5px] leading-snug font-medium', done && 'line-through')}>{task.title}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-muted">
            <span className="max-w-[110px] truncate">{project?.name}</span>
            {task.estimateMin && <span className="tabular">{fmtMinutes(task.estimateMin)}</span>}
            <EnergyIcon energy={task.energy} size={13} />
            <PriorityBars priority={task.priority} />
            {task.status === 'parked' && <Pause size={12} className="text-amber" strokeWidth={2.8} aria-label="Parked" />}
            {task.due && !done && <DueBadge due={task.due} today={today} />}
          </span>
          {prog > 0 && !done && (
            <span className="mt-2 block h-1 overflow-hidden rounded-full bg-surface-3">
              <span className="block h-full rounded-full bg-teal" style={{ width: `${prog}%` }} />
            </span>
          )}
        </button>
        {!overlay && (
          <div className={cx('flex shrink-0 flex-col items-center gap-0.5', !phone && 'opacity-60 group-hover:opacity-100 focus-within:opacity-100')}>
            {!done && !active && (
              <IconButton label={task.status === 'parked' ? 'Resume' : 'Start focus'} size="xs" variant="ghost" onClick={() => (task.status === 'parked' ? openResume(task.id) : startFocus({ taskId: task.id }))}>
                <Play size={13} fill="currentColor" />
              </IconButton>
            )}
            <Menu
              label="Card actions"
              trigger={(p) => (
                <IconButton {...p} label="More" size="xs">
                  <MoreHorizontal size={15} />
                </IconButton>
              )}
              items={[
                done ? { label: 'Reopen', icon: <Check size={14} />, onSelect: () => reopenTask(task.id) } : { label: 'Complete', icon: <CircleCheck size={14} />, onSelect: () => completeTask(task.id) },
                'sep',
                ...SLOTS.filter((s) => !item || s.id !== item.slot).map((s) => ({
                  label: `Move to ${s.label}`,
                  onSelect: () => (item ? moveDayItem(item.id, s.id, 999) : date && planTask(task.id, date, s.id)),
                })),
                ...(item
                  ? [
                      'sep' as const,
                      ...(item.start ? [{ label: 'Clear time block', icon: <Clock size={14} />, onSelect: () => setDayItemStart(item.id, null) }] : []),
                      { label: 'Remove from day', icon: <X size={14} />, danger: true, onSelect: () => unplan(item.id) },
                    ]
                  : []),
              ]}
            />
          </div>
        )}
      </div>
      {item && showBlocks && !overlay && !done && <TimeBlockInline item={item} />}
    </div>
  );
}

/** Optional time-blocking: shown only when "Time blocks" is on, never required. */
function TimeBlockInline({ item }: { item: DayItem }) {
  const setDayItemStart = useOrbit((s) => s.setDayItemStart);
  return (
    <div className="flex items-center gap-2 border-t border-line px-3 py-1.5 text-[11px] text-faint">
      <Clock size={11} />
      <label className="flex items-center gap-2">
        <span>Start</span>
        <input
          type="time"
          value={item.start ?? ''}
          className="tabular h-6 rounded-md bg-surface-2 px-1 text-[11px] text-text outline-none focus:ring-1 focus:ring-accent"
          onChange={(e) => setDayItemStart(item.id, e.target.value || null)}
          aria-label="Time block start"
        />
      </label>
      {item.start && (
        <button className="ml-auto text-faint hover:text-text" onClick={() => setDayItemStart(item.id, null)} aria-label="Clear time block">
          <X size={12} />
        </button>
      )}
    </div>
  );
}

/* ---------------- Unplanned tray ---------------- */

function Tray({ date, compact, onClose }: { date: string; compact?: boolean; onClose?: () => void }) {
  const tasks = useOrbit((s) => s.tasks);
  const projects = useOrbit((s) => s.projects);
  const dayItems = useOrbit((s) => s.dayItems);
  const { setNodeRef, isOver } = useDroppable({ id: 'tray' });
  const { suggestions } = useSuggestions();
  const [q, setQ] = useState('');
  const planned = useMemo(() => new Set(dayItems.filter((d) => d.date === date).map((d) => d.taskId)), [dayItems, date]);
  const rank = useMemo(() => new Map(suggestions.map((s, i) => [s.task.id, i])), [suggestions]);
  const list = useMemo(
    () =>
      tasks
        .filter((t) => t.status !== 'done' && !planned.has(t.id) && (!q || t.title.toLowerCase().includes(q.toLowerCase())))
        .sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999)),
    [tasks, planned, q, rank],
  );
  const pById = new Map(projects.map((p) => [p.id, p]));
  return (
    <div ref={setNodeRef} className={cx('flex h-full min-h-0 flex-col rounded-xl transition-colors', isOver && 'bg-danger-soft')}>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">Unplanned · best first</h2>
        {onClose && (
          <IconButton label="Close" size="xs" onClick={onClose}>
            <X size={14} />
          </IconButton>
        )}
      </div>
      <div className="relative mb-2">
        <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-faint" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a task" aria-label="Find an unplanned task" className="h-9 pl-8" />
      </div>
      {isOver && <p className="mb-2 text-xs text-danger">Drop here to take it off the day</p>}
      <ul className={cx('space-y-1.5 overflow-y-auto', compact ? 'max-h-72' : 'min-h-0 flex-1')}>
        {list.length === 0 && <li className="py-6 text-center text-xs text-faint">{q ? 'No matches' : 'Every open task is planned.'}</li>}
        {list.map((t) => (
          <TrayItem key={t.id} task={t} project={pById.get(t.projectId)} date={date} />
        ))}
      </ul>
    </div>
  );
}

function TrayItem({ task, project, date }: { task: Task; project: Project | undefined; date: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `task:${task.id}` });
  const planTask = useOrbit((s) => s.planTask);
  const hex = colorHex(project?.color ?? 'violet');
  return (
    <li ref={setNodeRef} className={cx('group flex items-center gap-2 rounded-xl border border-line bg-surface px-2 py-2', isDragging && 'opacity-30')}>
      <button {...attributes} {...listeners} aria-label={`Drag “${task.title}” onto the day`} className="cursor-grab touch-none text-faint hover:text-text active:cursor-grabbing">
        <GripVertical size={15} />
      </button>
      <span className="h-6 w-1 shrink-0 rounded-full" style={{ background: hex }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{task.title}</span>
        <span className="flex items-center gap-1.5 text-[11px] text-muted">
          {task.estimateMin && <span>{fmtMinutes(task.estimateMin)}</span>}
          <EnergyIcon energy={task.energy} size={12} />
          <PriorityBars priority={task.priority} />
          {task.status === 'parked' && <Pause size={11} className="text-amber" strokeWidth={3} />}
        </span>
      </span>
      <Menu
        label="Plan into slot"
        trigger={(p) => (
          <IconButton {...p} label="Add to a slot" size="xs" variant="secondary">
            <Plus size={14} />
          </IconButton>
        )}
        items={SLOTS.map((s) => ({ label: s.label, onSelect: () => planTask(task.id, date, s.id) }))}
      />
    </li>
  );
}
