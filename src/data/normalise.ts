import type { Capture, Checkpoint, DayItem, DaySlot, Energy, FocusSession, Group, Link, Placement, Prefs, Priority, Project, Snapshot, Subtask, Task, TaskWork } from '../types';
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
  layers: { moons: true, belts: true, beacons: true },
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

/* ---------- rows that come from somewhere else (a host's store, a restore) ---------- */

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => !!v && typeof v === 'object' && !Array.isArray(v);
const numOr = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const strOr = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
const hasId = (r: unknown): r is Raw & { id: string } => isObj(r) && typeof r.id === 'string' && r.id !== '';

export function normaliseGroup(r: Raw): Group {
  const now = Date.now();
  return {
    id: String(r.id),
    createdAt: numOr(r.createdAt, now),
    updatedAt: numOr(r.updatedAt, now),
    example: r.example === true ? true : undefined,
    name: strOr(r.name, 'Untitled galaxy'),
    color: strOr(r.color, '#7c8cff'),
    x: numOr(r.x, 0),
    y: numOr(r.y, 0),
  };
}

export function normaliseProject(r: Raw): Project {
  const now = Date.now();
  return {
    id: String(r.id),
    createdAt: numOr(r.createdAt, now),
    updatedAt: numOr(r.updatedAt, now),
    example: r.example === true ? true : undefined,
    name: strOr(r.name, 'Untitled system'),
    color: strOr(r.color, '#7c8cff'),
    icon: strOr(r.icon, 'planet'),
    description: strOr(r.description, ''),
    groupId: typeof r.groupId === 'string' && r.groupId ? r.groupId : null,
    x: numOr(r.x, 0),
    y: numOr(r.y, 0),
    archived: r.archived === true,
  };
}

export function normaliseCheckpoint(r: Raw): Checkpoint {
  const now = Date.now();
  const t = isObj(r.timer) ? r.timer : null;
  return {
    id: String(r.id),
    createdAt: numOr(r.createdAt, now),
    updatedAt: numOr(r.updatedAt, now),
    example: r.example === true ? true : undefined,
    taskId: strOr(r.taskId, ''),
    doing: strOr(r.doing, ''),
    stoppedAt: strOr(r.stoppedAt, ''),
    nextAction: strOr(r.nextAction, ''),
    notes: strOr(r.notes, ''),
    links: (Array.isArray(r.links) ? r.links : []).filter((l): l is Link => isObj(l) && typeof l.url === 'string'),
    timer: t
      ? {
          kind: t.kind === 'short-break' || t.kind === 'long-break' ? t.kind : 'focus',
          mode: t.mode === 'flow' ? 'flow' : 'countdown',
          plannedMs: typeof t.plannedMs === 'number' ? t.plannedMs : null,
          elapsedMs: numOr(t.elapsedMs, 0),
        }
      : null,
    resumedAt: typeof r.resumedAt === 'number' ? r.resumedAt : null,
    auto: r.auto === true,
  };
}

export function normaliseSession(r: Raw): FocusSession {
  const now = Date.now();
  const reasons = ['stopped', 'parked', 'completed', 'switched', 'finished'];
  return {
    id: String(r.id),
    createdAt: numOr(r.createdAt, now),
    updatedAt: numOr(r.updatedAt, now),
    example: r.example === true ? true : undefined,
    taskId: typeof r.taskId === 'string' ? r.taskId : null,
    kind: r.kind === 'short-break' || r.kind === 'long-break' ? r.kind : 'focus',
    mode: r.mode === 'flow' ? 'flow' : 'countdown',
    plannedMs: typeof r.plannedMs === 'number' ? r.plannedMs : null,
    startedAt: numOr(r.startedAt, numOr(r.createdAt, now)),
    endedAt: typeof r.endedAt === 'number' ? r.endedAt : null,
    activeMs: Math.max(0, numOr(r.activeMs, 0)),
    notes: strOr(r.notes, ''),
    distractions: Math.max(0, numOr(r.distractions, 0)),
    endReason: reasons.includes(r.endReason as string) ? (r.endReason as FocusSession['endReason']) : null,
  };
}

export function normaliseCapture(r: Raw): Capture {
  const now = Date.now();
  return {
    id: String(r.id),
    createdAt: numOr(r.createdAt, now),
    updatedAt: numOr(r.updatedAt, now),
    example: r.example === true ? true : undefined,
    text: strOr(r.text, ''),
    kind: r.kind === 'task' ? 'task' : 'thought',
    source: r.source === 'focus' || r.source === 'voice' ? r.source : 'quick',
    status: r.status === 'sorted' || r.status === 'dismissed' ? r.status : 'inbox',
    contextTaskId: typeof r.contextTaskId === 'string' ? r.contextTaskId : null,
    sortedTaskId: typeof r.sortedTaskId === 'string' ? r.sortedTaskId : null,
  };
}

const SLOTS: DaySlot[] = ['morning', 'afternoon', 'evening', 'later'];
export function normaliseDayItem(r: Raw): DayItem {
  const now = Date.now();
  return {
    id: String(r.id),
    createdAt: numOr(r.createdAt, now),
    updatedAt: numOr(r.updatedAt, now),
    example: r.example === true ? true : undefined,
    date: r.date as string,
    taskId: r.taskId as string,
    slot: SLOTS.includes(r.slot as DaySlot) ? (r.slot as DaySlot) : 'later',
    order: numOr(r.order, 0),
    start: typeof r.start === 'string' ? r.start : null,
  };
}

export function normalisePlacement(r: Raw): Placement {
  return { id: String(r.id), x: numOr(r.x, 0), y: numOr(r.y, 0), updatedAt: numOr(r.updatedAt, Date.now()) };
}

export function normaliseTaskWork(r: Raw): TaskWork {
  const w: TaskWork = { id: String(r.id), updatedAt: numOr(r.updatedAt, Date.now()) };
  if (typeof r.parked === 'boolean') w.parked = r.parked;
  if (typeof r.parkedAt === 'number' || r.parkedAt === null) w.parkedAt = r.parkedAt as number | null;
  if (ENERGIES.includes(r.energy as Energy)) w.energy = r.energy as Energy;
  if (typeof r.estimateMin === 'number' || r.estimateMin === null) w.estimateMin = r.estimateMin as number | null;
  if (typeof r.progress === 'number' && Number.isFinite(r.progress)) w.progress = Math.max(0, Math.min(100, r.progress));
  if (Array.isArray(r.subtasks)) w.subtasks = r.subtasks.filter((s): s is Subtask => isObj(s) && typeof s.title === 'string');
  if (Array.isArray(r.dependsOn)) w.dependsOn = r.dependsOn.filter((d): d is string => typeof d === 'string');
  if (Array.isArray(r.links)) w.links = r.links.filter((l): l is Link => isObj(l) && typeof l.url === 'string');
  return w;
}

/**
 * Cleans a snapshot that came from a host's store (or a hosted restore): every row is filled with defaults, and a
 * row that cannot be used is dropped, with one console warning in all. Never throws.
 */
export function normaliseHostedSnapshot(snap: Snapshot): Snapshot {
  let dropped = 0;
  const rows = <T>(v: unknown, fix: (r: Raw & { id: string }) => T, ok: (r: Raw & { id: string }) => boolean = () => true): T[] => {
    if (!Array.isArray(v)) return [];
    const out: T[] = [];
    for (const r of v) {
      if (hasId(r) && ok(r)) {
        try {
          out.push(fix(r));
          continue;
        } catch {
          /* dropped below */
        }
      }
      dropped++;
    }
    return out;
  };
  const groups = rows(snap.groups, normaliseGroup);
  const projects = rows(snap.projects, normaliseProject);
  const projectIds = new Set(projects.map((p) => p.id));
  const tasks = rows(snap.tasks, (r) => normaliseTask(r), (r) => typeof r.projectId === 'string' && projectIds.has(r.projectId));
  const out: Snapshot = {
    groups,
    projects,
    tasks,
    checkpoints: rows(snap.checkpoints, normaliseCheckpoint),
    sessions: rows(snap.sessions, normaliseSession),
    captures: rows(snap.captures, normaliseCapture),
    dayItems: rows(snap.dayItems, normaliseDayItem, (r) => typeof r.taskId === 'string' && typeof r.date === 'string' && isValidDateKey(r.date)),
    placements: rows(snap.placements, normalisePlacement),
    taskWork: rows(snap.taskWork, normaliseTaskWork),
    prefs: snap.prefs,
    focus: isObj(snap.focus) ? snap.focus : null,
  };
  if (dropped) console.warn(`ORBIT: ${dropped} unusable record${dropped === 1 ? '' : 's'} in the host's store were left out.`);
  return out;
}
