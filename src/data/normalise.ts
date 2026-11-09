import type { Energy, Prefs, Priority, Task } from '../types';
import { isValidDateKey } from '../lib/util';

export const DEFAULT_PREFS: Prefs = {
  theme: 'dark',
  motion: 'system',
  sound: true,
  notifications: false,
  focusMin: 25,
  shortBreakMin: 5,
  longBreakMin: 15,
  longBreakEvery: 4,
  nextEnergy: 'medium',
  nextMinutes: 45,
  deepSpace: { x: 0, y: 0 },
  updatedAt: 0,
};

const ENERGIES: Energy[] = ['low', 'medium', 'high'];

/** Fills missing fields and coerces types so older or hand-edited records are safe to use. */
export function normaliseTask(raw: Record<string, unknown>): Task {
  const now = Date.now();
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const pr = num(raw.priority, 2);
  return {
    id: String(raw.id),
    createdAt: num(raw.createdAt, now),
    updatedAt: num(raw.updatedAt, now),
    example: raw.example === true ? true : undefined,
    projectId: String(raw.projectId ?? ''),
    title: String(raw.title ?? 'Untitled'),
    notes: typeof raw.notes === 'string' ? raw.notes : '',
    status: raw.status === 'done' || raw.status === 'parked' ? raw.status : 'todo',
    priority: (pr >= 1 && pr <= 4 ? Math.round(pr) : 2) as Priority,
    due: isValidDateKey(raw.due) ? raw.due : null,
    estimateMin: typeof raw.estimateMin === 'number' && raw.estimateMin > 0 ? Math.round(raw.estimateMin) : null,
    energy: ENERGIES.includes(raw.energy as Energy) ? (raw.energy as Energy) : 'medium',
    progress: Math.max(0, Math.min(100, num(raw.progress, 0))),
    subtasks: arr<Task['subtasks'][number]>(raw.subtasks).filter((s) => s && typeof s.title === 'string'),
    dependsOn: arr<string>(raw.dependsOn).filter((d) => typeof d === 'string'),
    links: arr<Task['links'][number]>(raw.links).filter((l) => l && typeof l.url === 'string'),
    completedAt: typeof raw.completedAt === 'number' ? raw.completedAt : null,
    parkedAt: typeof raw.parkedAt === 'number' ? raw.parkedAt : null,
  };
}
