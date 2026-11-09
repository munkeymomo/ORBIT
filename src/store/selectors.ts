import type { Checkpoint, FocusSession, Project, Task } from '../types';
import { taskProgress } from '../lib/scoring';
import { addDays, daysBetween, toDateKey } from '../lib/util';

/** Pure derivations. Components call these inside useMemo, never inside a store selector. */

export function latestCheckpoints(checkpoints: Checkpoint[]): Map<string, Checkpoint> {
  const m = new Map<string, Checkpoint>();
  for (const c of checkpoints) {
    const prev = m.get(c.taskId);
    if (!prev || c.createdAt > prev.createdAt) m.set(c.taskId, c);
  }
  return m;
}

export interface ProjectStats {
  total: number;
  open: number;
  done: number;
  parked: number;
  overdue: number;
  /** 0..1, weighted by estimate (unestimated tasks count as 30 min). */
  progress: number;
  openEffortMin: number;
}

const DEFAULT_WEIGHT = 30;

export function projectStats(projectId: string, tasks: Task[], todayKey: string): ProjectStats {
  let total = 0,
    open = 0,
    done = 0,
    parked = 0,
    overdue = 0,
    weight = 0,
    doneWeight = 0,
    openEffortMin = 0;
  for (const t of tasks) {
    if (t.projectId !== projectId) continue;
    total++;
    const w = t.estimateMin ?? DEFAULT_WEIGHT;
    weight += w;
    doneWeight += (w * taskProgress(t)) / 100;
    if (t.status === 'done') done++;
    else {
      open++;
      openEffortMin += t.estimateMin ?? 0;
      if (t.status === 'parked') parked++;
      if (t.due && daysBetween(todayKey, t.due) < 0) overdue++;
    }
  }
  return { total, open, done, parked, overdue, progress: weight ? doneWeight / weight : 0, openEffortMin };
}

export function actualMinutesByTask(sessions: FocusSession[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sessions) {
    if (s.kind !== 'focus' || !s.taskId) continue;
    m.set(s.taskId, (m.get(s.taskId) ?? 0) + s.activeMs / 60000);
  }
  return m;
}

export function parkedTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => t.status === 'parked').sort((a, b) => (b.parkedAt ?? 0) - (a.parkedAt ?? 0));
}

export function lastNDays(n: number, todayKey: string): string[] {
  return Array.from({ length: n }, (_, i) => addDays(todayKey, i - n + 1));
}

export function focusMinutesByDay(sessions: FocusSession[], days: string[]): number[] {
  const idx = new Map(days.map((d, i) => [d, i]));
  const out = days.map(() => 0);
  for (const s of sessions) {
    if (s.kind !== 'focus') continue;
    const i = idx.get(toDateKey(s.startedAt));
    if (i != null) out[i] += s.activeMs / 60000;
  }
  return out.map((v) => Math.round(v));
}

export function completedByDay(tasks: Task[], days: string[], projects: Project[]): { date: string; byProject: { projectId: string; count: number }[]; total: number }[] {
  const idx = new Map(days.map((d, i) => [d, i]));
  const rows = days.map((date) => ({ date, counts: new Map<string, number>() }));
  for (const t of tasks) {
    if (t.status !== 'done' || !t.completedAt) continue;
    const i = idx.get(toDateKey(t.completedAt));
    if (i == null) continue;
    rows[i].counts.set(t.projectId, (rows[i].counts.get(t.projectId) ?? 0) + 1);
  }
  const order = new Map(projects.map((p, i) => [p.id, i]));
  return rows.map((r) => {
    const byProject = [...r.counts.entries()]
      .map(([projectId, count]) => ({ projectId, count }))
      .sort((a, b) => (order.get(a.projectId) ?? 99) - (order.get(b.projectId) ?? 99));
    return { date: r.date, byProject, total: byProject.reduce((s, x) => s + x.count, 0) };
  });
}

export function sessionsForTask(sessions: FocusSession[], taskId: string): FocusSession[] {
  return sessions.filter((s) => s.taskId === taskId && s.kind === 'focus').sort((a, b) => b.startedAt - a.startedAt);
}
