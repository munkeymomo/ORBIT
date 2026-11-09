import { gridSlot, spiralSlot } from '../../src/data/layout';
import { describe, expect, it } from 'vitest';
import Dexie from 'dexie';
import { OrbitDB } from '../../src/data/db';
import { DexieAdapter } from '../../src/data/storage';
import { createBackup, parseBackupText, validateBackup } from '../../src/lib/backup';
import { createOrbitStore } from '../../src/store/store';

let dbn = 0;
const freshName = () => `orbit-test-${++dbn}-${Date.now()}`;

describe('IndexedDB persistence', () => {
  it('round-trips every table through Dexie', async () => {
    const name = freshName();
    const adapter = new DexieAdapter(new OrbitDB(name));
    const store = createOrbitStore();
    await store.getState().init(adapter);
    await store.getState().loadExample();
    const s = store.getState();
    s.startFocus({ taskId: s.tasks[0].id });
    s.setPrefs({ theme: 'light', focusMin: 45 });
    await new Promise((r) => setTimeout(r, 50));
    adapter.close();

    const reopened = new DexieAdapter(new OrbitDB(name));
    const loaded = await reopened.load();
    const before = store.getState().snapshot();
    for (const k of ['projects', 'groups', 'tasks', 'checkpoints', 'sessions', 'captures', 'dayItems'] as const) {
      expect(loaded[k].length, k).toBe(before[k].length);
    }
    expect(loaded.prefs.focusMin).toBe(45);
    expect(loaded.focus?.taskId).toBe(before.focus?.taskId);
    reopened.close();
  });

  it('records tombstones for deletions (sync-ready)', async () => {
    const name = freshName();
    const db = new OrbitDB(name);
    const adapter = new DexieAdapter(db);
    await adapter.put('projects', { id: 'p1', name: 'x' } as never);
    await adapter.remove('projects', ['p1']);
    expect(await db.projects.count()).toBe(0);
    expect((await db.tombstones.get('p1'))?.table).toBe('projects');
    db.close();
  });

  it('upgrades a v1 database to the current schema', async () => {
    const name = freshName();
    const v1 = new OrbitDB(name, 1);
    await v1.open();
    expect(v1.verno).toBe(1);
    // A v1-era task: no links, no dependsOn, no energy, bad priority.
    await v1.table('tasks').put({ id: 't1', projectId: 'p1', title: 'Old task', status: 'todo', priority: 9, subtasks: [] });
    await v1.table('projects').put({ id: 'p1', name: 'Old project', color: 'violet', icon: 'orbit' });
    v1.close();

    const v2 = new OrbitDB(name);
    await v2.open();
    expect(v2.verno).toBe(4);
    const t = await v2.tasks.get('t1');
    expect(t).toMatchObject({ links: [], dependsOn: [], energy: 'medium', priority: 2, due: null });
    const p = await v2.projects.get('p1');
    expect(p).toMatchObject({ groupId: null, archived: false, x: 0, y: 0 }); // sole deep-space project sits at its centre
    expect(v2.tables.map((x) => x.name)).toContain('tombstones');
    v2.close();
  });

  it('upgrades a v2 universe to galaxies (v3), keeping each group’s arrangement', async () => {
    const name = freshName();
    const v2 = new OrbitDB(name, 2);
    await v2.open();
    await v2.table('groups').bulkPut([
      { id: 'g1', name: 'Work', color: 'violet', createdAt: 1, updatedAt: 1 },
      { id: 'g2', name: 'Life', color: 'teal', createdAt: 1, updatedAt: 1 },
    ]);
    await v2.table('projects').bulkPut([
      { id: 'a', name: 'A', groupId: 'g1', x: -100, y: 0, color: 'amber', icon: 'orbit', archived: false },
      { id: 'b', name: 'B', groupId: 'g1', x: 100, y: 0, color: 'amber', icon: 'orbit', archived: false },
      { id: 'c', name: 'C', groupId: 'g2', x: 900, y: 400, color: 'amber', icon: 'orbit', archived: false },
      { id: 'd', name: 'D', groupId: null, x: 50, y: 50, color: 'amber', icon: 'orbit', archived: false },
    ]);
    await v2.table('kv').put({ key: 'prefs', value: { theme: 'light', focusMin: 45 } });
    v2.close();

    const v3 = new OrbitDB(name);
    await v3.open();
    expect(v3.verno).toBe(4);
    const groups = await v3.groups.toArray();
    const [g1, g2] = groups.sort((x, y) => x.id.localeCompare(y.id));
    expect(Number.isFinite(g1.x) && Number.isFinite(g1.y)).toBe(true);
    expect(Math.hypot(g1.x - g2.x, g1.y - g2.y)).toBeGreaterThanOrEqual(3000); // galaxies well apart
    const a = (await v3.projects.get('a'))!;
    const b = (await v3.projects.get('b'))!;
    const c = (await v3.projects.get('c'))!;
    // relative to the galaxy centre, left/right order kept and spread out
    expect(a.x).toBeLessThan(0);
    expect(b.x).toBeGreaterThan(0);
    expect(b.x - a.x).toBeGreaterThanOrEqual(400);
    expect(c).toMatchObject({ x: 0, y: 0 }); // only system in its galaxy → centre
    const prefs = (await v3.kv.get('prefs'))!.value as { deepSpace: { x: number; y: number }; theme: string; focusMin: number };
    expect(prefs).toMatchObject({ theme: 'light', focusMin: 45 }); // other prefs untouched
    expect(Math.hypot(prefs.deepSpace.x - g1.x, prefs.deepSpace.y - g1.y)).toBeGreaterThanOrEqual(3000);
    // tasks untouched by the layout upgrade
    v3.close();
  });

  it('upgrades v3 to v4: grid-placed galaxies move onto the spiral, ones the user moved stay put', async () => {
    const name = freshName();
    const v3 = new OrbitDB(name, 3);
    await v3.open();
    await v3.table('groups').bulkPut([
      { id: 'g1', name: 'First', color: 'violet', createdAt: 1, updatedAt: 1, ...gridSlot(0) },
      { id: 'g2', name: 'Second', color: 'teal', createdAt: 2, updatedAt: 2, ...gridSlot(1) },
      { id: 'g3', name: 'Moved by hand', color: 'rose', createdAt: 3, updatedAt: 3, x: 12345, y: -777 },
      { id: 'g4', name: 'Fourth', color: 'amber', createdAt: 4, updatedAt: 4, ...gridSlot(2) },
    ]);
    await v3.table('projects').bulkPut([
      { id: 'a', name: 'A', groupId: 'g2', x: 120, y: -80, color: 'amber', icon: 'orbit', archived: false },
      { id: 'loose', name: 'Loose', groupId: null, x: 40, y: 0, color: 'amber', icon: 'orbit', archived: false },
    ]);
    await v3.table('kv').put({ key: 'prefs', value: { theme: 'dark', deepSpace: gridSlot(3) } });
    v3.close();

    const v4 = new OrbitDB(name);
    await v4.open();
    expect(v4.verno).toBe(4);
    const byId = Object.fromEntries((await v4.groups.toArray()).map((g) => [g.id, g]));
    expect(byId.g3).toMatchObject({ x: 12345, y: -777 }); // hand-placed: untouched
    expect(byId.g1).toMatchObject(spiralSlot(0)); // oldest at the centre
    expect(byId.g2).toMatchObject(spiralSlot(1));
    expect(byId.g2).not.toMatchObject(gridSlot(1));
    // systems keep their place inside their galaxy
    expect(await v4.projects.get('a')).toMatchObject({ groupId: 'g2', x: 120, y: -80 });
    const prefs = (await v4.kv.get('prefs'))!.value as { theme: string; deepSpace: { x: number; y: number } };
    expect(prefs.theme).toBe('dark');
    const centres = [...Object.values(byId), prefs.deepSpace];
    for (let i = 0; i < centres.length; i++)
      for (let j = i + 1; j < centres.length; j++) expect(Math.hypot(centres[i].x - centres[j].x, centres[i].y - centres[j].y)).toBeGreaterThanOrEqual(3000);
    v4.close();
  });

  it('restore is all-or-nothing', async () => {
    const name = freshName();
    const db = new OrbitDB(name);
    const adapter = new DexieAdapter(db);
    const store = createOrbitStore();
    await store.getState().init(adapter);
    store.getState().createProject({ name: 'Keep me' });
    await new Promise((r) => setTimeout(r, 20));

    const bad = store.getState().snapshot();
    // A record that IndexedDB cannot store (no key) makes the transaction abort.
    (bad.tasks as unknown[]).push({ title: 'no id' });
    await expect(adapter.replaceAll(bad)).rejects.toBeTruthy();
    const after = await adapter.load();
    expect(after.projects.map((p) => p.name)).toEqual(['Keep me']);
    db.close();
    await Dexie.delete(name);
  });
});

describe('backup files', () => {
  it('exports and validates a full backup', async () => {
    const store = createOrbitStore();
    await store.getState().init(new (await import('../../src/data/storage')).MemoryAdapter());
    await store.getState().loadExample();
    const file = createBackup(store.getState().snapshot());
    const res = parseBackupText(JSON.stringify(file));
    expect(res.ok).toBe(true);
    expect(res.counts!.tasks).toBe(store.getState().tasks.length);
  });

  it('rejects files that are not ORBIT backups', () => {
    expect(parseBackupText('not json').ok).toBe(false);
    expect(validateBackup({ hello: 1 }).errors[0]).toMatch(/not an ORBIT backup/);
    expect(validateBackup({ app: 'orbit', schemaVersion: 99 }).errors[0]).toMatch(/newer version/);
  });

  it('reports missing ids and names', () => {
    const r = validateBackup({ app: 'orbit', schemaVersion: 2, projects: [{ name: 'x' }], groups: [], tasks: [], checkpoints: [], sessions: [], captures: [], dayItems: [] });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/no id/);
  });

  it('skips orphaned tasks with a warning and drops dangling dependencies', () => {
    const r = validateBackup({
      app: 'orbit',
      schemaVersion: 2,
      projects: [{ id: 'p', name: 'P' }],
      groups: [],
      tasks: [
        { id: 'a', projectId: 'p', title: 'A', dependsOn: ['ghost'] },
        { id: 'b', projectId: 'missing', title: 'B' },
      ],
      checkpoints: [],
      sessions: [],
      captures: [],
      dayItems: [],
    });
    expect(r.ok).toBe(true);
    expect(r.warnings[0]).toMatch(/1 task/);
    expect(r.data!.tasks.map((t) => t.id)).toEqual(['a']);
    expect(r.data!.tasks[0].dependsOn).toEqual([]);
  });

  it('migrates a v2 backup to galaxy layout', () => {
    const r = validateBackup({
      app: 'orbit',
      schemaVersion: 2,
      projects: [
        { id: 'p', name: 'P', groupId: 'g', x: 10, y: 10 },
        { id: 'q', name: 'Q', groupId: 'g', x: 210, y: 10 },
      ],
      groups: [{ id: 'g', name: 'G', color: 'violet' }],
      tasks: [],
      checkpoints: [],
      sessions: [],
      captures: [],
      dayItems: [],
      prefs: { focusMin: 50 },
    });
    expect(r.ok).toBe(true);
    expect(r.data!.groups[0]).toMatchObject({ x: 0, y: 0 });
    expect(r.data!.projects.map((p) => p.x)).toEqual([-220, 220]);
    expect(r.data!.prefs.focusMin).toBe(50);
    expect(r.data!.prefs.deepSpace).toBeDefined();
  });

  it('migrates a v3 backup onto the spiral, keeping hand-placed galaxies', () => {
    const r = validateBackup({
      app: 'orbit',
      schemaVersion: 3,
      projects: [],
      groups: [
        { id: 'g', name: 'G', color: 'violet', createdAt: 1, ...gridSlot(0) },
        { id: 'h', name: 'H', color: 'teal', createdAt: 2, ...gridSlot(1) },
        { id: 'm', name: 'M', color: 'rose', createdAt: 3, x: -9000, y: 4000 },
      ],
      tasks: [],
      checkpoints: [],
      sessions: [],
      captures: [],
      dayItems: [],
      prefs: { deepSpace: gridSlot(2) },
    });
    expect(r.ok).toBe(true);
    const g = Object.fromEntries(r.data!.groups.map((x) => [x.id, x]));
    expect(g.h).toMatchObject(spiralSlot(1));
    expect(g.m).toMatchObject({ x: -9000, y: 4000 });
  });

  it('migrates a v1 backup (no groups, sparse tasks)', () => {
    const r = validateBackup({
      app: 'orbit',
      schemaVersion: 1,
      projects: [{ id: 'p', name: 'P' }],
      tasks: [{ id: 'a', projectId: 'p', title: 'A' }],
      checkpoints: [],
      sessions: [],
      captures: [],
      dayItems: [],
    });
    expect(r.ok).toBe(true);
    expect(r.data!.groups).toEqual([]);
    expect(r.data!.tasks[0]).toMatchObject({ links: [], energy: 'medium' });
  });
});

describe('write-ahead journal', () => {
  it('replays writes that never reached IndexedDB (tab closed mid-write)', async () => {
    const { JournalAdapter, MemoryAdapter } = await import('../../src/data/storage');
    localStorage.clear();
    const disk = new MemoryAdapter();
    // An inner adapter whose writes hang forever, like a transaction aborted by unload.
    const hanging = Object.assign(Object.create(disk), {
      put: () => new Promise<void>(() => {}),
      setFocus: () => new Promise<void>(() => {}),
    });
    const tab1 = new JournalAdapter(hanging, localStorage, 'tab1');
    void tab1.put('tasks', { id: 't1', title: 'parked task', status: 'parked' } as never);
    void tab1.setFocus(null);
    expect(localStorage.getItem('orbit-wal-tab1')).toContain('parked task');

    // Next start: a new tab recovers the journal into the real store.
    const tab2 = new JournalAdapter(disk, localStorage, 'tab2');
    const snap = await tab2.load();
    expect(snap.tasks[0]).toMatchObject({ id: 't1', status: 'parked' });
    expect(localStorage.getItem('orbit-wal-tab1')).toBeNull();
  });

  it('clears its own journal once writes are confirmed', async () => {
    const { JournalAdapter, MemoryAdapter } = await import('../../src/data/storage');
    localStorage.clear();
    const j = new JournalAdapter(new MemoryAdapter(), localStorage, 'tab3');
    await j.put('projects', { id: 'p', name: 'P' } as never);
    expect(localStorage.getItem('orbit-wal-tab3')).toBeNull();
  });
});
