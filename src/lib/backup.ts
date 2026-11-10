import type { Snapshot } from '../types';
import { DEFAULT_PREFS, normaliseTask } from '../data/normalise';
import { migrateLayoutV2toV3, relayoutAutoPlaced } from '../data/layout';

export const BACKUP_APP = 'orbit';
export const SCHEMA_VERSION = 5;

export interface BackupFile extends Omit<Snapshot, 'focus'> {
  app: typeof BACKUP_APP;
  schemaVersion: number;
  exportedAt: string;
  focus: Snapshot['focus'];
}

export function createBackup(s: Snapshot, now = Date.now()): BackupFile {
  return { app: BACKUP_APP, schemaVersion: SCHEMA_VERSION, exportedAt: new Date(now).toISOString(), ...s };
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  data?: Snapshot;
  counts?: Record<string, number>;
}

const TABLES = ['projects', 'groups', 'tasks', 'checkpoints', 'sessions', 'captures', 'dayItems', 'placements', 'taskWork'] as const;

/** Brings an older backup up to the current schema before validation. */
export function migrateBackup(raw: Record<string, unknown>): Record<string, unknown> {
  const v = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  const out: Record<string, unknown> = { ...raw };
  if (v < 2) {
    // v1 had no groups table and tasks could miss links/dependsOn/energy.
    out.groups = Array.isArray(raw.groups) ? raw.groups : [];
    out.tasks = Array.isArray(raw.tasks) ? (raw.tasks as Record<string, unknown>[]).map((t) => normaliseTask(t)) : [];
    out.schemaVersion = 2;
  }
  if ((out.schemaVersion as number) < 3) {
    // v3 gave galaxies (groups) positions and made project positions relative to them.
    const projects = (Array.isArray(out.projects) ? out.projects : []) as ({ id: string } & Record<string, unknown>)[];
    const groups = (Array.isArray(out.groups) ? out.groups : []) as ({ id: string } & Record<string, unknown>)[];
    if (projects.every((p) => p && typeof p.id === 'string') && groups.every((g) => g && typeof g.id === 'string')) {
      const m = migrateLayoutV2toV3(projects, groups);
      out.projects = m.projects;
      out.groups = m.groups;
      out.prefs = { ...((out.prefs as object) ?? {}), deepSpace: m.deepSpace };
    }
    out.schemaVersion = 3;
  }
  if ((out.schemaVersion as number) < 4) {
    // v4 moved untouched galaxies from the grid onto a spiral.
    const groups = (Array.isArray(out.groups) ? out.groups : []) as { id: string; x: number; y: number; createdAt?: number }[];
    const projects = (Array.isArray(out.projects) ? out.projects : []) as { groupId?: string | null }[];
    if (groups.every((g) => g && typeof g.id === 'string' && typeof g.x === 'number' && typeof g.y === 'number')) {
      const ids = new Set(groups.map((g) => g.id));
      const prefs = ((out.prefs as Record<string, unknown>) ?? {}) as { deepSpace?: { x: number; y: number } };
      const r = relayoutAutoPlaced(groups, prefs.deepSpace ?? { x: 0, y: 0 }, projects.some((p) => p && (!p.groupId || !ids.has(p.groupId))));
      out.groups = groups.map((g) => (r.moves.has(g.id) ? { ...g, ...r.moves.get(g.id)! } : g));
      out.prefs = { ...prefs, deepSpace: r.deepSpace };
    }
    out.schemaVersion = 4;
  }
  if ((out.schemaVersion as number) < 5) {
    // v5 added two tables used when ORBIT runs inside a host application; older backups have neither.
    out.placements = Array.isArray(out.placements) ? out.placements : [];
    out.taskWork = Array.isArray(out.taskWork) ? out.taskWork : [];
    out.schemaVersion = 5;
  }
  return out;
}

export function validateBackup(input: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, errors: ['This file is not an ORBIT backup (expected a JSON object).'], warnings };
  const obj = input as Record<string, unknown>;
  if (obj.app !== BACKUP_APP) return { ok: false, errors: ['This file is not an ORBIT backup (missing "app": "orbit").'], warnings };
  if (typeof obj.schemaVersion === 'number' && obj.schemaVersion > SCHEMA_VERSION)
    return { ok: false, errors: [`This backup comes from a newer version of ORBIT (schema ${obj.schemaVersion}). Update ORBIT first.`], warnings };

  const m = migrateBackup(obj);
  for (const t of TABLES) {
    if (!Array.isArray(m[t])) errors.push(`Missing or invalid "${t}" list.`);
  }
  if (errors.length) return { ok: false, errors, warnings };

  const arr = (k: (typeof TABLES)[number]) => m[k] as Record<string, unknown>[];
  const badIds = (k: (typeof TABLES)[number]) => arr(k).filter((r) => !r || typeof r.id !== 'string' || !r.id).length;
  for (const t of TABLES) {
    const n = badIds(t);
    if (n) errors.push(`${n} record(s) in "${t}" have no id.`);
  }
  for (const p of arr('projects')) if (typeof p.name !== 'string') errors.push(`Project ${String(p.id)} has no name.`);
  for (const t of arr('tasks')) if (typeof t.title !== 'string') errors.push(`Task ${String(t.id)} has no title.`);
  if (errors.length) return { ok: false, errors: errors.slice(0, 8), warnings };

  const projectIds = new Set(arr('projects').map((p) => p.id as string));
  const tasks = arr('tasks').map((t) => normaliseTask(t));
  const orphanTasks = tasks.filter((t) => !projectIds.has(t.projectId));
  if (orphanTasks.length) warnings.push(`${orphanTasks.length} task(s) point to a missing project and will be skipped.`);
  const keptTasks = tasks.filter((t) => projectIds.has(t.projectId));
  const taskIds = new Set(keptTasks.map((t) => t.id));
  for (const t of keptTasks) t.dependsOn = t.dependsOn.filter((d) => taskIds.has(d));

  const dayItems = arr('dayItems').filter((d) => taskIds.has(d.taskId as string));
  const checkpoints = arr('checkpoints').filter((c) => taskIds.has(c.taskId as string));
  if (dayItems.length < arr('dayItems').length) warnings.push('Some day-plan entries pointed to missing tasks and will be skipped.');

  let focus = (m.focus ?? null) as Snapshot['focus'];
  if (focus && focus.taskId && !taskIds.has(focus.taskId)) {
    focus = null;
    warnings.push('The running focus session pointed to a missing task and was dropped.');
  }

  const data: Snapshot = {
    projects: arr('projects') as unknown as Snapshot['projects'],
    groups: arr('groups').map((g) => ({ ...g, x: typeof g.x === 'number' ? g.x : 0, y: typeof g.y === 'number' ? g.y : 0 })) as unknown as Snapshot['groups'],
    tasks: keptTasks,
    checkpoints: checkpoints as unknown as Snapshot['checkpoints'],
    sessions: arr('sessions') as unknown as Snapshot['sessions'],
    captures: arr('captures') as unknown as Snapshot['captures'],
    dayItems: dayItems as unknown as Snapshot['dayItems'],
    placements: arr('placements').map((p) => ({ ...p, x: typeof p.x === 'number' ? p.x : 0, y: typeof p.y === 'number' ? p.y : 0 })) as unknown as Snapshot['placements'],
    taskWork: arr('taskWork') as unknown as Snapshot['taskWork'],
    prefs: { ...DEFAULT_PREFS, ...((m.prefs as object) ?? {}) } as Snapshot['prefs'],
    focus,
  };
  const counts = {
    projects: data.projects.length,
    tasks: data.tasks.length,
    checkpoints: data.checkpoints.length,
    sessions: data.sessions.length,
    captures: data.captures.length,
    dayItems: data.dayItems.length,
  };
  return { ok: true, errors, warnings, data, counts };
}

export function parseBackupText(text: string): ValidationResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['This is not valid JSON.'], warnings: [] };
  }
  return validateBackup(json);
}
