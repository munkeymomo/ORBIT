import { useState } from 'react';
import { ChevronDown, Compass, Lock, Play } from 'lucide-react';
import { useOrbit } from '../../store/store';
import { useAbilities } from '../../host/useAbilities';
import { mayWork } from '../../host/caps';
import type { Energy } from '../../types';
import type { Reason, Suggestion } from '../../lib/scoring';
import { fmtMinutes } from '../../lib/util';
import { Button, EmptyState, Segmented, cx } from '../ui/primitives';
import { ENERGY_META, ProjectChip } from '../ui/visuals';
import { PlanTodayButton, StartFocusButton } from '../task/actions';
import { useSuggestions } from './useSuggestions';

const TIMES = [15, 30, 45, 60, 90, 120];

export function NextView() {
  const prefs = useOrbit((s) => s.prefs);
  const { setNextContext } = useOrbit.getActions();
  const { suggestions, blocked } = useSuggestions();
  const [rules, setRules] = useState(false);
  const top = suggestions[0];
  const rest = suggestions.slice(1, 10);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-5 md:px-8 md:py-8">
        <div className="mb-6 flex flex-wrap items-end gap-x-6 gap-y-4">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Time available</p>
            <Segmented<number> label="Time available" value={prefs.nextMinutes} onChange={(minutes) => setNextContext({ minutes })} size="sm" options={TIMES.map((m) => ({ value: m, label: m >= 120 ? '2h+' : fmtMinutes(m) }))} />
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted">Energy right now</p>
            <Segmented<Energy>
              label="Energy right now"
              value={prefs.nextEnergy}
              onChange={(energy) => setNextContext({ energy })}
              size="sm"
              options={(['low', 'medium', 'high'] as Energy[]).map((e) => {
                const M = ENERGY_META[e];
                return { value: e, label: <><M.Icon size={14} className={M.cls} /> {e[0].toUpperCase() + e.slice(1)}</> };
              })}
            />
          </div>
        </div>

        {!top ? (
          <EmptyState icon={<Compass size={26} />} title="Nothing to suggest yet">
            {blocked.length ? 'Every open task is waiting on something else — see below.' : 'Add a few tasks and ORBIT will rank them by urgency, importance, energy and the time you have.'}
          </EmptyState>
        ) : (
          <>
            <TopPick s={top} />
            {rest.length > 0 && (
              <section className="mt-8">
                <h2 className="mb-3 text-xs font-semibold tracking-[0.08em] text-muted uppercase">Also good</h2>
                <ol className="space-y-2">
                  {rest.map((s, i) => (
                    <Row key={s.task.id} s={s} rank={i + 2} max={top.score} />
                  ))}
                </ol>
              </section>
            )}
          </>
        )}

        {blocked.length > 0 && (
          <section className="mt-8">
            <h2 className="mb-3 flex items-center gap-1.5 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
              <Lock size={13} /> Waiting on something
            </h2>
            <ul className="space-y-1.5">
              {blocked.map(({ task, blockers }) => (
                <li key={task.id} className="rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm">
                  <button className="font-medium hover:underline" onClick={() => useOrbit.getActions().select({ type: 'task', id: task.id })}>
                    {task.title}
                  </button>
                  <span className="text-muted"> waits on </span>
                  {blockers.map((b, i) => (
                    <span key={b.id}>
                      <button className="text-accent-ink hover:underline" onClick={() => useOrbit.getActions().select({ type: 'task', id: b.id })}>
                        {b.title}
                      </button>
                      {i < blockers.length - 1 ? ', ' : ''}
                    </span>
                  ))}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="mt-10 rounded-2xl border border-line bg-surface/60 p-4">
          <button onClick={() => setRules((r) => !r)} aria-expanded={rules} className="flex w-full items-center justify-between text-sm font-medium">
            How suggestions are worked out
            <ChevronDown size={16} className={cx('transition-transform', rules && 'rotate-180')} />
          </button>
          {rules && (
            <div className="anim-fade mt-3 grid gap-x-6 gap-y-1.5 text-[13px] text-muted sm:grid-cols-2">
              {[
                ['Overdue', '+40'],
                ['Due today / tomorrow / this week', '+30 / +20 / +10'],
                ['Critical / high / normal priority', '+30 / +20 / +8'],
                ['Parked with a next action / without', '+15 / +8'],
                ['Fits your available time', '+10'],
                ['Needs more than 1.5× your time', '−15'],
                ['Quick win (15 min or less)', '+5'],
                ['Matches your energy / easier', '+10 / +3'],
                ['Needs more energy than you have', '−20 per level'],
                ['On today’s plan', '+12'],
                ['Already part done', '+6'],
                ['Unblocks other tasks', '+5 each, up to +15'],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 border-b border-line py-1.5">
                  <span>{k}</span>
                  <span className="tabular font-medium text-text">{v}</span>
                </div>
              ))}
              <p className="pt-2 sm:col-span-2">Tasks waiting on unfinished dependencies are never suggested. No AI service is involved: the same inputs always give the same order.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ReasonChip({ r }: { r: Reason }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs', r.points > 0 ? 'bg-teal-soft text-teal' : r.points < 0 ? 'bg-danger-soft text-danger' : 'bg-surface-3 text-muted')}>
      <span className="tabular font-semibold">{r.points > 0 ? `+${r.points}` : r.points}</span>
      {r.text}
    </span>
  );
}

function TopPick({ s }: { s: Suggestion }) {
  const project = useOrbit((st) => st.projects.find((p) => p.id === s.task.projectId));
  const { openResume, select } = useOrbit.getActions();
  return (
    <article className="anim-fade relative overflow-hidden rounded-3xl border border-line-strong bg-surface p-5 shadow-panel md:p-6">
      <div className="pointer-events-none absolute -top-24 -right-24 h-64 w-64 rounded-full bg-accent/15 blur-3xl" aria-hidden />
      <p className="mb-3 text-xs font-semibold tracking-[0.1em] text-accent-ink uppercase">Suggested next</p>
      <div className="flex items-start gap-3">
        {project && <ProjectChip color={project.color} icon={project.icon} size={40} />}
        <div className="min-w-0">
          <button onClick={() => select({ type: 'task', id: s.task.id })} className="text-left font-display text-2xl leading-tight font-semibold hover:underline">
            {s.task.title}
          </button>
          <p className="mt-0.5 text-sm text-muted">
            {project?.name}
            {s.task.estimateMin ? ` · ~${fmtMinutes(s.task.estimateMin)}` : ''}
          </p>
        </div>
      </div>
      <div className="mt-4">
        <p className="mb-2 text-xs text-muted">Why this one</p>
        <div className="flex flex-wrap gap-1.5">
          {s.reasons.map((r) => (
            <ReasonChip key={r.rule + r.text} r={r} />
          ))}
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {s.task.status === 'parked' ? (
          <Button variant="teal" size="lg" icon={<Play size={16} fill="currentColor" />} onClick={() => openResume(s.task.id)}>
            Resume where you left off
          </Button>
        ) : (
          <StartFocusButton taskId={s.task.id} size="lg" label="Start now" onStarted={() => useOrbit.getActions().setView('focus')} />
        )}
        <PlanTodayButton taskId={s.task.id} />
      </div>
    </article>
  );
}

function Row({ s, rank, max }: { s: Suggestion; rank: number; max: number }) {
  const project = useOrbit((st) => st.projects.find((p) => p.id === s.task.projectId));
  const { select, startFocus, openResume } = useOrbit.getActions();
  const can = useAbilities();
  const [open, setOpen] = useState(false);
  const pct = max > 0 ? Math.max(4, Math.min(100, (s.score / max) * 100)) : 4;
  return (
    <li className="rounded-2xl border border-line bg-surface">
      <div className="flex items-center gap-3 px-3.5 py-3">
        <span className="tabular w-5 text-center text-sm font-semibold text-faint">{rank}</span>
        {project && <ProjectChip color={project.color} icon={project.icon} size={30} />}
        <button className="min-w-0 flex-1 text-left" onClick={() => select({ type: 'task', id: s.task.id })}>
          <span className="block truncate text-[14.5px] font-medium">{s.task.title}</span>
          <span className="mt-1 flex items-center gap-2">
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-3" aria-hidden>
              <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </span>
            <span className="truncate text-xs text-muted">{s.reasons.filter((r) => r.points > 0).slice(0, 2).map((r) => r.text).join(' · ') || 'No strong signals'}</span>
          </span>
        </button>
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="rounded-lg px-2 py-1 text-xs font-medium text-muted hover:bg-surface-2 hover:text-text">
          Why?
        </button>
        {mayWork(can, s.task.host) && (
          <Button size="sm" variant="secondary" icon={<Play size={13} fill="currentColor" />} onClick={() => (s.task.status === 'parked' ? openResume(s.task.id) : startFocus({ taskId: s.task.id }))} aria-label={`Start ${s.task.title}`}>
            <span className="hidden sm:inline">{s.task.status === 'parked' ? 'Resume' : 'Start'}</span>
          </Button>
        )}
      </div>
      {open && (
        <div className="anim-fade flex flex-wrap gap-1.5 border-t border-line px-3.5 py-3">
          {s.reasons.map((r) => (
            <ReasonChip key={r.rule + r.text} r={r} />
          ))}
          <span className="tabular ml-auto self-center text-xs text-muted">Total {s.score}</span>
        </div>
      )}
    </li>
  );
}
