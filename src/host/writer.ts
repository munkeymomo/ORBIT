/**
 * THE SEAM between the store and storage. Every write the store makes — put, putMany, del, patchRow, prefs and
 * the focus runtime — goes through the writer made here, and nowhere else decides where a record goes.
 *
 * Standalone, it passes everything straight to the StorageAdapter (unchanged behaviour).
 *
 * With a host attached:
 *   - a host-owned galaxy or system is never stored; what is kept is where the person put it, as a placement
 *     (`g|<galaxy id>`, `<verse id>|<system id>`). The store only lets position changes reach this point.
 *   - a host-owned task is never stored. In this read-only stage it is dropped here (the store has already
 *     refused the change on screen). The next stage routes it to `host.tasks` instead and, if the host refuses,
 *     undoes the change in memory with the host's reason: that logic belongs in `routeHostRecord` below.
 *   - ORBIT's own records go to `host.store` only for what the host keeps: placements and prefs always, personal
 *     tables when the host keeps personal records, working state when it keeps work. Anything else stays in
 *     memory for this session.
 */
import type { FocusRuntime, HostRef, Placement, Prefs, TableName } from '../types';
import type { StorageAdapter } from '../data/storage';
import type { HostAbilities } from './caps';
import { placementKey } from './adapt';

export interface RecordWriter {
  put(table: TableName, record: { id: string }): Promise<void>;
  putMany(table: TableName, records: { id: string }[]): Promise<void>;
  remove(table: TableName, ids: string[]): Promise<void>;
  setPrefs(prefs: Prefs): Promise<void>;
  setFocus(rt: FocusRuntime | null): Promise<void>;
}

export interface HostedWriting {
  abilities: HostAbilities;
  /** The host reference of a record the store holds, if the host owns it. */
  ownerOf: (table: TableName, id: string) => HostRef | undefined;
  /** Told about every placement written, so the store's copy stays current. */
  onPlacement: (p: Placement) => void;
  now: () => number;
}

export interface WriterContext {
  adapter: StorageAdapter;
  /** null when standalone. */
  hosted: HostedWriting | null;
}

const PERSONAL: TableName[] = ['groups', 'projects', 'tasks', 'captures'];
const WORK: TableName[] = ['checkpoints', 'sessions', 'dayItems', 'taskWork'];

/** Which of ORBIT's own tables the host keeps. */
export function hostKeeps(a: HostAbilities, table: TableName): boolean {
  if (table === 'placements') return true;
  if (PERSONAL.includes(table)) return a.personal;
  if (WORK.includes(table)) return a.work;
  return false;
}

/** Where a host-owned record goes: a placement for galaxies and systems, nothing (yet) for tasks. */
function routeHostRecord(h: HostedWriting, table: TableName, rec: { id: string } & Partial<{ x: number; y: number }>, ref: HostRef): Placement | null {
  if ((table === 'groups' || table === 'projects') && typeof rec.x === 'number' && typeof rec.y === 'number') {
    const id = table === 'groups' ? placementKey.galaxy(ref.id) : placementKey.system(ref.verse, ref.id);
    return { id, x: Math.round(rec.x), y: Math.round(rec.y), updatedAt: h.now() };
  }
  // Host tasks: dropped in the read-only stage. Next stage: host.tasks.update/create/setStatus, undo on refusal.
  return null;
}

export function createRecordWriter(ctx: () => WriterContext): RecordWriter {
  const ownerOf = (h: HostedWriting, table: TableName, rec: { id: string }) => (rec as { host?: HostRef }).host ?? h.ownerOf(table, rec.id);

  /** Splits a batch into what is stored as-is and the placements that stand in for host-owned records. */
  const sort = (h: HostedWriting, table: TableName, records: { id: string }[]) => {
    const own: { id: string }[] = [];
    const placements: Placement[] = [];
    for (const r of records) {
      const ref = ownerOf(h, table, r);
      if (ref) {
        const p = routeHostRecord(h, table, r, ref);
        if (p) placements.push(p);
      } else if (hostKeeps(h.abilities, table)) own.push(r);
    }
    return { own, placements };
  };

  const writePlacements = async (a: StorageAdapter, h: HostedWriting, ps: Placement[]) => {
    if (!ps.length) return;
    for (const p of ps) h.onPlacement(p);
    await a.bulkPut('placements', ps);
  };

  return {
    async put(table, record) {
      const { adapter, hosted } = ctx();
      if (!hosted) return adapter.put(table, record);
      const { own, placements } = sort(hosted, table, [record]);
      if (own.length) await adapter.put(table, own[0]);
      await writePlacements(adapter, hosted, placements);
    },
    async putMany(table, records) {
      const { adapter, hosted } = ctx();
      if (!hosted) return adapter.bulkPut(table, records);
      const { own, placements } = sort(hosted, table, records);
      if (own.length) await adapter.bulkPut(table, own);
      await writePlacements(adapter, hosted, placements);
    },
    async remove(table, ids) {
      const { adapter, hosted } = ctx();
      if (!hosted) return adapter.remove(table, ids);
      // Host-owned records are never deleted by ORBIT; tables the host does not keep hold nothing to delete.
      if (!hostKeeps(hosted.abilities, table)) return;
      const own = ids.filter((id) => !hosted.ownerOf(table, id));
      if (own.length) await adapter.remove(table, own);
    },
    async setPrefs(prefs) {
      await ctx().adapter.setPrefs(prefs);
    },
    async setFocus(rt) {
      const { adapter, hosted } = ctx();
      if (hosted && !hosted.abilities.work) return; // the host keeps no working state: the timer lives in memory
      await adapter.setFocus(rt);
    },
  };
}
