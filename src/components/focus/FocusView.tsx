import { useMemo, useState } from 'react';
import { CircleCheck, Coffee, Infinity as InfinityIcon, Pause, Play, Plus, Send, SquareParking, Square, Timer } from 'lucide-react';
import { useOrbit } from '../../store/store';
import type { TimerMode } from '../../types';
import { useNow } from '../../lib/hooks';
import { isOvertime } from '../../lib/timer';
import { fmtMinutes, fmtTimeOfDay, toDateKey } from '../../lib/util';
import { Button, Field, Input, SectionTitle, Segmented, Select, Textarea, cx } from '../ui/primitives';
import { ProjectChip } from '../ui/visuals';
import { useDraft } from '../task/actions';
import { useSuggestions } from '../next/useSuggestions';
import { TimerRing, timerText, timerTone } from './TimerRing';

const PRESETS = [15, 25, 45, 60];

export function FocusView() {
  const focus = useOrbit((s) => s.focus);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-6 md:px-8 lg:grid-cols-[minmax(0,1fr)_360px] lg:py-10">
        <div className="flex flex-col items-center">{focus ? <LiveTimer /> : <Setup />}</div>
        <aside className="space-y-6">
          {focus && focus.kind === 'focus' && <DistractionCapture />}
          {focus && focus.kind === 'focus' && <SessionNotes />}
          <TodaySessions />
        </aside>
      </div>
    </div>
  );
}

/* ---------------- running session ---------------- */

function LiveTimer() {
  const focus = useOrbit((s) => s.focus)!;
  const task = useOrbit((s) => (focus.taskId ? s.tasks.find((t) => t.id === focus.taskId) : null));
  const project = useOrbit((s) => (task ? s.projects.find((p) => p.id === task.projectId) : null));
  const cp = useOrbit((s) => (focus.fromCheckpointId ? s.checkpoints.find((c) => c.id === focus.fromCheckpointId) : null));
  const prefs = useOrbit((s) => s.prefs);
  const cycle = useOrbit((s) => s.cycle);
  const { pauseFocus, resumeFocus, stopFocus, extendFocus, openPark, completeTask, startBreak, select } = useOrbit.getActions();
  const now = useNow(250);
  const tone = timerTone(focus, now);
  const running = focus.runningSince != null;
  const over = isOvertime(focus, now);
  const isBreak = focus.kind !== 'focus';
  const label = isBreak ? (focus.kind === 'long-break' ? 'Long break' : 'Short break') : focus.mode === 'flow' ? 'Flow' : over ? 'Overtime' : running ? 'Focus' : 'Paused';
  const nextBreak = (cycle + 1) % prefs.longBreakEvery === 0 ? 'long-break' : 'short-break';

  return (
    <div className="anim-fade flex w-full max-w-xl flex-col items-center">
      {task ? (
        <button onClick={() => select({ type: 'task', id: task.id })} className="mb-6 flex max-w-full items-center gap-3 rounded-2xl px-3 py-2 text-left hover:bg-surface-2">
          {project && <ProjectChip color={project.color} icon={project.icon} size={36} />}
          <span className="min-w-0">
            <span className="block truncate text-xs text-muted">{project?.name}</span>
            <span className="block truncate font-display text-xl font-semibold">{task.title}</span>
          </span>
        </button>
      ) : (
        <p className="mb-6 font-display text-xl font-semibold">{isBreak ? 'Step away for a moment' : 'Open focus'}</p>
      )}

      <TimerRing rt={focus} now={now} size={Math.min(320, window.innerWidth - 48)}>
        <span className={cx('mb-1 text-xs font-semibold tracking-[0.14em] uppercase', tone === 'over' ? 'text-amber' : tone === 'break' ? 'text-accent-ink' : tone === 'paused' ? 'text-muted' : 'text-teal')}>{label}</span>
        <span className="tabular font-display text-[64px] leading-none font-semibold tracking-tight" aria-label={`Timer ${timerText(focus, now)}`}>
          {timerText(focus, now)}
        </span>
        {focus.plannedMs != null && <span className="mt-2 text-xs text-muted">of {fmtMinutes(focus.plannedMs / 60000)}{focus.baseMs > 0 ? ' · continued' : ''}</span>}
        {focus.mode === 'flow' && <span className="mt-2 text-xs text-muted">counting up</span>}
      </TimerRing>
      <span className="sr-only" aria-live="assertive">
        {over ? (isBreak ? 'Break is over' : 'Focus time is up') : ''}
      </span>

      {over && !isBreak && (
        <div className="anim-pop mt-6 w-full rounded-2xl border border-amber/40 bg-amber-soft p-4 text-center">
          <p className="font-medium">Time is up — keep going if you are in the zone.</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => extendFocus(5)}>
              5 min
            </Button>
            <Button size="sm" variant="secondary" icon={<Plus size={14} />} onClick={() => extendFocus(15)}>
              15 min
            </Button>
            <Button size="sm" variant="secondary" icon={<Coffee size={14} />} onClick={() => startBreak(nextBreak)}>
              {nextBreak === 'long-break' ? `Long break · ${prefs.longBreakMin}m` : `Break · ${prefs.shortBreakMin}m`}
            </Button>
          </div>
        </div>
      )}
      {over && isBreak && (
        <div className="anim-pop mt-6 w-full rounded-2xl border border-accent/40 bg-accent-soft p-4 text-center">
          <p className="font-medium">Break is over. Ready when you are.</p>
          <BackToWork />
        </div>
      )}

      <div className="mt-7 flex flex-wrap items-center justify-center gap-2.5">
        <Button variant={running ? 'secondary' : 'teal'} size="lg" icon={running ? <Pause size={18} /> : <Play size={18} fill="currentColor" />} onClick={running ? pauseFocus : resumeFocus} className="min-w-[132px]">
          {running ? 'Pause' : 'Resume'}
        </Button>
        {task && (
          <>
            <Button variant="amber" size="lg" icon={<SquareParking size={18} />} onClick={() => openPark({ taskId: task.id })}>
              Park
            </Button>
            <Button variant="secondary" size="lg" icon={<CircleCheck size={18} />} onClick={() => completeTask(task.id)}>
              Complete
            </Button>
          </>
        )}
        <Button variant="ghost" size="lg" icon={<Square size={16} />} onClick={() => stopFocus()}>
          {isBreak ? 'End break' : 'Stop'}
        </Button>
      </div>

      {cp && (cp.nextAction || cp.stoppedAt) && !isBreak && (
        <div className="mt-8 w-full rounded-2xl border border-line bg-surface p-4 text-sm">
          <p className="mb-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">Picking up from your checkpoint</p>
          {cp.nextAction && <p className="font-semibold">Next: {cp.nextAction}</p>}
          {cp.stoppedAt && <p className="mt-1 text-muted">Stopped at: {cp.stoppedAt}</p>}
        </div>
      )}
      <p className="mt-6 hidden text-xs text-faint md:block">Space pauses · P parks · X completes</p>
    </div>
  );
}

function BackToWork() {
  const lastTaskId = useOrbit((s) => s.lastFocusEnd?.taskId ?? null);
  const sessions = useOrbit((s) => s.sessions);
  const tasks = useOrbit((s) => s.tasks);
  const { startFocus, resumeTask, stopFocus } = useOrbit.getActions();
  // The task of the most recent focus session before this break.
  const prev = useMemo(() => {
    const id = lastTaskId ?? [...sessions].reverse().find((s) => s.kind === 'focus' && s.taskId)?.taskId;
    return id ? tasks.find((t) => t.id === id && t.status !== 'done') : undefined;
  }, [lastTaskId, sessions, tasks]);
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-2">
      {prev && (
        <Button size="sm" variant="teal" icon={<Play size={14} fill="currentColor" />} onClick={() => (prev.status === 'parked' ? resumeTask(prev.id, 'fresh') : startFocus({ taskId: prev.id }))}>
          Back to “{prev.title.length > 28 ? `${prev.title.slice(0, 27)}…` : prev.title}”
        </Button>
      )}
      <Button size="sm" variant="secondary" onClick={() => stopFocus('finished')}>
        End break
      </Button>
    </div>
  );
}

/* ---------------- setup ---------------- */

function Setup() {
  const tasks = useOrbit((s) => s.tasks);
  const projects = useOrbit((s) => s.projects);
  const prefs = useOrbit((s) => s.prefs);
  const last = useOrbit((s) => s.lastFocusEnd);
  const { startFocus, startBreak, dismissLastFocusEnd, openResume } = useOrbit.getActions();
  const { suggestions } = useSuggestions();
  const top = suggestions[0]?.task;
  const [taskId, setTaskId] = useState<string>(() => last?.taskId ?? top?.id ?? '');
  const [minutes, setMinutes] = useState(prefs.focusMin);
  const [custom, setCustom] = useState('');
  const [mode, setMode] = useState<TimerMode>('countdown');
  const open = tasks.filter((t) => t.status !== 'done');
  const chosen = tasks.find((t) => t.id === taskId);
  const longNext = last && last.cycle > 0 && last.cycle % prefs.longBreakEvery === 0;

  const start = () => {
    const m = custom ? Math.max(1, Math.min(480, Number(custom) || prefs.focusMin)) : minutes;
    if (chosen?.status === 'parked') {
      openResume(chosen.id);
      return;
    }
    startFocus({ taskId: taskId || null, minutes: m, mode });
  };

  return (
    <div className="anim-fade w-full max-w-xl">
      {last && (
        <div className="mb-6 rounded-2xl border border-teal/40 bg-teal-soft p-4">
          <p className="font-medium">{last.completedCountdown ? 'Nice — a full session done.' : 'Session ended.'} Want a break?</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant={longNext ? 'secondary' : 'teal'} icon={<Coffee size={14} />} onClick={() => startBreak('short-break')}>
              Short break · {prefs.shortBreakMin}m
            </Button>
            <Button size="sm" variant={longNext ? 'teal' : 'secondary'} icon={<Coffee size={14} />} onClick={() => startBreak('long-break')}>
              Long break · {prefs.longBreakMin}m
            </Button>
            <Button size="sm" variant="ghost" onClick={dismissLastFocusEnd}>
              No thanks
            </Button>
          </div>
          {longNext && <p className="mt-2 text-xs text-muted">You have done {last.cycle} full sessions — a longer break is suggested.</p>}
        </div>
      )}

      <div className="rounded-3xl border border-line bg-surface p-5 shadow-panel md:p-7">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-soft text-teal">
            <Timer size={22} />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold">Start a focus session</h2>
            <p className="text-sm text-muted">The timer survives reloads and sleep. You will never be forced to stop.</p>
          </div>
        </div>

        <div className="space-y-5">
          <Field label="What are you working on?" hint={top && taskId === top.id ? 'Suggested by What next? — change it if you like.' : undefined}>
            <Select value={taskId} onChange={(e) => setTaskId(e.target.value)}>
              <option value="">No specific task (open focus)</option>
              {projects.map((p) => {
                const ts = open.filter((t) => t.projectId === p.id);
                if (!ts.length) return null;
                return (
                  <optgroup key={p.id} label={p.name}>
                    {ts.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                        {t.status === 'parked' ? ' (parked)' : ''}
                      </option>
                    ))}
                  </optgroup>
                );
              })}
            </Select>
          </Field>

          <Field group label="Mode">
            <Segmented<TimerMode>
              label="Timer mode"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'countdown', label: <><Timer size={15} /> Countdown</> },
                { value: 'flow', label: <><InfinityIcon size={15} /> Flow (count up)</> },
              ]}
            />
          </Field>

          {mode === 'countdown' && (
            <Field group label="Length">
              <div className="flex flex-wrap items-center gap-2">
                {PRESETS.map((m) => (
                  <button
                    key={m}
                    onClick={() => {
                      setMinutes(m);
                      setCustom('');
                    }}
                    aria-pressed={!custom && minutes === m}
                    className={cx('h-11 min-w-[64px] rounded-xl border px-3 font-display text-base font-semibold transition-colors', !custom && minutes === m ? 'border-teal bg-teal-soft text-teal' : 'border-line bg-surface-2 text-muted hover:text-text')}
                  >
                    {m}m
                  </button>
                ))}
                <Input type="number" inputMode="numeric" min={1} max={480} value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="Custom" aria-label="Custom minutes" className="!h-11 !w-28" />
              </div>
            </Field>
          )}

          <Button variant="teal" size="lg" className="w-full" icon={<Play size={18} fill="currentColor" />} onClick={start}>
            {chosen?.status === 'parked' ? 'Resume parked task' : 'Start'}
          </Button>
          <div className="flex justify-center gap-2 text-sm">
            <Button variant="ghost" size="sm" icon={<Coffee size={14} />} onClick={() => startBreak('short-break')}>
              Short break
            </Button>
            <Button variant="ghost" size="sm" icon={<Coffee size={14} />} onClick={() => startBreak('long-break')}>
              Long break
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- side panels ---------------- */

function DistractionCapture() {
  const captureDistraction = useOrbit((s) => s.captureDistraction);
  const count = useOrbit((s) => s.sessions.find((x) => x.id === s.focus?.sessionId)?.distractions ?? 0);
  const [text, setText] = useState('');
  const [flash, setFlash] = useState(false);
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <SectionTitle right={count > 0 ? <span className="text-xs text-muted">{count} captured</span> : null}>Park a stray thought</SectionTitle>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          captureDistraction(text);
          setText('');
          setFlash(true);
          setTimeout(() => setFlash(false), 1200);
        }}
        className="flex gap-2"
      >
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="It goes to your Inbox — stay here" aria-label="Capture a distraction" />
        <Button type="submit" variant="secondary" disabled={!text.trim()} aria-label="Send to inbox" className="!px-3">
          <Send size={16} />
        </Button>
      </form>
      <p className={cx('mt-2 text-xs transition-opacity', flash ? 'text-teal opacity-100' : 'opacity-0')} aria-live="polite">
        {flash ? 'Saved to Inbox.' : ''}
      </p>
    </section>
  );
}

function SessionNotes() {
  const sessionId = useOrbit((s) => s.focus?.sessionId);
  const notesVal = useOrbit((s) => s.sessions.find((x) => x.id === sessionId)?.notes ?? '');
  const setSessionNotes = useOrbit((s) => s.setSessionNotes);
  const notes = useDraft(notesVal, setSessionNotes);
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <SectionTitle>Session notes</SectionTitle>
      <Textarea value={notes.value} onChange={(e) => notes.onChange(e.target.value)} onBlur={notes.flush} rows={5} placeholder="Working notes for this session. They are kept with the session and shown on the task." />
    </section>
  );
}

function TodaySessions() {
  const sessions = useOrbit((s) => s.sessions);
  const tasks = useOrbit((s) => s.tasks);
  const today = toDateKey(Date.now());
  const list = useMemo(() => sessions.filter((s) => toDateKey(s.startedAt) === today && s.endedAt).sort((a, b) => b.startedAt - a.startedAt), [sessions, today]);
  const focusMin = list.filter((s) => s.kind === 'focus').reduce((a, s) => a + s.activeMs / 60000, 0);
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <SectionTitle right={focusMin > 0 ? <span className="tabular text-xs text-muted">{fmtMinutes(focusMin)} focused</span> : null}>Today’s sessions</SectionTitle>
      {list.length === 0 ? (
        <p className="py-2 text-sm text-muted">Finished sessions appear here.</p>
      ) : (
        <ul className="divide-y divide-line text-sm">
          {list.map((s) => {
            const t = s.taskId ? tasks.find((x) => x.id === s.taskId) : null;
            return (
              <li key={s.id} className="flex items-center gap-3 py-2">
                <span className="tabular w-12 text-xs text-muted">{fmtTimeOfDay(s.startedAt)}</span>
                <span className="min-w-0 flex-1 truncate">{s.kind === 'focus' ? (t?.title ?? (s.taskId ? 'Deleted task' : 'Open focus')) : s.kind === 'long-break' ? 'Long break' : 'Break'}</span>
                <span className="tabular text-xs font-medium">{fmtMinutes(s.activeMs / 60000)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
