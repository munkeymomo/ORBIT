import { useRef, useState } from 'react';
import { ChevronUp, CircleCheck, Coffee, Pause, Play, SquareParking, Square } from 'lucide-react';
import { useOrbit } from '../../store/store';
import { useAbilities } from '../../host/useAbilities';
import { mayWork } from '../../host/caps';
import { colorHex } from '../../lib/colors';
import { useNow } from '../../lib/hooks';
import { progressFraction } from '../../lib/timer';
import { relativeTime } from '../../lib/util';
import { Button, IconButton, Modal, cx } from '../ui/primitives';
import { ProgressRing } from '../ui/visuals';
import { TONE_COLOR, timerText, timerTone } from '../focus/TimerRing';
import { useDockData } from './Dock';
import { useSuggestions } from '../next/useSuggestions';

/**
 * Phone dock: a "now playing" strip. Swipe sideways to flip between the active
 * task and parked tasks; tap to open; the chevron opens the full dock sheet.
 */
export function MobileDock() {
  const focus = useOrbit((s) => s.focus);
  const parked = useDockData();
  const [index, setIndex] = useState(0);
  const [sheet, setSheet] = useState(false);
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; id: number } | null>(null);
  const slides = (focus ? 1 : 0) + parked.length || 1;
  const i = Math.min(index, slides - 1);

  const onDown = (e: React.PointerEvent) => {
    start.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };
  const onMove = (e: React.PointerEvent) => {
    if (!start.current || start.current.id !== e.pointerId) return;
    const d = e.clientX - start.current.x;
    if (Math.abs(d) > Math.abs(e.clientY - start.current.y)) setDx(d);
  };
  const onUp = () => {
    if (Math.abs(dx) > 48) setIndex(Math.max(0, Math.min(slides - 1, i + (dx < 0 ? 1 : -1))));
    setDx(0);
    start.current = null;
  };

  return (
    <>
      <div className="z-20 shrink-0 border-t border-line bg-surface/90 px-2 pt-2 pb-1.5 backdrop-blur-xl">
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1 overflow-hidden rounded-2xl" style={{ touchAction: 'pan-y' }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            <div className="flex transition-transform duration-200" style={{ transform: `translateX(calc(${-i * 100}% + ${dx}px))`, transitionDuration: dx ? '0ms' : undefined }}>
              {focus && (
                <div className="w-full shrink-0">
                  <ActiveSlide />
                </div>
              )}
              {parked.map((p) => (
                <div key={p.task.id} className="w-full shrink-0">
                  <ParkedSlide {...p} />
                </div>
              ))}
              {!focus && parked.length === 0 && (
                <div className="w-full shrink-0">
                  <IdleSlide />
                </div>
              )}
            </div>
          </div>
          <IconButton label="Open dock" variant="secondary" size="lg" className="!h-[52px] !w-11" onClick={() => setSheet(true)}>
            <ChevronUp size={20} />
          </IconButton>
        </div>
        {slides > 1 && (
          <div className="mt-1.5 flex justify-center gap-1.5" aria-hidden>
            {Array.from({ length: slides }, (_, k) => (
              <span key={k} className={cx('h-1.5 rounded-full transition-all', k === i ? 'w-4 bg-text/70' : 'w-1.5 bg-line-strong')} />
            ))}
          </div>
        )}
      </div>
      <DockSheet open={sheet} onClose={() => setSheet(false)} />
    </>
  );
}

function ActiveSlide() {
  const focus = useOrbit((s) => s.focus)!;
  const task = useOrbit((s) => (focus.taskId ? s.tasks.find((t) => t.id === focus.taskId) : null));
  const project = useOrbit((s) => (task ? s.projects.find((p) => p.id === task.projectId) : null));
  const { pauseFocus, resumeFocus, setView } = useOrbit.getActions();
  const now = useNow(500);
  const tone = timerTone(focus, now);
  const running = focus.runningSince != null;
  const frac = progressFraction(focus, now);
  const ringVal = focus.mode === 'flow' || focus.plannedMs == null ? frac : tone === 'over' ? 1 : 1 - frac;
  const isBreak = focus.kind !== 'focus';
  return (
    <div className={cx('flex h-[52px] items-center gap-2.5 rounded-2xl pr-1.5 pl-2', tone === 'over' ? 'bg-amber-soft' : isBreak ? 'bg-accent-soft' : 'bg-teal-soft')}>
      <button className="flex min-w-0 flex-1 items-center gap-2.5 text-left" onClick={() => setView('focus')}>
        <ProgressRing value={ringVal} size={38} stroke={3.5} color={TONE_COLOR[tone]}>
          {isBreak ? <Coffee size={14} className="text-accent-ink" /> : <span className="h-2 w-2 rounded-full" style={{ background: project ? colorHex(project.color) : TONE_COLOR[tone] }} />}
        </ProgressRing>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px] font-semibold">{isBreak ? 'Break' : (task?.title ?? 'Open focus')}</span>
          <span className="tabular block text-[12.5px] text-muted">
            <span className="font-display font-semibold" style={{ color: TONE_COLOR[tone] }}>
              {timerText(focus, now)}
            </span>
            {!running ? ' · paused' : tone === 'over' ? ' · overtime' : ''}
          </span>
        </span>
      </button>
      <IconButton label={running ? 'Pause' : 'Resume'} variant="secondary" size="md" onClick={running ? pauseFocus : resumeFocus} className="!h-11 !w-11">
        {running ? <Pause size={19} /> : <Play size={19} fill="currentColor" />}
      </IconButton>
    </div>
  );
}

function ParkedSlide({ task, cp, color }: ReturnType<typeof useDockData>[number]) {
  const openResume = useOrbit((s) => s.openResume);
  return (
    <button onClick={() => openResume(task.id)} className="flex h-[52px] w-full items-center gap-2.5 rounded-2xl bg-surface-2 pr-3 pl-2 text-left">
      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-amber-soft text-amber">
        <SquareParking size={18} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate text-[14px] font-semibold">{task.title}</span>
        </span>
        <span className="block truncate text-[12.5px] text-muted">{cp?.nextAction ? `→ ${cp.nextAction}` : `Parked ${relativeTime(task.parkedAt ?? Date.now(), Date.now())} · tap to resume`}</span>
      </span>
    </button>
  );
}

function IdleSlide() {
  const { suggestions } = useSuggestions();
  const top = suggestions[0]?.task;
  const { startFocus, openResume } = useOrbit.getActions();
  const can = useAbilities();
  return (
    <div className="flex h-[52px] items-center gap-2.5 rounded-2xl bg-surface-2 pr-1.5 pl-3">
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-semibold tracking-[0.1em] text-faint uppercase">Nothing in focus</span>
        <span className="block truncate text-[13px] text-muted">{top ? `Next: ${top.title}` : 'Tap + to capture something'}</span>
      </span>
      {top && mayWork(can, top.host) && (
        <Button variant="teal" size="md" className="!h-11" icon={<Play size={15} fill="currentColor" />} onClick={() => (top.status === 'parked' ? openResume(top.id) : startFocus({ taskId: top.id }))}>
          Start
        </Button>
      )}
    </div>
  );
}

function DockSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const focus = useOrbit((s) => s.focus);
  const task = useOrbit((s) => (s.focus?.taskId ? s.tasks.find((t) => t.id === s.focus!.taskId) : null));
  const parked = useDockData();
  const { openPark, completeTask, stopFocus, openResume, setCaptureOpen, setView } = useOrbit.getActions();
  const canCapture = useAbilities().personal;
  const act = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Modal open={open} onClose={onClose} title="Working memory">
      <div className="space-y-5">
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted uppercase">In focus</h3>
          {focus ? (
            <div className="space-y-3">
              <ActiveSlide />
              <div className="grid grid-cols-3 gap-2">
                {task && (
                  <Button variant="amber" size="lg" icon={<SquareParking size={17} />} onClick={act(() => openPark({ taskId: task.id }))}>
                    Park
                  </Button>
                )}
                {task && (
                  <Button variant="secondary" size="lg" icon={<CircleCheck size={17} />} onClick={act(() => completeTask(task.id))}>
                    Done
                  </Button>
                )}
                <Button variant="ghost" size="lg" icon={<Square size={15} />} onClick={act(() => stopFocus())} className={cx(!task && 'col-span-3')}>
                  Stop
                </Button>
              </div>
            </div>
          ) : (
            <IdleSlide />
          )}
        </section>
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-[0.08em] text-muted uppercase">Parked ({parked.length})</h3>
          {parked.length === 0 ? (
            <p className="text-sm text-muted">Park a task to keep your place while you switch.</p>
          ) : (
            <ul className="space-y-2">
              {parked.map((p) => (
                <li key={p.task.id}>
                  <button onClick={act(() => openResume(p.task.id))} className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl border border-line bg-surface-2 px-3 py-2 text-left">
                    <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: p.color }} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{p.task.title}</span>
                      <span className="block truncate text-[13px] text-muted">{p.cp?.nextAction ? `→ ${p.cp.nextAction}` : p.project}</span>
                    </span>
                    <Play size={16} className="text-teal" fill="currentColor" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="grid grid-cols-2 gap-2">
          {canCapture && (
            <Button variant="primary" size="lg" onClick={act(() => setCaptureOpen(true))}>
              Quick capture
            </Button>
          )}
          <Button variant="secondary" size="lg" onClick={act(() => setView('focus'))}>
            Open Focus
          </Button>
        </div>
      </div>
    </Modal>
  );
}
