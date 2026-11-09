import Dexie, { type Table } from 'dexie';
import type {
  Capture,
  Checkpoint,
  DayItem,
  FocusSession,
  Group,
  Project,
  Task,
  Tombstone,
} from '../types';
import { normaliseTask } from './normalise';
import { migrateLayoutV2toV3, relayoutAutoPlaced } from './layout';

export interface KVRow {
  key: string;
  value: unknown;
}

export class OrbitDB extends Dexie {
  projects!: Table<Project, string>;
  groups!: Table<Group, string>;
  tasks!: Table<Task, string>;
  checkpoints!: Table<Checkpoint, string>;
  sessions!: Table<FocusSession, string>;
  captures!: Table<Capture, string>;
  dayItems!: Table<DayItem, string>;
  kv!: Table<KVRow, string>;
  tombstones!: Table<Tombstone, string>;

  constructor(name = 'orbit', upTo: number = CURRENT_DB_VERSION) {
    super(name);
    defineVersions(this, upTo);
  }
}

export const CURRENT_DB_VERSION = 4;

/**
 * Schema history. Never edit a released version: add a new one with an upgrade().
 * Dexie runs each pending upgrade once, in order, inside a single transaction.
 */
export function defineVersions(db: Dexie, upTo: number) {
  // v1 — initial schema
  db.version(1).stores({
    projects: 'id, updatedAt',
    tasks: 'id, projectId, status, updatedAt',
    checkpoints: 'id, taskId, createdAt',
    sessions: 'id, taskId, startedAt',
    captures: 'id, status, createdAt',
    dayItems: 'id, date, taskId',
    kv: 'key',
  });
  if (upTo < 2) return;

  // v2 — project groups, sync-ready tombstones, slot index, task normalisation
  db.version(2)
    .stores({
      projects: 'id, groupId, updatedAt',
      groups: 'id',
      tombstones: 'id, table, deletedAt',
      dayItems: 'id, date, taskId, [date+slot]',
    })
    .upgrade(async (tx) => {
      await tx
        .table('tasks')
        .toCollection()
        .modify((t: Record<string, unknown>) => {
          const n = normaliseTask(t);
          Object.assign(t, n);
        });
      await tx
        .table('projects')
        .toCollection()
        .modify((p: Record<string, unknown>) => {
          if (p.groupId === undefined) p.groupId = null;
          if (typeof p.x !== 'number') p.x = 0;
          if (typeof p.y !== 'number') p.y = 0;
          if (typeof p.archived !== 'boolean') p.archived = false;
        });
    });
  if (upTo < 3) return;

  // v3 — the Universe becomes galaxies: groups get centres, project positions become
  // relative to their galaxy (or deep space). The arrangement inside each group is kept.
  db.version(3)
    .stores({})
    .upgrade(async (tx) => {
      const projects = (await tx.table('projects').toArray()) as ({ id: string } & Record<string, unknown>)[];
      const groups = (await tx.table('groups').toArray()) as ({ id: string } & Record<string, unknown>)[];
      const out = migrateLayoutV2toV3(projects, groups);
      if (out.projects.length) await tx.table('projects').bulkPut(out.projects);
      if (out.groups.length) await tx.table('groups').bulkPut(out.groups);
      const prefsRow = (await tx.table('kv').get('prefs')) as { key: string; value: Record<string, unknown> } | undefined;
      await tx.table('kv').put({ key: 'prefs', value: { ...(prefsRow?.value ?? {}), deepSpace: out.deepSpace } });
    });
  if (upTo < 4) return;

  // v4 — galaxies spiral out from the centre instead of sitting on a grid. Only galaxies
  // still at their automatic grid spot move; any the user dragged stay where they are.
  db.version(4)
    .stores({})
    .upgrade(async (tx) => {
      const groups = (await tx.table('groups').toArray()) as { id: string; x: number; y: number; createdAt?: number }[];
      const projects = (await tx.table('projects').toArray()) as { groupId?: string | null }[];
      const prefsRow = (await tx.table('kv').get('prefs')) as { key: string; value: Record<string, unknown> } | undefined;
      const ids = new Set(groups.map((g) => g.id));
      const deepInUse = projects.some((p) => !p.groupId || !ids.has(p.groupId));
      const ds = (prefsRow?.value?.deepSpace as { x: number; y: number } | undefined) ?? { x: 0, y: 0 };
      const out = relayoutAutoPlaced(groups, ds, deepInUse);
      for (const [id, at] of out.moves) await tx.table('groups').update(id, { x: at.x, y: at.y });
      await tx.table('kv').put({ key: 'prefs', value: { ...(prefsRow?.value ?? {}), deepSpace: out.deepSpace } });
    });
}
