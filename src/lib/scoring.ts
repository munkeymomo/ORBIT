import type { Checkpoint, DayItem, Energy, Task } from '../types';
import { daysBetween } from './util';

/**
 * Smart Next Action — transparent, rule-based ranking.
 * Every point a task gains or loses comes with a plain-language reason,
 * so the user can always see why something is suggested.
 */

export interface Reason {
  rule: 'urgency' | 'importance' | 'parked' | 'time' | 'energy' | 'planned' | 'momentum' | 'unblocks' | 'quick';
  points: number;
  text: string;
}

export interface Suggestion {
  task: Task;
  score: number;
  reasons: Reason[];
}

export interface BlockedTask {
  task: Task;
  blockers: Task[];
}

export interface NextContext {
  todayKey: string;
  availableMin: number;
  energy: Energy;
  /** Latest checkpoint per task. */
  checkpoints: Map<string, Checkpoint>;
  /** Day items for today, by task id. */
  planned: Map<string, DayItem>;
  /** Task id currently in focus (excluded from suggestions). */
  activeTaskId: string | null;
}

const ENERGY_RANK: Record<Energy, number> = { low: 0, medium: 1, high: 2 };
const SLOT_LABEL: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', later: 'Later' };

export function isBlocked(task: Task, byId: Map<string, Task>): Task[] {
  return task.dependsOn.map((id) => byId.get(id)).filter((t): t is Task => !!t && t.status !== 'done');
}

export function scoreTask(task: Task, ctx: NextContext, dependents: number): Suggestion {
  const reasons: Reason[] = [];

  // Urgency
  if (task.due) {
    const d = daysBetween(ctx.todayKey, task.due);
    if (d < 0) reasons.push({ rule: 'urgency', points: 40, text: d === -1 ? 'Overdue by a day' : `Overdue by ${-d} days` });
    else if (d === 0) reasons.push({ rule: 'urgency', points: 30, text: 'Due today' });
    else if (d === 1) reasons.push({ rule: 'urgency', points: 20, text: 'Due tomorrow' });
    else if (d <= 7) reasons.push({ rule: 'urgency', points: 10, text: `Due in ${d} days` });
  }

  // Importance
  const imp = { 4: [30, 'Critical priority'], 3: [20, 'High priority'], 2: [8, 'Normal priority'], 1: [0, ''] } as const;
  const [ip, it] = imp[task.priority];
  if (ip) reasons.push({ rule: 'importance', points: ip, text: it });

  // Parked with context
  const cp = ctx.checkpoints.get(task.id);
  if (task.status === 'parked') {
    if (cp?.nextAction.trim()) reasons.push({ rule: 'parked', points: 15, text: `Parked with a next step: “${truncate(cp.nextAction, 48)}”` });
    else reasons.push({ rule: 'parked', points: 8, text: 'Parked — your place is saved' });
  }

  // Available time
  if (task.estimateMin != null && task.estimateMin > 0) {
    if (task.estimateMin <= ctx.availableMin) reasons.push({ rule: 'time', points: 10, text: `Fits in your ${ctx.availableMin} min` });
    else if (task.estimateMin > ctx.availableMin * 1.5)
      reasons.push({ rule: 'time', points: -15, text: `Needs ~${task.estimateMin} min; you have ${ctx.availableMin}` });
    else reasons.push({ rule: 'time', points: 0, text: `Slightly longer than your ${ctx.availableMin} min` });
    if (task.estimateMin <= 15) reasons.push({ rule: 'quick', points: 5, text: 'Quick win' });
  }

  // Energy
  const diff = ENERGY_RANK[task.energy] - ENERGY_RANK[ctx.energy];
  if (diff === 0) reasons.push({ rule: 'energy', points: 10, text: `Matches your ${ctx.energy} energy` });
  else if (diff > 0) reasons.push({ rule: 'energy', points: -20 * diff, text: `Needs ${task.energy} energy; you have ${ctx.energy}` });
  else reasons.push({ rule: 'energy', points: 3, text: 'Easy on energy' });

  // Planned today
  const p = ctx.planned.get(task.id);
  if (p) reasons.push({ rule: 'planned', points: 12, text: `On today's plan · ${SLOT_LABEL[p.slot]}${p.start ? ` at ${p.start}` : ''}` });

  // Momentum
  const prog = taskProgress(task);
  if (prog > 0 && prog < 100) reasons.push({ rule: 'momentum', points: 6, text: `Already ${prog}% done` });

  // Unblocks others
  if (dependents > 0)
    reasons.push({ rule: 'unblocks', points: Math.min(15, dependents * 5), text: dependents === 1 ? 'Unblocks another task' : `Unblocks ${dependents} tasks` });

  const score = reasons.reduce((s, r) => s + r.points, 0);
  return { task, score, reasons: reasons.sort((a, b) => b.points - a.points) };
}

export function rankNext(tasks: Task[], ctx: NextContext): { suggestions: Suggestion[]; blocked: BlockedTask[] } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const dependentsCount = new Map<string, number>();
  for (const t of tasks) {
    if (t.status === 'done') continue;
    for (const d of t.dependsOn) dependentsCount.set(d, (dependentsCount.get(d) ?? 0) + 1);
  }
  const suggestions: Suggestion[] = [];
  const blocked: BlockedTask[] = [];
  for (const t of tasks) {
    if (t.status === 'done' || t.id === ctx.activeTaskId) continue;
    const blockers = isBlocked(t, byId);
    if (blockers.length) {
      blocked.push({ task: t, blockers });
      continue;
    }
    suggestions.push(scoreTask(t, ctx, dependentsCount.get(t.id) ?? 0));
  }
  suggestions.sort((a, b) => b.score - a.score || (a.task.due ?? '9999').localeCompare(b.task.due ?? '9999') || a.task.createdAt - b.task.createdAt);
  return { suggestions, blocked };
}

export function taskProgress(task: Task): number {
  if (task.status === 'done') return 100;
  if (task.subtasks.length) return Math.round((task.subtasks.filter((s) => s.done).length / task.subtasks.length) * 100);
  return Math.round(task.progress);
}

function truncate(s: string, n: number): string {
  const t = s.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}
