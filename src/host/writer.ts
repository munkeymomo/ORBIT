/**
 * THE SEAM between the store and storage. Every write the store makes — put, putMany, del, patchRow, prefs and
 * the focus runtime — goes through the writer made here, and nowhere else decides where a record goes.
 *
 * Standalone, it passes everything straight to the StorageAdapter (unchanged behaviour).
 *
 * With a host attached:
 *   - a host-owned galaxy or system is never stored; what is kept is where the person put it, as a placement
 *     (`g|<galaxy id>`, `<verse id>|<system id>`). The store only lets position changes reach this point.
 *   - a host-owned TASK is never stored either. A change to it is split (src/host/work.ts):
 *       · the fields the host owns go to `host.tasks`: `update(id, patch)` with only the fields that differ
 *         from what the host last said (title, notes, due, priority; `system` when it moved), `setStatus` when
 *         todo/done/dropped changed, `create` for a new task (made in memory under a temporary id), `remove`;
 *       · ORBIT's working state for it goes to table `taskWork` in `host.store` (when the host keeps work).
 *     Calls for one task are made one at a time, in order. A refusal (or any rejection) is undone on screen:
 *     exactly the refused fields go back to what the host last said — unless the person has changed that field
 *     again since, in which case the newer change stands and is sent next — and the host's reason is shown.
 *     On success the task the host returns is authoritative for the fields it owns.
 *   - ORBIT's own records go to `host.store` only for what the host keeps: placements and prefs always,
 *     personal tables when the host keeps personal records, working state (checkpoints, sessions, day items,
 *     taskWork, captures and the focus runtime) when it keeps work. Anything else stays in memory.
 */
import type { FocusRuntime, HostRef, Placement, Prefs, TableName, Task, TaskWork } from '../types';
import type { StorageAdapter } from '../data/storage';
import type { HostAbilities } from './caps';
import { refusal } from './caps';
import type { HostTasks, Planet } from './types';
import { placementKey, planetToTask } from './adapt';
import { HOST_FIELDS, hostStatusOf, hostView, isDefaultWork, sameWork, workOf, type HostView } from './work';

export interface WriteOptions {
  /** Sent with a status change or a removal of a host task (the person's words). */
  reason?: string;
}

export interface RecordWriter {
  put(table: TableName, record: { id: string }, opts?: WriteOptions): Promise<void>;
  putMany(table: TableName, records: { id: string }[]): Promise<void>;
  remove(table: TableName, ids: string[], opts?: WriteOptions): Promise<void>;
  setPrefs(prefs: Prefs): Promise<void>;
  setFocus(rt: FocusRuntime | null): Promise<void>;
  /** Hosted: the host tasks now on screen, as a verse just gave them (what the host last said). */
  seed(tasks: Task[]): void;
  /** Hosted: a change to this task is waiting for the host. */
  busy(id: string): boolean;
  /** Resolves when no change is waiting for the host. */
  idle(): Promise<void>;
  /** Hosted: take an attachment off a task (serialised with the task's other changes). True when accepted. */
  detach(taskId: string, link: string): Promise<boolean>;
}

/** What the store gives the writer when a host is attached. */
export interface HostedWriting {
  abilities: HostAbilities;
  /** The host reference of a record the store holds, if the host owns it. */
  ownerOf: (table: TableName, id: string) => HostRef | undefined;
  /** Told about every placement written, so the store's copy stays current. */
  onPlacement: (p: Placement) => void;
  now: () => number;
  /** The host's task API (absent on a read-only host). */
  tasks?: HostTasks;
  /** Told about every taskWork row written (or removed: `null`), so the store's copy stays current. */
  onWork: (id: string, row: TaskWork | null) => void;
  /** The task as it is on screen now. */
  current: (id: string) => Task | undefined;
  /** Change a task on screen only (nothing is written). */
  revise: (id: string, patch: Partial<Task>) => void;
  /** A change was refused: show the reason. */
  refused: (reason: string) => void;
  /** The host accepted a change and returned the task. `settled`: no later change to it is waiting. */
  adopt: (id: string, planet: Planet, settled: boolean) => void;
  /** The host created the task that was on screen under `tempId`. */
  created: (tempId: string, planet: Planet, settled: boolean) => void;
  createRefused: (tempId: string, reason: string) => void;
  /** The host removed the task: clean up what ORBIT kept for it. */
  removed: (id: string) => void;
  removeRefused: (id: string, reason: string) => void;
}

export interface WriterContext {
  adapter: StorageAdapter;
  /** null when standalone. */
  hosted: HostedWriting | null;
}

const PERSONAL: TableName[] = ['groups', 'projects', 'tasks'];
const WORK: TableName[] = ['checkpoints', 'sessions', 'dayItems', 'taskWork'];

/** Which of ORBIT's own tables the host keeps. */
export function hostKeeps(a: HostAbilities, table: TableName): boolean {
  if (table === 'placements') return true;
  if (table === 'captures') return a.personal || a.work;
  if (PERSONAL.includes(table)) return a.personal;
  if (WORK.includes(table)) return a.work;
  return false;
}

/** Where a host-owned galaxy or system goes: a placement (positions only). */
function placementFor(h: HostedWriting, table: TableName, rec: { id: string } & Partial<{ x: number; y: number }>, ref: HostRef): Placement | null {
  if ((table === 'groups' || table === 'projects') && typeof rec.x === 'number' && typeof rec.y === 'number') {
    const id = table === 'groups' ? placementKey.galaxy(ref.id) : placementKey.system(ref.verse, ref.id);
    return { id, x: Math.round(rec.x), y: Math.round(rec.y), updatedAt: h.now() };
  }
  return null;
}

const message = (e: unknown, fallback: string) => {
  const m = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return m.trim() || fallback;
};

const hostViewOfPlanet = (p: Planet): HostView => hostView(planetToTask('', p));

interface Chain {
  tail: Promise<unknown>;
  waiting: number;
}

export function createRecordWriter(ctx: () => WriterContext): RecordWriter {
  /* ---- what the writer knows about host tasks (only meaningful while hosted) ---- */
  /** What the host last said about each task (by the host's id). */
  const confirmed = new Map<string, HostView>();
  /** The task as the writer last saw it (by the host's id): the "before" of the next change. */
  const shadow = new Map<string, Task>();
  /** Calls for one task, one at a time. Shared by a temporary id and the host id that replaces it. */
  const chains = new Map<string, Chain>();
  /** Temporary id → the host's id, once the host has created the task. */
  const alias = new Map<string, string>();
  /** Ids with a taskWork row in the host's store. */
  const workRows = new Set<string>();
  /** Temporary ids of tasks the host has been asked to create. */
  const creating = new Set<string>();

  const real = (id: string) => alias.get(id) ?? id;
  const chainOf = (id: string) => {
    const k = real(id);
    let c = chains.get(k);
    if (!c) chains.set(k, (c = { tail: Promise.resolve(), waiting: 0 }));
    return c;
  };
  const enqueue = <T>(id: string, run: (settled: () => boolean) => Promise<T>): Promise<T> => {
    const c = chainOf(id);
    c.waiting++;
    const settled = () => c.waiting <= 1;
    const p = c.tail.then(() => run(settled));
    c.tail = p
      .catch(() => undefined)
      .finally(() => {
        c.waiting--;
      });
    return p;
  };

  const ownerOf = (h: HostedWriting, table: TableName, rec: { id: string }) => (rec as { host?: HostRef }).host ?? h.ownerOf(table, rec.id);
  const isHostTask = (h: HostedWriting, id: string, rec?: { host?: HostRef }) => !!rec?.host || creating.has(id) || confirmed.has(real(id)) || !!h.ownerOf('tasks', id);

  const writeWork = async (a: StorageAdapter, h: HostedWriting, t: Task) => {
    if (!h.abilities.work) return;
    const row = workOf(t, h.now());
    h.onWork(row.id, row);
    workRows.add(row.id);
    await a.put('taskWork', row);
  };
  const dropWork = async (a: StorageAdapter, h: HostedWriting, id: string) => {
    if (!workRows.has(id) && !h.abilities.work) return;
    workRows.delete(id);
    h.onWork(id, null);
    if (h.abilities.work) await a.remove('taskWork', [id]);
  };

  /** Puts back, on screen, exactly the host-owned fields of `sent` that were refused. */
  const revertFields = (h: HostedWriting, id: string, patch: Record<string, unknown>, sent: Task) => {
    const cur = h.current(id);
    const base = confirmed.get(id);
    if (!cur || !base) return;
    const back: Partial<Task> = {};
    for (const k of Object.keys(patch)) {
      const field = (k === 'system' ? 'projectId' : k) as keyof Task;
      // a newer change to the same field stands (it is waiting to be sent)
      if (JSON.stringify(cur[field] ?? null) !== JSON.stringify(sent[field] ?? null)) continue;
      (back as Record<string, unknown>)[field] = base[k as keyof HostView];
    }
    if (Object.keys(back).length) {
      h.revise(id, back);
      shadow.set(id, { ...(shadow.get(id) ?? cur), ...back });
    }
  };

  /** Puts back, on screen, a refused status change and what came with it (parking, progress, completion). */
  const revertStatus = async (a: StorageAdapter, h: HostedWriting, id: string, sent: Task, before: Task | undefined) => {
    const cur = h.current(id);
    const base = confirmed.get(id);
    if (!cur || !base) return;
    if (cur.status !== sent.status || !!cur.host?.dropped !== !!sent.host?.dropped) return; // changed again since
    let back: Partial<Task>;
    if (before && hostStatusOf(before) === base.status) {
      back = { status: before.status, host: { ...cur.host!, dropped: !!before.host?.dropped } };
      if (cur.completedAt === sent.completedAt) back.completedAt = before.completedAt;
      if (cur.parkedAt === sent.parkedAt) back.parkedAt = before.parkedAt;
      if (cur.progress === sent.progress) back.progress = before.progress;
    } else {
      back = {
        status: base.status === 'todo' ? 'todo' : 'done',
        completedAt: base.status === 'todo' ? null : (cur.completedAt ?? h.now()),
        host: { ...cur.host!, dropped: base.status === 'dropped' },
      };
    }
    h.revise(id, back);
    const next = { ...cur, ...back } as Task;
    shadow.set(id, next);
    if (!sameWork(workOf(cur, 0), workOf(next, 0))) await writeWork(a, h, next);
  };

  const accept = async (a: StorageAdapter, h: HostedWriting, id: string, planet: Planet, settled: boolean) => {
    confirmed.set(id, hostViewOfPlanet(planet));
    const before = h.current(id);
    h.adopt(id, planet, settled);
    const after = h.current(id);
    if (after) shadow.set(id, after);
    // e.g. the host says done while ORBIT had it parked: the parked flag is cleared
    if (before && after && !sameWork(workOf(before, 0), workOf(after, 0))) await writeWork(a, h, after);
  };

  /**
   * Sends what one change did to a host task, in order: fields, then status. A field is sent when this change
   * touched it (it differs from the task as the writer saw it before) and it differs from what the host last
   * said — so a field that a refused earlier change set, and this one only carried along, is not sent again.
   */
  const send = async (a: StorageAdapter, h: HostedWriting, id: string, sent: Task, before: Task | undefined, opts: WriteOptions, settled: () => boolean) => {
    const rid = real(id);
    const base = confirmed.get(rid);
    if (!base) return; // not a task the host knows (a create that was refused, or one already removed)
    const want = hostView(sent);
    const was = before ? hostView(before) : base;
    const touched = (k: keyof HostView) => JSON.stringify(want[k]) !== JSON.stringify(was[k]);
    const patch: Record<string, unknown> = {};
    for (const f of HOST_FIELDS) if (touched(f) && JSON.stringify(want[f]) !== JSON.stringify(base[f])) patch[f] = want[f];
    if (touched('system') && want.system !== base.system) patch.system = want.system;
    const api = h.tasks;
    const kept = refusal.kept(h.abilities);
    if (Object.keys(patch).length) {
      try {
        if (!api || !h.abilities.write) throw new Error(kept);
        const planet = await api.update(rid, patch);
        await accept(a, h, rid, planet, settled());
      } catch (e) {
        revertFields(h, rid, patch, sent);
        h.refused(message(e, kept));
      }
    }
    const now = confirmed.get(rid);
    if (now && touched('status') && want.status !== now.status) {
      try {
        if (!api || !h.abilities.write) throw new Error(kept);
        const planet = opts.reason !== undefined ? await api.setStatus(rid, want.status, opts.reason) : await api.setStatus(rid, want.status);
        await accept(a, h, rid, planet, settled());
      } catch (e) {
        await revertStatus(a, h, rid, sent, before);
        h.refused(message(e, kept));
      }
    }
  };

  /** Asks the host to create a task shown under a temporary id; repoints everything once it answers. */
  const create = (a: StorageAdapter, h: HostedWriting, rec: Task) => {
    creating.add(rec.id);
    return enqueue(rec.id, async (settled) => {
      const tempId = rec.id;
      const fields: { system: string; title: string; notes?: string; due?: string | null; priority?: Task['priority'] } = { system: rec.projectId, title: rec.title, priority: rec.priority };
      if (rec.notes) fields.notes = rec.notes;
      if (rec.due) fields.due = rec.due;
      let planet: Planet;
      try {
        if (!h.tasks || !h.abilities.write) throw new Error(refusal.kept(h.abilities));
        planet = await h.tasks.create(fields);
      } catch (e) {
        shadow.delete(tempId);
        if (workRows.has(tempId)) await dropWork(a, h, tempId);
        h.createRefused(tempId, message(e, refusal.kept(h.abilities)));
        return;
      }
      const id = planet.id;
      alias.set(tempId, id);
      chains.set(id, chains.get(tempId)!);
      confirmed.set(id, hostViewOfPlanet(planet));
      shadow.delete(tempId);
      h.created(tempId, planet, settled());
      const now = h.current(id);
      if (now) {
        shadow.set(id, now);
        if (workRows.has(tempId)) await dropWork(a, h, tempId);
        if (!isDefaultWork(workOf(now, 0))) await writeWork(a, h, now);
      }
    });
  };

  const putHostTask = (a: StorageAdapter, h: HostedWriting, rec: Task, opts: WriteOptions): Promise<void> => {
    const rid = real(rec.id);
    const before = shadow.get(rid);
    shadow.set(rid, rec);
    const work = (() => {
      const w = workOf(rec, 0);
      if (before ? sameWork(workOf(before, 0), w) : isDefaultWork(w)) return Promise.resolve();
      return writeWork(a, h, rec);
    })();
    if (rec.host?.pending && !creating.has(rec.id)) return Promise.all([work, create(a, h, rec)]).then(() => undefined);
    const sent = enqueue(rec.id, (settled) => send(a, h, rec.id, rec, before, opts, settled));
    return Promise.all([work, sent]).then(() => undefined);
  };

  const removeHostTask = (a: StorageAdapter, h: HostedWriting, id: string, opts: WriteOptions) =>
    enqueue(id, async () => {
      const rid = real(id);
      if (!confirmed.has(rid)) {
        // never created (the host refused it): nothing to ask
        h.removed(rid);
        return;
      }
      try {
        if (!h.tasks || !h.abilities.write) throw new Error(refusal.remove(h.abilities));
        await h.tasks.remove(rid, opts.reason ?? '');
      } catch (e) {
        h.removeRefused(rid, message(e, refusal.remove(h.abilities)));
        return;
      }
      confirmed.delete(rid);
      shadow.delete(rid);
      await dropWork(a, h, rid);
      h.removed(rid);
    });

  /** Splits a batch into what is stored as-is, the placements that stand in for host-owned galaxies and
   *  systems, and host tasks (routed to the host). */
  const sort = (h: HostedWriting, table: TableName, records: { id: string }[]) => {
    const own: { id: string }[] = [];
    const placements: Placement[] = [];
    const tasks: Task[] = [];
    for (const r of records) {
      const ref = ownerOf(h, table, r);
      if (table === 'tasks' && isHostTask(h, r.id, r as Task)) tasks.push(r as Task);
      else if (ref) {
        const p = placementFor(h, table, r, ref);
        if (p) placements.push(p);
      } else if (hostKeeps(h.abilities, table)) own.push(r);
    }
    return { own, placements, tasks };
  };

  const writePlacements = async (a: StorageAdapter, h: HostedWriting, ps: Placement[]) => {
    if (!ps.length) return;
    for (const p of ps) h.onPlacement(p);
    await a.bulkPut('placements', ps);
  };

  const write = async (table: TableName, records: { id: string }[], opts: WriteOptions, one: boolean) => {
    const { adapter, hosted } = ctx();
    if (!hosted) return one ? adapter.put(table, records[0]) : adapter.bulkPut(table, records);
    const { own, placements, tasks } = sort(hosted, table, records);
    const jobs: Promise<unknown>[] = tasks.map((t) => putHostTask(adapter, hosted, t, opts));
    if (own.length) jobs.push(one ? adapter.put(table, own[0]) : adapter.bulkPut(table, own));
    jobs.push(writePlacements(adapter, hosted, placements));
    await Promise.all(jobs);
  };

  return {
    put: (table, record, opts = {}) => write(table, [record], opts, true),
    putMany: (table, records) => (records.length ? write(table, records, {}, false) : Promise.resolve()),
    async remove(table, ids, opts = {}) {
      const { adapter, hosted } = ctx();
      if (!hosted) return adapter.remove(table, ids);
      if (table === 'tasks') {
        const host = ids.filter((id) => isHostTask(hosted, id));
        await Promise.all(host.map((id) => removeHostTask(adapter, hosted, id, opts)));
        ids = ids.filter((id) => !host.includes(id));
      }
      // Tables the host does not keep hold nothing to delete; host galaxies and systems are never deleted.
      if (!ids.length || !hostKeeps(hosted.abilities, table)) return;
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
    seed(tasks) {
      const seen = new Set<string>();
      for (const t of tasks) {
        if (!t.host || t.host.pending) continue;
        seen.add(t.id);
        if ((chains.get(t.id)?.waiting ?? 0) > 0) continue; // its own answer will say
        confirmed.set(t.id, hostView(t));
        shadow.set(t.id, t);
      }
      for (const id of [...confirmed.keys()]) {
        if (!seen.has(id) && !((chains.get(id)?.waiting ?? 0) > 0)) {
          confirmed.delete(id);
          shadow.delete(id);
        }
      }
    },
    busy: (id) => (chains.get(real(id))?.waiting ?? 0) > 0,
    async idle() {
      // a call may queue another; wait until nothing is waiting
      for (let i = 0; i < 20; i++) {
        const open = [...chains.values()].filter((c) => c.waiting > 0);
        if (!open.length) return;
        await Promise.all(open.map((c) => c.tail));
      }
    },
    detach(taskId, link) {
      return enqueue(taskId, async () => {
        const { hosted } = ctx();
        if (!hosted) return false;
        try {
          if (!hosted.tasks || !hosted.abilities.write) throw new Error(refusal.kept(hosted.abilities));
          await hosted.tasks.detach(real(taskId), link);
          return true;
        } catch (e) {
          hosted.refused(message(e, refusal.kept(hosted.abilities)));
          return false;
        }
      });
    },
  };
}
