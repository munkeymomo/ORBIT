import { useMemo } from 'react';
import type { Project, Task } from '../../types';
import { useOrbit, type UniverseFilter } from '../../store/store';
import type { ItemPlanet, MoonSet } from '../../host/adapt';
import { abilities, may, type HostAbilities } from '../../host/caps';
import { projectStats, type ProjectStats } from '../../store/selectors';
import { isBlocked, taskProgress } from '../../lib/scoring';
import { clamp, daysBetween, toDateKey } from '../../lib/util';

export interface TaskView {
  task: Task;
  matches: boolean;
  blocked: boolean;
  active: boolean;
  progress: number;
  /** Hosted: what the task uses or holds (its moons). */
  moons?: MoonSet;
  /** Hosted: the task uses the attachment picked in the "Uses …" filter. */
  uses: boolean;
}

/** A record shown as a planet (never a task: it has no status, priority, focus or due date). */
export interface ItemView {
  item: ItemPlanet;
  /** Matches the text being highlighted (always, with no text). */
  matches: boolean;
}

export interface ProjectView {
  project: Project;
  /** TASK counts only: items are never counted as tasks. */
  stats: ProjectStats;
  radius: number;
  tasks: TaskView[];
  /** Hosted: the system's item planets (drawn after its tasks on the same orbits). */
  items: ItemView[];
  /** How many items it stands for: the host's `count` when given, else the item planets drawn. 0 without items. */
  itemCount: number;
  /** Project or one of its tasks matches the current filter. */
  matches: boolean;
  /** Has at least one task matching the text query (auto-expand while searching). */
  queryHit: boolean;
  hasActive: boolean;
  /** A task may be added here (always for ORBIT's own systems; per the host's caps for a host's). */
  canAdd: boolean;
}

export function projectRadius(tasks: Task[]): number {
  const weight = tasks.filter((t) => t.status !== 'done').reduce((s, t) => s + (t.estimateMin ?? 30), 0);
  return clamp(40 + 4 * Math.sqrt(weight / 15), 40, 80);
}

/** A system standing for records: the same √ mapping and limits as a task system (40–80), from its count relative to the busiest system of its galaxy (never less than `FLOOR` so a galaxy of small systems does not inflate them). */
export const ITEM_SYSTEM_FLOOR = 12;
export function itemSystemRadius(count: number, largestInGalaxy: number): number {
  if (count <= 0) return 40;
  return clamp(40 + 40 * Math.sqrt(count / Math.max(largestInGalaxy, ITEM_SYSTEM_FLOOR, count)), 40, 80);
}

export function taskDiameter(t: Task): number {
  return t.estimateMin ? clamp(22 + Math.sqrt(t.estimateMin) * 3.2, 26, 60) : 32;
}

const STATUS_ORDER = { parked: 1, todo: 2, done: 3 } as const;

const hasMoons = (m?: MoonSet) => !!m && (m.items.length > 0 || m.more > 0);

function taskPasses(t: Task, f: UniverseFilter, today: string, moons?: MoonSet): boolean {
  if (!f.showDone && t.status === 'done') return false;
  if (f.hasLinked && !hasMoons(moons)) return false;
  if (f.parkedOnly && t.status !== 'parked') return false;
  if (f.highPriority && t.priority < 3) return false;
  if (f.dueSoon && (!t.due || daysBetween(today, t.due) > 3)) return false;
  return true;
}

export function filterActive(f: UniverseFilter) {
  return !!(f.query.trim() || f.dueSoon || f.highPriority || f.parkedOnly || f.groupId || f.hasLinked || f.uses);
}

const NO_TASKS: Task[] = [];
const NO_ITEMS: Record<string, ItemPlanet[]> = {};
const NO_MOONS: Record<string, MoonSet> = {};

/**
 * The Universe's model of the verse on screen. The work verse: ORBIT's systems and tasks (and the verse's items).
 * Another verse: its own systems and items only — no tasks, no personal records, nothing can be added.
 */
export function useUniverseModel(): ProjectView[] {
  const sky = useOrbit((s) => s.host?.sky ?? null);
  const projects = useOrbit((s) => s.host?.sky?.projects ?? s.projects);
  const tasks = useOrbit((s) => (s.host?.sky ? NO_TASKS : s.tasks));
  const items = useOrbit((s) => s.host?.sky?.items ?? s.host?.items ?? NO_ITEMS);
  const filter = useOrbit((s) => s.filter);
  const activeTaskId = useOrbit((s) => s.focus?.taskId ?? null);
  const attachments = useOrbit((s) => (s.host?.sky ? NO_MOONS : (s.host?.attachments ?? NO_MOONS)));
  const info = useOrbit((s) => s.host?.info);
  const today = toDateKey(Date.now());

  return useMemo(
    () => buildModel({ projects, tasks, filter, activeTaskId, today, attachments, items, readOnly: !!sky, can: abilities(info) }),
    [projects, tasks, filter, activeTaskId, today, attachments, items, sky, info],
  );
}

const ITEM_STATE_ORDER = { live: 0, archived: 1, gone: 2 } as const;

/** The Universe's view of projects and tasks under the current filter (pure, so it can be tested). */
export function buildModel({
  projects,
  tasks,
  filter,
  activeTaskId,
  today,
  attachments = {},
  items = {},
  readOnly = false,
  can = abilities(null),
}: {
  projects: Project[];
  tasks: Task[];
  filter: UniverseFilter;
  activeTaskId: string | null;
  today: string;
  attachments?: Record<string, MoonSet>;
  /** Item planets by system id (hosted). */
  items?: Record<string, ItemPlanet[]>;
  /** A verse that is not the work verse: nothing can be added to its systems. */
  readOnly?: boolean;
  can?: HostAbilities;
}): ProjectView[] {
  {
    const q = filter.query.trim().toLowerCase();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const structural = filter.dueSoon || filter.highPriority || filter.parkedOnly || filter.hasLinked;
    const usesIt = (id: string) => !!filter.uses && !!attachments[id]?.items.some((a) => a.id === filter.uses);
    const biggest = new Map<string | null, number>();
    for (const p of projects) {
      const n = Math.max(p.host?.count ?? 0, (items[p.id] ?? []).length);
      if (n && !tasks.some((t) => t.projectId === p.id)) biggest.set(p.groupId, Math.max(biggest.get(p.groupId) ?? 0, n));
    }
    return projects
      .filter((p) => !p.archived)
      .map((project) => {
        const own = tasks.filter((t) => t.projectId === project.id);
        const visible = own
          .filter((t) => taskPasses(t, filter, today, attachments[t.id]) || t.id === activeTaskId)
          .sort(
            (a, b) =>
              Number(b.id === activeTaskId) - Number(a.id === activeTaskId) ||
              STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
              b.priority - a.priority ||
              (a.due ?? '9999').localeCompare(b.due ?? '9999') ||
              a.createdAt - b.createdAt,
          );
        const nameHit = !!q && project.name.toLowerCase().includes(q);
        const tv: TaskView[] = visible.map((task) => ({
          task,
          matches: (!q || nameHit || task.title.toLowerCase().includes(q) || task.notes.toLowerCase().includes(q)) && (!filter.uses || usesIt(task.id)),
          blocked: task.status !== 'done' && isBlocked(task, byId).length > 0,
          active: task.id === activeTaskId,
          progress: taskProgress(task),
          moons: attachments[task.id],
          uses: usesIt(task.id),
        }));
        // items in verse order, ghosts after the system's own, the archived and gone last
        const iv: ItemView[] = (items[project.id] ?? [])
          .map((item, i) => ({ item, i }))
          .sort((a, b) => Number(a.item.ghost) - Number(b.item.ghost) || ITEM_STATE_ORDER[a.item.state] - ITEM_STATE_ORDER[b.item.state] || a.i - b.i)
          .map(({ item }) => ({ item, matches: !q || nameHit || item.title.toLowerCase().includes(q) || (item.sub ?? '').toLowerCase().includes(q) }));
        const itemHit = !!q && iv.some((x) => x.item.title.toLowerCase().includes(q) || (x.item.sub ?? '').toLowerCase().includes(q));
        const queryHit = !!q && (tv.some((t) => t.task.title.toLowerCase().includes(q)) || itemHit);
        const groupOk = !filter.groupId || project.groupId === filter.groupId;
        // task filters ask about tasks: a system of items only matches when none is on
        const structuralOk = !structural || tv.some((t) => t.task.status !== 'done' || filter.showDone);
        const usesOk = !filter.uses || tv.some((t) => t.uses);
        const matches = groupOk && structuralOk && usesOk && (!q || nameHit || queryHit || tv.some((t) => t.matches && !!q));
        return {
          project,
          stats: projectStats(project.id, tasks, today),
          // a system that holds items and no tasks is sized by how many it holds
          radius: iv.length && !own.length ? itemSystemRadius(Math.max(project.host?.count ?? 0, iv.length), biggest.get(project.groupId) ?? 0) : projectRadius(own),
          tasks: tv,
          items: iv,
          itemCount: iv.length ? Math.max(project.host?.count ?? 0, iv.length) : 0,
          matches,
          queryHit,
          hasActive: own.some((t) => t.id === activeTaskId),
          canAdd: readOnly || project.host?.portal ? false : project.host ? may(can, project.host, 'create') : can.personal,
        };
      });
  }
}

/** Positions of tasks orbiting a project, filled ring by ring from the top, clockwise. */
export function orbitLayout(pv: ProjectView, withAddSlot: boolean): { rings: number[]; slots: { x: number; y: number; d: number }[] } {
  // tasks first, then items, then the "add a task" slot: slot i is task i, slot tasks.length + j is item j
  const items = [...pv.tasks.map((t) => taskDiameter(t.task)), ...(pv.items ?? []).map((x) => x.item.diameter)];
  if (withAddSlot) items.push(30);
  const slots: { x: number; y: number; d: number }[] = [];
  const rings: number[] = [];
  let i = 0;
  let ring = 0;
  while (i < items.length) {
    const r = pv.radius + 66 + ring * 70;
    const cap = Math.max(6, Math.floor((2 * Math.PI * r) / 72));
    const n = Math.min(cap, items.length - i);
    rings.push(r);
    for (let k = 0; k < n; k++) {
      const a = -Math.PI / 2 + (k / Math.max(n, ring === 0 ? Math.min(cap, Math.max(n, 6)) : n)) * 2 * Math.PI + ring * 0.35;
      slots.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, d: items[i + k] });
    }
    i += n;
    ring++;
  }
  return { rings, slots };
}
