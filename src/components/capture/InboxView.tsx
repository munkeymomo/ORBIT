import { useMemo, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { Archive, ArrowRight, CalendarPlus, ChevronDown, GripVertical, Inbox, Lightbulb, ListTodo, Mic, RotateCcw, Timer, Trash2 } from 'lucide-react';
import { useOrbit } from '../../store/store';
import type { Capture, DaySlot, Project } from '../../types';
import { colorHex } from '../../lib/colors';
import { useIsPhone } from '../../lib/hooks';
import { SLOTS, currentSlot, relativeTime } from '../../lib/util';
import { Button, EmptyState, Field, IconButton, Input, Modal, SectionTitle, Segmented, cx } from '../ui/primitives';
import { ProjectChip } from '../ui/visuals';
import { ProjectSelect } from '../task/TaskPanel';
import { useAbilities, useTakesTasks } from '../../host/useAbilities';

export function InboxView() {
  const captures = useOrbit((s) => s.captures);
  const takes = useTakesTasks();
  const allProjects = useOrbit((s) => s.projects);
  // only where a task can be filed (a host's systems per their caps)
  const projects = useMemo(() => allProjects.filter(takes), [allProjects, takes]);
  const { sortCapture, toast } = useOrbit.getActions();
  const phone = useIsPhone();
  const [sorting, setSorting] = useState<Capture | null>(null);
  const [dragging, setDragging] = useState<Capture | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);

  const inbox = useMemo(() => captures.filter((c) => c.status === 'inbox').sort((a, b) => b.createdAt - a.createdAt), [captures]);
  const dismissed = useMemo(() => captures.filter((c) => c.status === 'dismissed').sort((a, b) => b.updatedAt - a.updatedAt), [captures]);
  const sorted = useMemo(() => captures.filter((c) => c.status === 'sorted').sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 5), [captures]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }), useSensor(KeyboardSensor));

  const onDragEnd = (e: DragEndEvent) => {
    setDragging(null);
    const pid = e.over?.id ? String(e.over.id).replace('project:', '') : null;
    const cid = String(e.active.id).replace('capture:', '');
    if (!pid) return;
    const t = sortCapture(cid, { projectId: pid });
    const p = projects.find((x) => x.id === pid);
    if (t) toast({ tone: 'success', text: `Filed “${t.title}” in ${p?.name}.` });
  };

  return (
    <div className="h-full overflow-y-auto">
      <DndContext sensors={sensors} onDragStart={(e) => setDragging(inbox.find((c) => `capture:${c.id}` === e.active.id) ?? null)} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
        <div className={cx('mx-auto grid max-w-6xl gap-6 px-4 py-5 md:px-8 md:py-8', !phone && projects.length > 0 && inbox.length > 0 && 'lg:grid-cols-[minmax(0,1fr)_280px]')}>
          <div>
            {inbox.length === 0 ? (
              <EmptyState icon={<Inbox size={26} />} title="Inbox zero" action={<Button variant="primary" onClick={() => useOrbit.getActions().setCaptureOpen(true)}>Capture something</Button>}>
                Anything you capture without a project lands here, including thoughts parked during focus. Sort them when you have a moment.
              </EmptyState>
            ) : (
              <>
                {!phone && projects.length > 0 && <p className="mb-4 text-sm text-muted">Drag a card onto a project to file it, or use Sort for more options.</p>}
                <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {inbox.map((c) => (
                    <CaptureCard key={c.id} c={c} onSort={() => setSorting(c)} draggable={!phone && projects.length > 0} />
                  ))}
                </ul>
              </>
            )}

            {sorted.length > 0 && (
              <section className="mt-10">
                <SectionTitle>Recently sorted</SectionTitle>
                <ul className="space-y-1">
                  {sorted.map((c) => (
                    <SortedRow key={c.id} c={c} />
                  ))}
                </ul>
              </section>
            )}

            {dismissed.length > 0 && (
              <section className="mt-8">
                <button onClick={() => setShowDismissed((x) => !x)} aria-expanded={showDismissed} className="mb-2 flex items-center gap-1.5 text-xs font-semibold tracking-[0.08em] text-muted uppercase hover:text-text">
                  <ChevronDown size={14} className={cx('transition-transform', showDismissed && 'rotate-180')} />
                  Dismissed ({dismissed.length})
                </button>
                {showDismissed && (
                  <ul className="space-y-1">
                    {dismissed.map((c) => (
                      <DismissedRow key={c.id} c={c} />
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>

          {!phone && projects.length > 0 && inbox.length > 0 && (
            <aside className="lg:sticky lg:top-6 lg:self-start">
              <SectionTitle>Drop onto a project</SectionTitle>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                {projects.map((p) => (
                  <ProjectDrop key={p.id} p={p} active={!!dragging} />
                ))}
              </div>
            </aside>
          )}
        </div>
        <DragOverlay dropAnimation={null}>{dragging ? <CardBody c={dragging} overlay /> : null}</DragOverlay>
      </DndContext>
      {sorting && <SortDialog c={sorting} onClose={() => setSorting(null)} />}
    </div>
  );
}

function CardBody({ c, overlay }: { c: Capture; overlay?: boolean }) {
  const ctxTask = useOrbit((s) => (c.contextTaskId ? s.tasks.find((t) => t.id === c.contextTaskId) : null));
  const isThought = c.kind === 'thought';
  return (
    <div className={cx('rounded-2xl border p-4', isThought ? 'border-amber/25 bg-amber-soft' : 'border-line bg-surface', overlay && 'w-72 rotate-[-2deg] shadow-panel')}>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted uppercase">
        {isThought ? <Lightbulb size={13} className="text-amber" /> : <ListTodo size={13} className="text-accent-ink" />}
        {isThought ? 'Thought' : 'Task'}
      </div>
      <p className="text-[15px] leading-snug break-words whitespace-pre-wrap">{c.text}</p>
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11.5px] text-faint">
        <span>{relativeTime(c.createdAt, Date.now())}</span>
        {c.source === 'focus' && (
          <span className="inline-flex items-center gap-1" title={ctxTask ? `Captured while focusing on “${ctxTask.title}”` : 'Captured during focus'}>
            <Timer size={11} /> {ctxTask ? `during “${ctxTask.title.length > 24 ? `${ctxTask.title.slice(0, 23)}…` : ctxTask.title}”` : 'during focus'}
          </span>
        )}
        {c.source === 'voice' && (
          <span className="inline-flex items-center gap-1">
            <Mic size={11} /> voice
          </span>
        )}
        {c.example && <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-muted uppercase">Example</span>}
      </div>
    </div>
  );
}

function CaptureCard({ c, onSort, draggable }: { c: Capture; onSort: () => void; draggable: boolean }) {
  const { dismissCapture, toast, restoreCapture } = useOrbit.getActions();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: `capture:${c.id}`, disabled: !draggable });
  return (
    <li ref={setNodeRef} className={cx('group relative flex flex-col', isDragging && 'opacity-30')}>
      <div className="relative">
        {draggable && (
          <button {...listeners} {...attributes} aria-label={`Drag “${c.text}” onto a project`} className="absolute top-3 right-2 z-10 cursor-grab rounded-md p-1 text-faint opacity-0 group-hover:opacity-100 focus:opacity-100 active:cursor-grabbing">
            <GripVertical size={16} />
          </button>
        )}
        <div {...(draggable ? listeners : {})} className={draggable ? 'cursor-grab active:cursor-grabbing' : ''}>
          <CardBody c={c} />
        </div>
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <Button size="sm" variant="secondary" className="flex-1" icon={<ArrowRight size={14} />} onClick={onSort}>
          Sort
        </Button>
        <IconButton
          label="Dismiss"
          size="sm"
          variant="secondary"
          onClick={() => {
            dismissCapture(c.id);
            toast({ text: 'Dismissed.', action: { label: 'Undo', run: () => restoreCapture(c.id) } });
          }}
        >
          <Archive size={15} />
        </IconButton>
      </div>
    </li>
  );
}

function ProjectDrop({ p, active }: { p: Project; active: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `project:${p.id}` });
  const hex = colorHex(p.color);
  return (
    <div
      ref={setNodeRef}
      className={cx('flex h-12 items-center gap-2.5 rounded-xl border px-2.5 text-sm transition-all', isOver ? 'scale-[1.02]' : active ? 'border-dashed' : 'border-line bg-surface')}
      style={isOver ? { borderColor: hex, background: `${hex}22` } : active ? { borderColor: `${hex}70` } : undefined}
    >
      <ProjectChip color={p.color} icon={p.icon} size={28} />
      <span className="truncate font-medium">{p.name}</span>
    </div>
  );
}

function SortDialog({ c, onClose }: { c: Capture; onClose: () => void }) {
  const takes = useTakesTasks();
  const allProjects = useOrbit((s) => s.projects);
  const projects = useMemo(() => allProjects.filter(takes), [allProjects, takes]);
  const can = useAbilities();
  const { sortCapture, toast, select, createProject } = useOrbit.getActions();
  const [title, setTitle] = useState(c.text);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [slot, setSlot] = useState<DaySlot | 'none'>('none');
  const [newName, setNewName] = useState('');
  const submit = () => {
    let pid = projectId;
    if (!pid && newName.trim()) pid = createProject({ name: newName, x: 0, y: 0 }).id;
    if (!pid) return;
    const t = sortCapture(c.id, { projectId: pid, title: title.trim() || c.text, slot: slot === 'none' ? undefined : slot });
    onClose();
    if (t) toast({ tone: 'success', text: `Filed “${t.title}”.`, action: { label: 'Open', run: () => select({ type: 'task', id: t.id }) } });
  };
  return (
    <Modal
      open
      onClose={onClose}
      title="Sort into a project"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!projectId && !newName.trim()}>
            Create task
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Task title">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} />
        </Field>
        {projects.length || !can.personal ? (
          <Field label="Project">
            <ProjectSelect value={projectId} onChange={setProjectId} only={takes} />
          </Field>
        ) : (
          <Field label="New project" hint="You do not have any projects yet — name one to file this in.">
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Project name" />
          </Field>
        )}
        <Field group label="Plan for today?">
          <Segmented<DaySlot | 'none'>
            label="Plan for today"
            value={slot}
            onChange={setSlot}
            className="flex-wrap"
            options={[{ value: 'none', label: 'Not now' }, ...SLOTS.map((s) => ({ value: s.id, label: s.label }))]}
          />
        </Field>
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <CalendarPlus size={13} /> It is {SLOTS.find((s) => s.id === currentSlot(Date.now()))?.label.toLowerCase()} now.
        </p>
      </div>
    </Modal>
  );
}

function SortedRow({ c }: { c: Capture }) {
  const task = useOrbit((s) => (c.sortedTaskId ? s.tasks.find((t) => t.id === c.sortedTaskId) : null));
  const project = useOrbit((s) => (task ? s.projects.find((p) => p.id === task.projectId) : null));
  const select = useOrbit((s) => s.select);
  return (
    <li className="flex items-center gap-3 rounded-xl px-2 py-1.5 text-sm hover:bg-surface-2">
      {project ? <ProjectChip color={project.color} icon={project.icon} size={22} /> : <span className="w-[22px]" />}
      <span className="min-w-0 flex-1 truncate text-muted">{c.text}</span>
      {task ? (
        <button className="shrink-0 text-xs font-medium text-accent-ink hover:underline" onClick={() => select({ type: 'task', id: task.id })}>
          Open task
        </button>
      ) : (
        <span className="text-xs text-faint">task deleted</span>
      )}
    </li>
  );
}

function DismissedRow({ c }: { c: Capture }) {
  const { restoreCapture, deleteCapture } = useOrbit.getActions();
  return (
    <li className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm hover:bg-surface-2">
      <span className="min-w-0 flex-1 truncate text-muted">{c.text}</span>
      <IconButton label="Restore to inbox" size="xs" onClick={() => restoreCapture(c.id)}>
        <RotateCcw size={14} />
      </IconButton>
      <IconButton label="Delete for good" size="xs" onClick={() => deleteCapture(c.id)}>
        <Trash2 size={14} />
      </IconButton>
    </li>
  );
}
