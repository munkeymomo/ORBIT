import { useMemo, useState } from 'react';
import { ChartLine, Table2 } from 'lucide-react';
import { useOrbit } from '../../store/store';
import { actualMinutesByTask, completedByDay, focusMinutesByDay, lastNDays, projectStats } from '../../store/selectors';
import { colorHex } from '../../lib/colors';
import { fmtMinutes, fromDateKey, toDateKey } from '../../lib/util';
import { EmptyState, SectionTitle, Segmented, cx } from '../ui/primitives';
import { ProjectChip } from '../ui/visuals';
import { ColumnChart, EstimateScatter, axisMinutes } from './Charts';

const RANGES = [7, 14, 30] as const;

export function InsightsView() {
  const tasks = useOrbit((s) => s.tasks);
  const projects = useOrbit((s) => s.projects);
  const sessions = useOrbit((s) => s.sessions);
  const hasExample = useOrbit((s) => s.projects.some((p) => p.example) || s.sessions.some((x) => x.example));
  const [range, setRange] = useState<(typeof RANGES)[number]>(14);
  const [tables, setTables] = useState(false);
  const today = toDateKey(Date.now());

  const days = useMemo(() => lastNDays(range, today), [range, today]);
  const focusByDay = useMemo(() => focusMinutesByDay(sessions, days), [sessions, days]);
  const doneByDay = useMemo(() => completedByDay(tasks, days, projects), [tasks, days, projects]);
  const pName = useMemo(() => new Map(projects.map((p) => [p.id, p.name])), [projects]);

  const totalFocus = focusByDay.reduce((a, b) => a + b, 0);
  const totalDone = doneByDay.reduce((a, d) => a + d.total, 0);
  const rangeStart = fromDateKey(days[0]).getTime();
  const rangeSessions = sessions.filter((s) => s.kind === 'focus' && s.startedAt >= rangeStart && s.endedAt);
  const avgSession = rangeSessions.length ? rangeSessions.reduce((a, s) => a + s.activeMs, 0) / rangeSessions.length / 60000 : 0;

  const scatter = useMemo(() => {
    const actual = actualMinutesByTask(sessions);
    return tasks
      .filter((t) => t.status === 'done' && t.estimateMin && (actual.get(t.id) ?? 0) >= 1)
      .map((t) => ({ key: t.id, label: t.title, x: t.estimateMin!, y: Math.round(actual.get(t.id)!) }));
  }, [tasks, sessions]);
  const ratio = useMemo(() => {
    if (scatter.length < 3) return null;
    const r = scatter.map((d) => d.y / d.x).sort((a, b) => a - b);
    return r[Math.floor(r.length / 2)];
  }, [scatter]);

  const projRows = useMemo(
    () =>
      projects
        .map((p) => ({ p, s: projectStats(p.id, tasks, today) }))
        .filter((r) => r.s.total > 0)
        .sort((a, b) => b.s.progress - a.s.progress),
    [projects, tasks, today],
  );

  const history = useMemo(() => {
    const done = tasks.filter((t) => t.status === 'done' && t.completedAt).sort((a, b) => b.completedAt! - a.completedAt!);
    const groups: { date: string; items: typeof done }[] = [];
    for (const t of done.slice(0, 60)) {
      const d = toDateKey(t.completedAt!);
      const g = groups.find((x) => x.date === d);
      if (g) g.items.push(t);
      else groups.push({ date: d, items: [t] });
    }
    return groups;
  }, [tasks]);

  const tick = (d: string) => (range > 14 ? String(fromDateKey(d).getDate()) : fromDateKey(d).toLocaleDateString(undefined, { weekday: 'narrow' }));
  const label = (d: string) => fromDateKey(d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

  if (!tasks.length && !sessions.length)
    return (
      <EmptyState icon={<ChartLine size={26} />} title="Nothing to show yet">
        Complete tasks and run focus sessions; your progress, focus time and estimate accuracy will appear here. No streaks, no scores.
      </EmptyState>
    );

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-5 md:px-8 md:py-8">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<(typeof RANGES)[number]> label="Date range" value={range} onChange={setRange} size="sm" options={RANGES.map((r) => ({ value: r, label: `Last ${r} days` }))} />
          <button onClick={() => setTables((t) => !t)} aria-pressed={tables} className={cx('inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium', tables ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-surface-2 hover:text-text')}>
            <Table2 size={15} /> Tables
          </button>
          {hasExample && <span className="rounded-full bg-amber-soft px-2.5 py-1 text-xs font-medium text-amber">Includes example data</span>}
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Focus time" value={fmtMinutes(totalFocus)} />
          <Stat label="Tasks completed" value={String(totalDone)} />
          <Stat label="Focus sessions" value={String(rangeSessions.length)} />
          <Stat label="Average session" value={avgSession ? fmtMinutes(avgSession) : '—'} />
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card title="Focus time per day">
            {tables ? (
              <DayTable rows={days.map((d, i) => [label(d), fmtMinutes(focusByDay[i])])} head={['Day', 'Focus']} />
            ) : (
              <ColumnChart
                ariaLabel={`Focus time per day, last ${range} days`}
                color="var(--teal)"
                time
                axisFormat={axisMinutes}
                valueFormat={fmtMinutes}
                data={days.map((d, i) => ({ key: d, label: label(d), tick: tick(d), value: focusByDay[i] }))}
              />
            )}
          </Card>
          <Card title="Tasks completed per day">
            {tables ? (
              <DayTable rows={doneByDay.map((d) => [label(d.date), String(d.total)])} head={['Day', 'Completed']} />
            ) : (
              <ColumnChart
                ariaLabel={`Tasks completed per day, last ${range} days`}
                color="var(--accent)"
                integer
                axisFormat={(v) => String(v)}
                valueFormat={(v) => `${v} completed`}
                height={200}
                data={doneByDay.map((d) => ({ key: d.date, label: label(d.date), tick: tick(d.date), value: d.total, detail: d.byProject.map((b) => `${b.count} · ${pName.get(b.projectId) ?? 'Deleted project'}`) }))}
              />
            )}
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card title="Project progress" subtitle="Share of estimated work done (unestimated tasks count as 30 min)">
            {projRows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No tasks yet.</p>
            ) : (
              <ul className="space-y-3">
                {projRows.map(({ p, s }) => (
                  <li key={p.id} className="flex items-center gap-3">
                    <ProjectChip color={p.color} icon={p.icon} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <span className="truncate font-medium">{p.name}</span>
                        <span className="tabular shrink-0 text-xs text-muted">
                          {Math.round(s.progress * 100)}% · {s.done}/{s.total} tasks
                        </span>
                      </div>
                      <div className="mt-1.5 h-2 overflow-hidden rounded-full" style={{ background: `color-mix(in srgb, ${colorHex(p.color)} 18%, var(--surface-3))` }}>
                        <div className="h-full rounded-full" style={{ width: `${s.progress * 100}%`, background: colorHex(p.color) }} />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Estimated vs actual" subtitle="Completed tasks with an estimate and tracked focus time">
            {scatter.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">Finish a task that has an estimate and some focus time to see how estimates compare.</p>
            ) : tables ? (
              <DayTable rows={scatter.map((d) => [d.label, fmtMinutes(d.x), fmtMinutes(d.y)])} head={['Task', 'Estimate', 'Actual']} />
            ) : (
              <>
                <EstimateScatter ariaLabel="Estimated against actual minutes per completed task" color="var(--accent)" axisFormat={axisMinutes} valueFormat={fmtMinutes} data={scatter} />
                <p className="mt-2 text-sm text-muted">
                  {ratio == null
                    ? 'A few more finished tasks will show a pattern.'
                    : ratio > 1.15
                      ? `Typically tasks take about ${ratio.toFixed(1)}× their estimate. Worth padding estimates a little.`
                      : ratio < 0.85
                        ? `Typically tasks take about ${ratio.toFixed(1)}× their estimate — you tend to over-estimate.`
                        : 'Estimates are close to actual time, on the whole.'}{' '}
                  Points above the line took longer than estimated.
                </p>
              </>
            )}
          </Card>
        </div>

        <Card title="Completion history">
          {history.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">Completed tasks will be listed here.</p>
          ) : (
            <ol className="space-y-4">
              {history.map((g) => (
                <li key={g.date}>
                  <h4 className="mb-1.5 text-xs font-semibold text-muted">{label(g.date)}</h4>
                  <ul className="space-y-1">
                    {g.items.map((t) => {
                      const p = projects.find((x) => x.id === t.projectId);
                      return (
                        <li key={t.id}>
                          <button onClick={() => useOrbit.getActions().select({ type: 'task', id: t.id })} className="flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1 text-left text-sm hover:bg-surface-2">
                            <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: colorHex(p?.color ?? 'violet') }} />
                            <span className="min-w-0 flex-1 truncate">{t.title}</span>
                            <span className="shrink-0 text-xs text-muted">{p?.name}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 font-display text-[26px] leading-tight font-semibold">{value}</div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 md:p-5">
      <SectionTitle className="!mb-1">{title}</SectionTitle>
      {subtitle ? <p className="mb-3 text-xs text-faint">{subtitle}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

function DayTable({ rows, head }: { rows: string[][]; head: string[] }) {
  return (
    <div className="max-h-[260px] overflow-y-auto">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={cx('border-b border-line py-1.5 text-xs font-medium text-muted', i ? 'text-right' : 'text-left')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={k} className="border-b border-line last:border-0">
              {r.map((c, i) => (
                <td key={i} className={cx('py-1.5', i ? 'tabular text-right' : 'truncate')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
