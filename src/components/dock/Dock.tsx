import { useMemo } from 'react';
import { CircleCheck, Coffee, MoreHorizontal, Pause, Play, Plus, SquareParking, Square } from 'lucide-react';
import { useOrbit } from '../../store/store';
import { useAbilities } from '../../host/useAbilities';
import { mayWork } from '../../host/caps';
import type { Checkpoint, Task } from '../../types';
import { colorHex } from '../../lib/colors';
import { useNow } from '../../lib/hooks';
import { latestCheckpoints, parkedTasks } from '../../store/selectors';
import { relativeTime } from '../../lib/util';
import { progressFraction } from '../../lib/timer';
import { Button, IconButton, Menu, cx } from '../ui/primitives';
import { ProgressRing } from '../ui/visuals';
import { useSuggestions } from '../next/useSuggestions';
import { TONE_COLOR, timerText, timerTone } from '../focus/TimerRing';

export function useDockData() {
  const tasks = useOrbit((s) => s.tasks);
  const projects = useOrbit((s) => s.projects);
  const checkpoints = useOrbit((s) => s.checkpoints);
  return useMemo(() => {
    const cps = latestCheckpoints(checkpoints);
    const pById = new Map(projects.map((p) => [p.id, p]));
    return parkedTasks(tasks).map((t) => ({ task: t, cp: cps.get(t.id) ?? null, color: colorHex(pById.get(t.projectId)?.color ?? 'violet'), project: pById.get(t.projectId)?.name ?? '' }));
  }, [tasks, projects, checkpoints]);
}

/** Desktop/tablet working-memory strip: what is in focus, what is parked, and capture. */
export function Dock() {
  const parked = useDockData();
  const openResume = useOrbit((s) => s.openResume);
  const setCaptureOpen = useOrbit((s) => s.setCaptureOpen);
  const can = useAbilities();
  const MAX = 5;
  const shown = parked.slice(0, MAX);
  const overflow = parked.slice(MAX);

  return (
    <footer aria-label="Working memory dock" className="z-20 flex h-[76px] shrink-0 items-center gap-3 border-t border-line bg-surface/85 px-3 backdrop-blur-xl md:px-4">
      <NowSlot />
      <div className="h-10 w-px shrink-0 bg-line" />
      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
        <span className="hidden shrink-0 text-[11px] font-semibold tracking-[0.1em] text-faint uppercase xl:inline">Parked</span>
        {parked.length === 0 && <span className="truncate text-sm text-faint">Parked tasks wait here with your place saved.</span>}
        {shown.map(({ task, cp, color }, i) => (
          <ParkedChip key={task.id} task={task} cp={cp} color={color} hotkey={i === 0} onClick={() => openResume(task.id)} />
        ))}
        {overflow.length > 0 && (
          <Menu
            label="More parked tasks"
            align="right"
            trigger={(p) => (
              <Button {...p} size="sm" variant="secondary" icon={<MoreHorizontal size={15} />}>
                {overflow.length} more
              </Button>
            )}
            items={overflow.map(({ task }) => ({ label: task.title, icon: <SquareParking size={14} />, onSelect: () => openResume(task.id) }))}
          />
        )}
      </div>
      {can.personal && (
        <Button variant="secondary" onClick={() => setCaptureOpen(true)} icon={<Plus size={16} />} className="shrink-0" title="Capture (C)">
          <span className="hidden md:inline">Capture</span>
        </Button>
      )}
    </footer>
  );
}

function ParkedChip({ task, cp, color, hotkey, onClick }: { task: Task; cp: Checkpoint | null; color: string; hotkey: boolean; onClick: () => void }) {
  const sub = cp?.nextAction || cp?.stoppedAt || (task.parkedAt ? `parked ${relativeTime(task.parkedAt, Date.now())}` : 'parked');
  return (
    <button
      onClick={onClick}
      aria-label={`Resume “${task.title}”${cp?.nextAction ? `. Next: ${cp.nextAction}` : ''}`}
      title={`Resume “${task.title}”${cp?.nextAction ? `\nNext: ${cp.nextAction}` : ''}${hotkey ? '\nShortcut: R' : ''}`}
      className="group flex h-[52px] max-w-[230px] min-w-[150px] shrink items-center gap-2.5 rounded-xl border border-line bg-surface-2 py-1.5 pr-3 pl-1.5 text-left transition-colors hover:border-line-strong hover:bg-surface-3"
    >
      <span className="flex h-full w-1.5 shrink-0 rounded-full" style={{ background: color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{task.title}</span>
        <span className="block truncate text-[11.5px] text-muted">{cp?.nextAction ? `→ ${sub}` : sub}</span>
      </span>
      <Play size={14} className="shrink-0 text-faint group-hover:text-teal" fill="currentColor" />
    </button>
  );
}

function NowSlot() {
  const focus = useOrbit((s) => s.focus);
  const task = useOrbit((s) => (s.focus?.taskId ? s.tasks.find((t) => t.id === s.focus!.taskId) : null));
  const project = useOrbit((s) => (task ? s.projects.find((p) => p.id === task.projectId) : null));
  const { pauseFocus, resumeFocus, openPark, completeTask, setView, stopFocus, startFocus } = useOrbit.getActions();
  const now = useNow(focus ? 500 : null);
  const { suggestions } = useSuggestions();
  const top = suggestions[0]?.task;
  const can = useAbilities();

  if (!focus) {
    return (
      <div className="flex w-[300px] shrink-0 items-center gap-3 lg:w-[360px]">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border-2 border-dashed border-line-strong text-faint">
          <Play size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] font-semibold tracking-[0.1em] text-faint uppercase">Nothing in focus</span>
          {top ? <span className="block truncate text-sm text-muted">Next: {top.title}</span> : <span className="block truncate text-sm text-muted">Capture or create a task to begin</span>}
        </span>
        {top && mayWork(can, top.host) && (
          <Button size="sm" variant="teal" icon={<Play size={13} fill="currentColor" />} onClick={() => (top.status === 'parked' ? useOrbit.getActions().openResume(top.id) : startFocus({ taskId: top.id }))}>
            Start
          </Button>
        )}
      </div>
    );
  }

  const tone = timerTone(focus, now);
  const running = focus.runningSince != null;
  const isBreak = focus.kind !== 'focus';
  const color = TONE_COLOR[tone];
  const frac = progressFraction(focus, now);
  const ringVal = focus.mode === 'flow' || focus.plannedMs == null ? frac : tone === 'over' ? 1 : 1 - frac;

  return (
    <div className={cx('flex w-[300px] shrink-0 items-center gap-3 rounded-2xl py-1.5 pr-1.5 pl-1.5 lg:w-[400px]', tone === 'over' ? 'bg-amber-soft' : isBreak ? 'bg-accent-soft' : 'bg-teal-soft')}>
      <button onClick={() => setView('focus')} className="flex min-w-0 flex-1 items-center gap-3 text-left" title="Open Focus">
        <ProgressRing value={ringVal} size={46} stroke={4} color={color} label="Timer progress">
          {isBreak ? <Coffee size={16} className="text-accent-ink" /> : <span className="h-2.5 w-2.5 rounded-full" style={{ background: project ? colorHex(project.color) : color }} />}
        </ProgressRing>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-semibold">{isBreak ? (focus.kind === 'long-break' ? 'Long break' : 'Short break') : (task?.title ?? 'Open focus')}</span>
          <span className="tabular flex items-center gap-1.5 text-[12.5px] text-muted">
            <span className="font-display text-[15px] font-semibold" style={{ color }}>
              {timerText(focus, now)}
            </span>
            {!running ? '· paused' : tone === 'over' ? '· overtime' : focus.mode === 'flow' ? '· flow' : ''}
          </span>
        </span>
      </button>
      <IconButton label={running ? 'Pause (Space)' : 'Resume (Space)'} size="md" variant="secondary" onClick={running ? pauseFocus : resumeFocus}>
        {running ? <Pause size={17} /> : <Play size={17} fill="currentColor" />}
      </IconButton>
      {task ? (
        <>
          <IconButton label="Park (P)" size="md" variant="amber" onClick={() => openPark({ taskId: task.id })}>
            <SquareParking size={18} />
          </IconButton>
          <IconButton label="Complete (X)" size="md" variant="secondary" onClick={() => completeTask(task.id)}>
            <CircleCheck size={18} />
          </IconButton>
        </>
      ) : (
        <IconButton label={isBreak ? 'End break' : 'Stop'} size="md" variant="secondary" onClick={() => stopFocus()}>
          <Square size={15} />
        </IconButton>
      )}
    </div>
  );
}

