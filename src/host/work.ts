/**
 * The two halves of a host-owned task.
 *
 *   - What the HOST keeps: title, notes, due, priority, the system it is in, and whether it is todo, done or
 *     dropped. Changes to these go to `host.tasks` (see writer.ts).
 *   - What ORBIT keeps for it (WORKING STATE): parked or not and since when, energy, estimate, progress,
 *     subtasks, dependencies and web links. These go to table `taskWork` in `host.store`, keyed by the host's
 *     task id, and never to `host.tasks`.
 *
 * ORBIT's `todo` and `parked` are both the host's `todo`: parking is an overlay that only applies while the
 * host says todo.
 */
import type { Task, TaskWork } from '../types';

export type HostStatus = 'todo' | 'done' | 'dropped';

/** The fields of a task that the host owns, as ORBIT compares them. */
export interface HostView {
  title: string;
  notes: string;
  due: string | null;
  priority: Task['priority'];
  /** The host system the task is in (ORBIT's projectId). */
  system: string;
  status: HostStatus;
}

/** Fields sent to `host.tasks.update` when they change (plus `system`, from projectId). */
export const HOST_FIELDS = ['title', 'notes', 'due', 'priority'] as const;

/** Task fields that are ORBIT's working state for a host task. */
export const WORK_FIELDS = ['energy', 'estimateMin', 'progress', 'subtasks', 'dependsOn', 'links', 'parkedAt'] as const;

export function hostStatusOf(t: Pick<Task, 'status' | 'host'>): HostStatus {
  if (t.status !== 'done') return 'todo';
  return t.host?.dropped ? 'dropped' : 'done';
}

export function hostView(t: Task): HostView {
  return { title: t.title, notes: t.notes ?? '', due: t.due ?? null, priority: t.priority, system: t.projectId, status: hostStatusOf(t) };
}

/** The working-state row for a task as it is now. */
export function workOf(t: Task, at: number): TaskWork {
  const parked = t.status === 'parked';
  return {
    id: t.id,
    parked,
    parkedAt: parked ? (t.parkedAt ?? null) : null,
    energy: t.energy,
    estimateMin: t.estimateMin ?? null,
    progress: t.progress,
    subtasks: t.subtasks,
    dependsOn: t.dependsOn,
    links: t.links,
    updatedAt: at,
  };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Do two rows hold the same working state (ignoring when they were written)? */
export function sameWork(a: TaskWork, b: TaskWork): boolean {
  return (
    !!a.parked === !!b.parked &&
    (a.parkedAt ?? null) === (b.parkedAt ?? null) &&
    (a.energy ?? 'medium') === (b.energy ?? 'medium') &&
    (a.estimateMin ?? null) === (b.estimateMin ?? null) &&
    (a.progress ?? 0) === (b.progress ?? 0) &&
    same(a.subtasks ?? [], b.subtasks ?? []) &&
    same(a.dependsOn ?? [], b.dependsOn ?? []) &&
    same(a.links ?? [], b.links ?? [])
  );
}

/** A row that says nothing a fresh host task would not already show. */
export function isDefaultWork(w: TaskWork): boolean {
  return sameWork(w, { id: w.id, updatedAt: 0 }) || sameWork(w, { id: w.id, progress: 100, updatedAt: 0 });
}

/**
 * Puts ORBIT's working state onto a task as the host sent it. `stale` is true when the row says parked but
 * the host says the task is done: the task is done, and the caller clears the flag.
 */
export function overlayWork(t: Task, w: TaskWork | undefined): { task: Task; stale: boolean } {
  if (!w) return { task: t, stale: false };
  const done = t.status === 'done';
  const task: Task = {
    ...t,
    energy: w.energy ?? t.energy,
    estimateMin: w.estimateMin !== undefined ? w.estimateMin : t.estimateMin,
    progress: done ? 100 : (w.progress ?? t.progress),
    subtasks: w.subtasks ?? t.subtasks,
    dependsOn: w.dependsOn ?? t.dependsOn,
    links: w.links ?? t.links,
  };
  if (w.parked && t.status === 'todo') {
    task.status = 'parked';
    task.parkedAt = w.parkedAt ?? null;
  }
  return { task, stale: !!w.parked && done };
}
