import { useMemo } from 'react';
import type { Project, Task } from '../../types';
import { useOrbit, type UniverseFilter } from '../../store/store';
import type { MoonSet } from '../../host/adapt';
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

export interface ProjectView {
  project: Project;
  stats: ProjectStats;
  radius: number;
  tasks: TaskView[];
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

export function useUniverseModel(): ProjectView[] {
  const projects = useOrbit((s) => s.projects);
  const tasks = useOrbit((s) => s.tasks);
  const filter = useOrbit((s) => s.filter);
  const activeTaskId = useOrbit((s) => s.focus?.taskId ?? null);
  const attachments = useOrbit((s) => s.host?.attachments);
  const info = useOrbit((s) => s.host?.info);
  const today = toDateKey(Date.now());

  return useMemo(
    () => buildModel({ projects, tasks, filter, activeTaskId, today, attachments: attachments ?? {}, can: abilities(info) }),
    [projects, tasks, filter, activeTaskId, today, attachments, info],
  );
}

/** The Universe's view of projects and tasks under the current filter (pure, so it can be tested). */
export function buildModel({
  projects,
  tasks,
  filter,
  activeTaskId,
  today,
  attachments = {},
  can = abilities(null),
}: {
  projects: Project[];
  tasks: Task[];
  filter: UniverseFilter;
  activeTaskId: string | null;
  today: string;
  attachments?: Record<string, MoonSet>;
  can?: HostAbilities;
}): ProjectView[] {
  {
    const q = filter.query.trim().toLowerCase();
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const structural = filter.dueSoon || filter.highPriority || filter.parkedOnly || filter.hasLinked;
    const usesIt = (id: string) => !!filter.uses && !!attachments[id]?.items.some((a) => a.id === filter.uses);
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
        const queryHit = !!q && tv.some((t) => t.task.title.toLowerCase().includes(q));
        const groupOk = !filter.groupId || project.groupId === filter.groupId;
        const structuralOk = !structural || tv.some((t) => t.task.status !== 'done' || filter.showDone);
        const usesOk = !filter.uses || tv.some((t) => t.uses);
        const matches = groupOk && structuralOk && usesOk && (!q || nameHit || queryHit || tv.some((t) => t.matches && !!q));
        return {
          project,
          stats: projectStats(project.id, tasks, today),
          radius: projectRadius(own),
          tasks: tv,
          matches,
          queryHit,
          hasActive: own.some((t) => t.id === activeTaskId),
          canAdd: project.host ? may(can, project.host, 'create') : can.personal,
        };
      });
  }
}

/** Positions of tasks orbiting a project, filled ring by ring from the top, clockwise. */
export function orbitLayout(pv: ProjectView, withAddSlot: boolean): { rings: number[]; slots: { x: number; y: number; d: number }[] } {
  const items = pv.tasks.map((t) => taskDiameter(t.task));
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
