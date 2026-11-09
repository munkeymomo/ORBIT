import type { FocusRuntime, Prefs, Snapshot, TableName } from '../types';
import { OrbitDB } from './db';
import { DEFAULT_PREFS } from './normalise';

/**
 * Everything the app knows about persistence. The store only talks to this
 * interface, so a future sync adapter can wrap or replace it without UI changes.
 */
export interface StorageAdapter {
  readonly kind: 'indexeddb' | 'memory';
  load(): Promise<Snapshot>;
  put(table: TableName, record: { id: string }): Promise<void>;
  bulkPut(table: TableName, records: { id: string }[]): Promise<void>;
  remove(table: TableName, ids: string[]): Promise<void>;
  setPrefs(prefs: Prefs): Promise<void>;
  setFocus(rt: FocusRuntime | null): Promise<void>;
  /** Atomic: either everything is replaced or nothing changes. */
  replaceAll(s: Snapshot): Promise<void>;
}

const TABLES: TableName[] = ['projects', 'groups', 'tasks', 'checkpoints', 'sessions', 'captures', 'dayItems'];

export function emptySnapshot(): Snapshot {
  return {
    projects: [],
    groups: [],
    tasks: [],
    checkpoints: [],
    sessions: [],
    captures: [],
    dayItems: [],
    prefs: { ...DEFAULT_PREFS },
    focus: null,
  };
}

export class DexieAdapter implements StorageAdapter {
  readonly kind = 'indexeddb' as const;
  constructor(private db: OrbitDB) {}

  static async open(name = 'orbit'): Promise<DexieAdapter> {
    const db = new OrbitDB(name);
    await db.open();
    return new DexieAdapter(db);
  }

  async load(): Promise<Snapshot> {
    const d = this.db;
    const [projects, groups, tasks, checkpoints, sessions, captures, dayItems, prefsRow, focusRow] = await Promise.all([
      d.projects.toArray(),
      d.groups.toArray(),
      d.tasks.toArray(),
      d.checkpoints.toArray(),
      d.sessions.toArray(),
      d.captures.toArray(),
      d.dayItems.toArray(),
      d.kv.get('prefs'),
      d.kv.get('focus'),
    ]);
    return {
      projects,
      groups,
      tasks,
      checkpoints,
      sessions,
      captures,
      dayItems,
      prefs: { ...DEFAULT_PREFS, ...((prefsRow?.value as Partial<Prefs>) ?? {}) },
      focus: (focusRow?.value as FocusRuntime | undefined) ?? null,
    };
  }

  async put(table: TableName, record: { id: string }) {
    await this.db.table(table).put(record);
  }

  async bulkPut(table: TableName, records: { id: string }[]) {
    if (records.length) await this.db.table(table).bulkPut(records);
  }

  async remove(table: TableName, ids: string[]) {
    if (!ids.length) return;
    const now = Date.now();
    await this.db.transaction('rw', this.db.table(table), this.db.tombstones, async () => {
      await this.db.table(table).bulkDelete(ids);
      await this.db.tombstones.bulkPut(ids.map((id) => ({ id, table, deletedAt: now })));
    });
  }

  async setPrefs(prefs: Prefs) {
    await this.db.kv.put({ key: 'prefs', value: prefs });
  }

  async setFocus(rt: FocusRuntime | null) {
    if (rt) await this.db.kv.put({ key: 'focus', value: rt });
    else await this.db.kv.delete('focus');
  }

  async replaceAll(s: Snapshot) {
    const d = this.db;
    const tables = [...TABLES.map((t) => d.table(t)), d.kv, d.tombstones];
    await d.transaction('rw', tables, async () => {
      for (const t of TABLES) {
        await d.table(t).clear();
        const rows = s[t] as { id: string }[];
        if (rows.length) await d.table(t).bulkPut(rows);
      }
      await d.tombstones.clear();
      await d.kv.clear();
      await d.kv.put({ key: 'prefs', value: s.prefs });
      if (s.focus) await d.kv.put({ key: 'focus', value: s.focus });
    });
  }

  close() {
    this.db.close();
  }
}

/** Used in tests, and as a visible fallback when IndexedDB is unavailable. */
export class MemoryAdapter implements StorageAdapter {
  readonly kind = 'memory' as const;
  private data: Snapshot;
  /** Set to make every write fail (tests the error path). */
  failWrites = false;

  constructor(initial?: Snapshot) {
    this.data = initial ? structuredClone(initial) : emptySnapshot();
  }

  private guard() {
    if (this.failWrites) throw new Error('Simulated storage failure');
  }

  async load() {
    return structuredClone(this.data);
  }

  async put(table: TableName, record: { id: string }) {
    this.guard();
    const rows = this.data[table] as { id: string }[];
    const i = rows.findIndex((r) => r.id === record.id);
    if (i >= 0) rows[i] = structuredClone(record);
    else rows.push(structuredClone(record));
  }

  async bulkPut(table: TableName, records: { id: string }[]) {
    for (const r of records) await this.put(table, r);
  }

  async remove(table: TableName, ids: string[]) {
    this.guard();
    const set = new Set(ids);
    (this.data[table] as { id: string }[]) = (this.data[table] as { id: string }[]).filter((r) => !set.has(r.id));
  }

  async setPrefs(prefs: Prefs) {
    this.guard();
    this.data.prefs = structuredClone(prefs);
  }

  async setFocus(rt: FocusRuntime | null) {
    this.guard();
    this.data.focus = rt ? structuredClone(rt) : null;
  }

  async replaceAll(s: Snapshot) {
    this.guard();
    this.data = structuredClone(s);
  }
}

/**
 * Write-ahead journal. IndexedDB writes are asynchronous, so a tab closed (or a
 * laptop lid shut) a few milliseconds after parking could lose the write. Every
 * operation is first recorded synchronously in localStorage and removed once
 * IndexedDB confirms it; anything left over is replayed on the next start.
 */
export class JournalAdapter implements StorageAdapter {
  static readonly PREFIX = 'orbit-wal-';
  readonly kind: StorageAdapter['kind'];
  private seq = 0;
  private pending = new Map<number, JournalOp>();
  private key: string;

  constructor(
    private inner: StorageAdapter,
    private ls: Storage | null = safeLocalStorage(),
    tabId = Math.random().toString(36).slice(2, 10),
  ) {
    this.kind = inner.kind;
    this.key = JournalAdapter.PREFIX + tabId;
  }

  private persistJournal() {
    if (!this.ls) return;
    try {
      if (this.pending.size) this.ls.setItem(this.key, JSON.stringify([...this.pending.values()]));
      else this.ls.removeItem(this.key);
    } catch {
      /* quota or blocked: IndexedDB write still proceeds */
    }
  }

  private async run(op: Omit<JournalOp, 'seq' | 'at'>, fn: () => Promise<void>) {
    const seq = ++this.seq;
    this.pending.set(seq, { ...op, seq, at: Date.now() });
    this.persistJournal();
    await fn();
    this.pending.delete(seq);
    this.persistJournal();
  }

  /** Replays journals left by tabs that closed before IndexedDB confirmed their writes. */
  async recover(): Promise<number> {
    if (!this.ls) return 0;
    const keys: string[] = [];
    for (let i = 0; i < this.ls.length; i++) {
      const k = this.ls.key(i);
      if (k?.startsWith(JournalAdapter.PREFIX) && k !== this.key) keys.push(k);
    }
    const ops: JournalOp[] = [];
    for (const k of keys) {
      try {
        ops.push(...(JSON.parse(this.ls.getItem(k) ?? '[]') as JournalOp[]));
      } catch {
        /* corrupt journal: skip */
      }
    }
    ops.sort((a, b) => a.at - b.at || a.seq - b.seq);
    for (const op of ops) await applyOp(this.inner, op);
    for (const k of keys) this.ls.removeItem(k);
    return ops.length;
  }

  async load() {
    await this.recover();
    return this.inner.load();
  }
  put(table: TableName, record: { id: string }) {
    return this.run({ op: 'put', table, data: record }, () => this.inner.put(table, record));
  }
  bulkPut(table: TableName, records: { id: string }[]) {
    if (!records.length) return Promise.resolve();
    return this.run({ op: 'bulkPut', table, data: records }, () => this.inner.bulkPut(table, records));
  }
  remove(table: TableName, ids: string[]) {
    if (!ids.length) return Promise.resolve();
    return this.run({ op: 'remove', table, data: ids }, () => this.inner.remove(table, ids));
  }
  setPrefs(prefs: Prefs) {
    return this.run({ op: 'prefs', data: prefs }, () => this.inner.setPrefs(prefs));
  }
  setFocus(rt: FocusRuntime | null) {
    return this.run({ op: 'focus', data: rt }, () => this.inner.setFocus(rt));
  }
  async replaceAll(s: Snapshot) {
    await this.inner.replaceAll(s);
    // Anything still pending predates the restore and must not be replayed over it.
    this.pending.clear();
    this.persistJournal();
  }
}

interface JournalOp {
  seq: number;
  at: number;
  op: 'put' | 'bulkPut' | 'remove' | 'prefs' | 'focus';
  table?: TableName;
  data: unknown;
}

async function applyOp(a: StorageAdapter, op: JournalOp) {
  try {
    if (op.op === 'put') await a.put(op.table!, op.data as { id: string });
    else if (op.op === 'bulkPut') await a.bulkPut(op.table!, op.data as { id: string }[]);
    else if (op.op === 'remove') await a.remove(op.table!, op.data as string[]);
    else if (op.op === 'prefs') await a.setPrefs(op.data as Prefs);
    else if (op.op === 'focus') await a.setFocus(op.data as FocusRuntime | null);
  } catch (e) {
    console.error('[orbit] journal replay failed', op, e);
  }
}

function safeLocalStorage(): Storage | null {
  try {
    const ls = window.localStorage;
    const k = '__orbit_probe__';
    ls.setItem(k, '1');
    ls.removeItem(k);
    return ls;
  } catch {
    return null;
  }
}

/** Opens IndexedDB, falling back to memory (with a reason) if the browser refuses. */
export async function openStorage(): Promise<{ adapter: StorageAdapter; error: string | null }> {
  try {
    if (typeof indexedDB === 'undefined') throw new Error('IndexedDB is not available in this browser.');
    const db = await Promise.race([
      DexieAdapter.open(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('Opening the database timed out.')), 6000)),
    ]);
    return { adapter: new JournalAdapter(db), error: null };
  } catch (e) {
    return { adapter: new MemoryAdapter(), error: e instanceof Error ? e.message : String(e) };
  }
}
