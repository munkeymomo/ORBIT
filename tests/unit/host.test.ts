import { afterEach, describe, expect, it, vi } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import schemaText from '../../src/host/host-protocol-v1.schema.json?raw';
import { createFakeHost, demoVerse, type FakeHost } from '../../src/host/fakeHost';
import { adaptVerse, DEEP_SPACE, placementKey } from '../../src/host/adapt';
import { detectHost, findHost } from '../../src/host/detect';
import { startHostRefresh } from '../../src/host/refresh';
import { abilities, BUILD_SUPPORTS } from '../../src/host/caps';
import type { Handshake, OrbitHost } from '../../src/host/types';
import { createOrbitStore } from '../../src/store/store';
import { emptySnapshot, MemoryAdapter } from '../../src/data/storage';
import { GALAXY_SPACING, SYSTEM_SPACING } from '../../src/data/layout';
import type { TableName } from '../../src/types';

const NOW = Date.UTC(2026, 10, 10, 9, 0, 0);

/* ---------------- helpers ---------------- */

const win = (props: Record<string, unknown>) => ({ location: { search: '' }, ...props }) as unknown as Window;

/** A host store that records every write by table. */
function spyOn(host: FakeHost) {
  const writes: string[] = [];
  const s = host.store;
  const wrap = <K extends 'put' | 'bulkPut' | 'remove'>(k: K) => {
    const orig = s[k].bind(s) as (t: TableName, x: never) => Promise<void>;
    (s as unknown as Record<string, unknown>)[k] = (t: TableName, x: never) => {
      writes.push(t);
      return orig(t, x);
    };
  };
  wrap('put');
  wrap('bulkPut');
  wrap('remove');
  const prefs = s.setPrefs.bind(s);
  s.setPrefs = (p) => (writes.push('prefs'), prefs(p));
  const focus = s.setFocus.bind(s);
  s.setFocus = (f) => (writes.push('focus'), focus(f));
  const replace = s.replaceAll.bind(s);
  s.replaceAll = (x) => (writes.push('replaceAll'), replace(x));
  return writes;
}

async function hosted(opts: { placements?: { id: string; x: number; y: number }[] } = {}) {
  const host = createFakeHost({ now: NOW });
  if (opts.placements) await host.store.bulkPut('placements', opts.placements.map((p) => ({ ...p, updatedAt: 1 })));
  const writes = spyOn(host);
  const info = await host.handshake();
  const store = createOrbitStore({ now: () => NOW });
  await store.getState().init(new MemoryAdapter(), null, { host: { host, info } });
  const s = () => store.getState();
  await new Promise((r) => setTimeout(r, 0));
  writes.length = 0;
  return { host, store, s, writes, info };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
});

/* ---------------- schema ---------------- */

describe('the fake host speaks protocol 1 (validated against the JSON Schema)', () => {
  const schema = JSON.parse(schemaText);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(schema);
  const check = (def: string, doc: unknown) => {
    const v = ajv.getSchema(`${schema.$id}#/$defs/${def}`)!;
    const ok = v(doc);
    return ok ? [] : v.errors;
  };

  it('handshake, verse and unchanged all validate', async () => {
    const host = createFakeHost({ now: NOW });
    expect(check('handshake', await host.handshake())).toEqual([]);
    const v = await host.verse('main');
    expect(check('verse', v)).toEqual([]);
    expect(check('unchanged', await host.verse('main', (v as { rev: string }).rev))).toEqual([]);
  });

  it('covers what the read-only stage draws', () => {
    const v = demoVerse(NOW);
    expect(v.galaxies.some((g) => g.finished)).toBe(true);
    expect(v.galaxies.some((g) => g.virtual)).toBe(true);
    // two clusters: one of three galaxies, one of two
    expect(new Set(v.galaxies.filter((g) => g.cluster).map((g) => g.cluster)).size).toBe(2);
    expect(v.galaxies.filter((g) => g.cluster === 'c-trade').length).toBe(2);
    expect(v.galaxies.filter((g) => g.cluster).length).toBeGreaterThanOrEqual(2);
    expect(v.systems.some((s) => s.virtual)).toBe(true);
    expect(v.systems.some((s) => s.note)).toBe(true);
    expect(v.systems.some((s) => s.galaxy === null)).toBe(true);
    const tasks = v.planets.filter((p) => p.type === 'task');
    expect(new Set(tasks.map((t) => t.priority))).toEqual(new Set([1, 2, 3, 4]));
    expect(tasks.some((t) => t.dropped)).toBe(true);
    expect(tasks.some((t) => t.status === 'done')).toBe(true);
    const states = new Set(tasks.flatMap((t) => t.attachments ?? []).map((a) => a.state));
    expect(states).toEqual(new Set(['live', 'archived', 'gone']));
    expect(tasks.some((t) => (t.attachments?.length ?? 0) > 5)).toBe(true);
    expect(tasks.some((t) => (t.more ?? 0) > 0)).toBe(true);
    expect(v.collections!.some((c) => c.total > 60 && c.counts)).toBe(true);
    expect(v.collections!.some((c) => c.total <= 60 && c.items?.length)).toBe(true);
    expect(new Set(v.beacons!.map((b) => b.state))).toEqual(new Set(['planned', 'soon', 'late', 'achieved', 'rescoped']));
    expect(v.beacons!.some((b) => b.galaxy) && v.beacons!.some((b) => b.system)).toBe(true);
    const bySystem = new Map<string, number>();
    for (const t of tasks) if (t.status !== 'done' && !t.dropped) bySystem.set(t.system, (bySystem.get(t.system) ?? 0) + 1);
    expect(Math.max(...bySystem.values())).toBeGreaterThan(40);
  });

  it('offers no capabilities by default; this build supports write, work, personal and adopt', async () => {
    const info = await createFakeHost().handshake();
    expect(info.caps).toEqual({ write: false, personal: false, work: false });
    expect(abilities(info)).toMatchObject({ write: false, personal: false, work: false, capture: false, plans: false, adopt: false });
    expect(BUILD_SUPPORTS).toEqual({ write: true, personal: true, work: true, adopt: true });
    // a host offering everything gets what this build supports
    const a = abilities({ ...info, caps: { write: true, personal: true, work: true, adopt: true } });
    expect([a.write, a.personal, a.work, a.adopt]).toEqual([true, true, true, true]);
    // adopt needs personal and work as well
    expect(abilities({ ...info, caps: { personal: true, adopt: true } }).adopt).toBe(false);
  });
});

/* ---------------- adapt ---------------- */

describe('adaptVerse', () => {
  const v = demoVerse(NOW);

  it('maps galaxies to groups, systems to projects and task planets to tasks, with the host’s ids', () => {
    const a = adaptVerse(v, []);
    expect(a.groups.map((g) => g.id)).toEqual(v.galaxies.map((g) => g.id));
    expect(a.projects.map((p) => p.id)).toEqual(v.systems.map((s) => s.id));
    expect(a.tasks.length).toBe(v.planets.filter((p) => p.type === 'task').length);
    expect(a.skipped).toBe(1); // the one item planet
    const beds = a.projects.find((p) => p.id === 's-beds')!;
    expect(beds).toMatchObject({ groupId: 'g-garden', name: 'Vegetable beds', description: 'Soil test results due back in two weeks.' });
    expect(beds.host).toMatchObject({ id: 's-beds', kind: 'system', verse: 'main', code: 'GD-1', caps: {} });
    expect(a.groups.find((g) => g.id === 'g-garden')!.host).toMatchObject({ chip: 'Outdoor · in season', cluster: 'c-home' });
    expect(a.groups.find((g) => g.id === 'g-flat')!.host!.finished).toBe(true);
    expect(a.groups.find((g) => g.id === 'g-loose')!.host!.virtual).toBe(true);
  });

  it('maps status: todo → todo, done → done, dropped → done (marked dropped)', () => {
    const a = adaptVerse(v, []);
    const by = (id: string) => a.tasks.find((t) => t.id === id)!;
    expect(by('t-compost').status).toBe('todo');
    expect(by('t-seeds')).toMatchObject({ status: 'done', progress: 100 });
    expect(by('t-mulch').status).toBe('done');
    expect(by('t-mulch').host!.dropped).toBe(true);
    expect(by('t-soil').priority).toBe(4);
  });

  it('puts systems with galaxy null in deep space', () => {
    const a = adaptVerse(v, []);
    expect(a.projects.find((p) => p.id === 's-odd')!.groupId).toBeNull();
    expect(a.deepSpace).not.toBeNull();
    const none = adaptVerse({ ...v, systems: v.systems.filter((s) => s.galaxy) }, []);
    expect(none.deepSpace).toBeNull();
  });

  it('keeps attachments (with more), collections and beacons in their own slice', () => {
    const a = adaptVerse(v, []);
    expect(a.extras.attachments['t-raised-bed'].items).toHaveLength(7);
    expect(a.extras.attachments['t-raised-bed'].more).toBe(3);
    expect(a.extras.attachments['t-van'].more).toBe(4);
    expect(a.extras.collections['s-recipes'].total).toBe(140);
    expect(a.extras.beacons).toHaveLength(v.beacons!.length);
    expect(a.extras.clusters[0].name).toBe('Around the house');
  });

  it('auto-places deterministically and keeps galaxies and systems apart', () => {
    const a = adaptVerse(v, []);
    const b = adaptVerse(structuredClone(v), []);
    expect(a.groups.map((g) => [g.x, g.y])).toEqual(b.groups.map((g) => [g.x, g.y]));
    expect(a.projects.map((p) => [p.x, p.y])).toEqual(b.projects.map((p) => [p.x, p.y]));
    const centres = [...a.groups, a.deepSpace!];
    for (let i = 0; i < centres.length; i++)
      for (let j = i + 1; j < centres.length; j++) expect(Math.hypot(centres[i].x - centres[j].x, centres[i].y - centres[j].y)).toBeGreaterThanOrEqual(GALAXY_SPACING * 0.8);
    const garden = a.projects.filter((p) => p.groupId === 'g-garden');
    for (let i = 0; i < garden.length; i++)
      for (let j = i + 1; j < garden.length; j++) expect(Math.hypot(garden[i].x - garden[j].x, garden[i].y - garden[j].y)).toBeGreaterThanOrEqual(SYSTEM_SPACING);
  });

  it('applies placements for galaxies (shared key), systems (per verse) and deep space', () => {
    const a = adaptVerse(v, [
      { id: placementKey.galaxy('g-bakery'), x: 99999, y: -5000, updatedAt: 1 },
      { id: placementKey.system('main', 's-pond'), x: 1234, y: 56, updatedAt: 1 },
      { id: placementKey.system('other', 's-beds'), x: 7, y: 7, updatedAt: 1 },
      { id: placementKey.galaxy(DEEP_SPACE), x: -40000, y: 0, updatedAt: 1 },
    ]);
    expect(a.groups.find((g) => g.id === 'g-bakery')).toMatchObject({ x: 99999, y: -5000 });
    expect(a.projects.find((p) => p.id === 's-pond')).toMatchObject({ x: 1234, y: 56 });
    expect(a.projects.find((p) => p.id === 's-beds')).not.toMatchObject({ x: 7, y: 7 }); // another verse's placement
    expect(a.deepSpace).toEqual({ x: -40000, y: 0 });
  });

  it('survives item-only and empty verses', () => {
    expect(() => adaptVerse({ verse: 'x', rev: '1', families: {}, galaxies: [], systems: [], planets: [] }, [])).not.toThrow();
    const items = adaptVerse({ ...v, planets: v.planets.map((p) => ({ ...p, type: 'item' as const, kind: 'k', family: 'tool' })) }, []);
    expect(items.tasks).toEqual([]);
  });
});

/* ---------------- detect ---------------- */

describe('detectHost', () => {
  it('finds a host on the window', async () => {
    const host = createFakeHost();
    const d = await detectHost(win({ orbitHost: host }));
    expect(d.kind).toBe('host');
    expect(d.kind === 'host' && d.info.host.name).toBe('Demo host');
  });

  it('finds a host on the parent frame', async () => {
    const host = createFakeHost();
    const parent = { orbitHost: host };
    expect(findHost(win({ parent }))).toBe(host);
    expect((await detectHost(win({ parent }))).kind).toBe('host');
  });

  it('treats a cross-origin parent as no host', async () => {
    const parent = {
      get orbitHost() {
        throw new DOMException('Blocked a frame', 'SecurityError');
      },
    };
    expect(findHost(win({ parent }))).toBeNull();
    expect((await detectHost(win({ parent }))).kind).toBe('none');
  });

  it('runs standalone when there is no host', async () => {
    expect((await detectHost(win({})))).toEqual({ kind: 'none' });
  });

  it('refuses another protocol with a reason', async () => {
    const d = await detectHost(win({ orbitHost: createFakeHost({ protocol: 2 }) }));
    expect(d).toEqual({ kind: 'refused', reason: 'This build of ORBIT speaks host protocol 1; the host offered 2.' });
    // a host whose handshake (not its property) says another protocol
    const sly = { ...createFakeHost(), protocol: undefined, handshake: async () => ({ ...(await createFakeHost().handshake()), protocol: 3 }) } as unknown as OrbitHost;
    expect(await detectHost(win({ orbitHost: sly }))).toMatchObject({ reason: expect.stringContaining('the host offered 3') });
  });

  it('refuses (never throws) when the handshake rejects or never answers', async () => {
    const bad = { ...createFakeHost(), handshake: () => Promise.reject(new Error('host is starting')) } as OrbitHost;
    expect(await detectHost(win({ orbitHost: bad }))).toMatchObject({ kind: 'refused', reason: expect.stringContaining('host is starting') });
    const slow = { ...createFakeHost(), handshake: () => new Promise<Handshake>(() => {}) } as OrbitHost;
    expect(await detectHost(win({ orbitHost: slow }), { timeoutMs: 20 })).toMatchObject({ kind: 'refused' });
    const throws = { ...createFakeHost(), handshake: () => { throw new Error('boom'); } } as unknown as OrbitHost;
    expect(await detectHost(win({ orbitHost: throws }))).toMatchObject({ kind: 'refused', reason: expect.stringContaining('boom') });
  });

  it('installs the demo host for ?orbit-host=demo', async () => {
    const w = win({ location: { search: '?orbit-host=demo' } });
    const d = await detectHost(w);
    expect(d.kind).toBe('host');
    expect((w as unknown as { orbitHost: unknown }).orbitHost).toBeTruthy();
  });

  it('a refused host leaves ORBIT running on its own, in memory, with the reason', async () => {
    const store = createOrbitStore();
    await store.getState().init(new MemoryAdapter(), null, { hostRefusal: 'This build of ORBIT speaks host protocol 1; the host offered 2.' });
    expect(store.getState().host).toBeNull();
    expect(store.getState().hostRefusal).toMatch(/offered 2/);
    expect(store.getState().createProject({ name: 'Still works' }).name).toBe('Still works');
    expect(store.getState().projects).toHaveLength(1);
  });
});

/* ---------------- hosted store ---------------- */

describe('hosted store: records come from the verse', () => {
  it('merges host records and keeps the extras', async () => {
    const { s } = await hosted();
    expect(s().ready).toBe(true);
    expect(s().groups.every((g) => g.host)).toBe(true);
    expect(s().tasks.length).toBeGreaterThan(50);
    expect(s().host!.rev).toBe('1');
    expect(s().host!.attachments['t-raised-bed'].items.length).toBe(7);
    expect(s().host!.beacons.length).toBeGreaterThan(5);
  });

  it('never opens anything but the host store, and loads only placements and prefs from it', async () => {
    const host = createFakeHost({ now: NOW });
    await host.store.replaceAll({
      ...emptySnapshot(),
      projects: [{ id: 'stray', name: 'Should not appear', color: 'violet', icon: 'orbit', description: '', groupId: null, x: 0, y: 0, archived: false, createdAt: 1, updatedAt: 1 }],
      placements: [{ id: placementKey.galaxy('g-garden'), x: 50000, y: 50000, updatedAt: 1 }],
    });
    const local = new MemoryAdapter();
    const load = vi.spyOn(local, 'load');
    const store = createOrbitStore({ now: () => NOW });
    await store.getState().init(local, null, { host: { host, info: await host.handshake() } });
    expect(load).not.toHaveBeenCalled();
    expect(store.getState().projects.some((p) => p.id === 'stray')).toBe(false);
    expect(store.getState().groups.find((g) => g.id === 'g-garden')).toMatchObject({ x: 50000, y: 50000 });
  });

  it('shows an error (and stays up) when the first verse fails', async () => {
    const host = createFakeHost();
    host.verse = () => Promise.reject(new Error('offline'));
    const store = createOrbitStore();
    await store.getState().init(new MemoryAdapter(), null, { host: { host, info: await host.handshake() } });
    expect(store.getState().ready).toBe(true);
    expect(store.getState().host!.error).toMatch(/offline/);
  });

  it('snapshot() never includes host records', async () => {
    const { s } = await hosted();
    const snap = s().snapshot();
    expect(snap.groups).toEqual([]);
    expect(snap.projects).toEqual([]);
    expect(snap.tasks).toEqual([]);
  });
});

describe('hosted store: read-only guards (every action that would change a host record)', () => {
  const kept = /This is kept by Demo host; open it there to change it/;

  async function guarded(run: (s: ReturnType<Awaited<ReturnType<typeof hosted>>['s']>) => unknown, message: RegExp = kept) {
    const h = await hosted();
    const before = JSON.stringify({ g: h.s().groups, p: h.s().projects, t: h.s().tasks, c: h.s().captures, cp: h.s().checkpoints, d: h.s().dayItems, f: h.s().focus });
    await run(h.s());
    await settle();
    const after = JSON.stringify({ g: h.s().groups, p: h.s().projects, t: h.s().tasks, c: h.s().captures, cp: h.s().checkpoints, d: h.s().dayItems, f: h.s().focus });
    expect(after).toBe(before);
    expect(h.s().toasts.map((t) => t.text).join('\n')).toMatch(message);
    expect(h.writes).toEqual([]);
    return h;
  }

  const personal = /Nothing new can be added here: Demo host keeps only its own records/;
  const work = /Focus, parking and day plans are not available for tasks kept by Demo host/;
  const data = /Backups, examples and erasing are not available while Demo host keeps the records/;

  it('createTask in a host system', () => guarded((s) => s.createTask({ projectId: 's-beds', title: 'New' })));
  it('createTask anywhere else (no personal records)', () => guarded((s) => s.createTask({ projectId: 'nowhere', title: 'New' }), personal));
  it('updateTask', () => guarded((s) => s.updateTask('t-compost', { title: 'Changed' })));
  const removed = /This is kept by Demo host; ORBIT does not delete it/;
  it('deleteTask', () => guarded((s) => s.deleteTask('t-compost'), removed));
  it('completeTask', () => guarded((s) => s.completeTask('t-compost')));
  it('reopenTask', () => guarded((s) => s.reopenTask('t-seeds')));
  it('parkTask', () => guarded((s) => s.parkTask('t-compost', { nextAction: 'x' }), work));
  it('openPark', () => guarded((s) => s.openPark({ taskId: 't-compost' }), work));
  it('openResume / resumeTask', () => guarded((s) => (s.openResume('t-compost'), s.resumeTask('t-compost', 'fresh')), work));
  it('startFocus on a host task', () => guarded((s) => s.startFocus({ taskId: 't-compost' }), work));
  it('planTask', () => guarded((s) => s.planTask('t-compost', '2026-11-10', 'morning'), work));
  it('addCapture and opening capture', () => guarded((s) => (s.addCapture({ text: 'x' }), s.setCaptureOpen(true)), personal));
  it('sortCapture into a host system', async () => {
    const h = await hosted();
    h.store.setState({ captures: [{ id: 'c1', text: 'x', kind: 'task', source: 'quick', status: 'inbox', contextTaskId: null, sortedTaskId: null, createdAt: 1, updatedAt: 1 }] });
    expect(h.s().sortCapture('c1', { projectId: 's-beds' })).toBeNull();
    expect(h.s().tasks.some((t) => t.title === 'x')).toBe(false);
    expect(h.s().captures[0].status).toBe('inbox');
    expect(h.writes).toEqual([]);
  });
  it('updateProject (anything but its place)', () => guarded((s) => s.updateProject('s-beds', { name: 'Renamed', color: 'rose' })));
  it('updateProject into another galaxy (drag a star across)', () => guarded((s) => s.updateProject('s-beds', { groupId: 'g-move', x: 1, y: 1 }), /move it to another galaxy there/));
  it('deleteProject', () => guarded((s) => s.deleteProject('s-beds'), removed));
  it('updateGroup (anything but its place)', () => guarded((s) => s.updateGroup('g-garden', { name: 'Renamed' })));
  it('deleteGroup', () => guarded((s) => s.deleteGroup('g-garden'), removed));
  it('createGroup', () => guarded((s) => s.createGroup('Mine'), personal));
  it('createProject', () => guarded((s) => s.createProject({ name: 'Mine' }), personal));
  it('createProject in a host galaxy', () => guarded((s) => s.createProject({ name: 'Mine', groupId: 'g-garden' }), personal));
  const example = /The example workspace is not offered here/;
  it('loadExample', () => guarded((s) => s.loadExample(), example));
  it('removeExample', () => guarded((s) => s.removeExample(), example));
  it('resetAll', () => guarded((s) => s.resetAll(), data));
  it('restore rejects', async () => {
    const h = await hosted();
    await expect(h.s().restore(emptySnapshot())).rejects.toThrow(data);
    expect(h.s().groups.length).toBeGreaterThan(0);
    expect(h.writes).toEqual([]);
  });
  it('views that need personal records or working state stay closed', async () => {
    const h = await hosted();
    h.s().setView('today');
    h.s().setView('inbox');
    expect(h.s().view).toBe('universe');
    h.s().setView('insights');
    expect(h.s().view).toBe('insights');
  });
  it('an open focus (no task) runs in memory only', async () => {
    const h = await hosted();
    h.s().startFocus({ taskId: null });
    expect(h.s().focus).not.toBeNull();
    h.s().stopFocus();
    await settle();
    expect(h.writes).toEqual([]);
  });
});

describe('hosted store: what may change (positions and preferences)', () => {
  it('dragging a host system within its galaxy writes a placement, not the system', async () => {
    const h = await hosted();
    h.s().updateProject('s-beds', { x: 321, y: -123 });
    await settle();
    expect(h.s().projects.find((p) => p.id === 's-beds')).toMatchObject({ x: 321, y: -123 });
    expect(new Set(h.writes)).toEqual(new Set(['placements']));
    const saved = await h.host.store.load();
    expect(saved.placements).toEqual([expect.objectContaining({ id: 'main|s-beds', x: 321, y: -123 })]);
    expect(saved.projects).toEqual([]);
    expect(h.s().placements.map((p) => p.id)).toEqual(['main|s-beds']);
  });

  it('dragging a host galaxy writes a placement keyed g|<id>', async () => {
    const h = await hosted();
    h.s().updateGroup('g-garden', { x: 9000, y: 9100 });
    await settle();
    const saved = await h.host.store.load();
    expect(saved.placements).toEqual([expect.objectContaining({ id: 'g|g-garden', x: 9000, y: 9100 })]);
    expect(saved.groups).toEqual([]);
  });

  it('moving deep space writes a placement keyed g|deep-space', async () => {
    const h = await hosted();
    h.s().setDeepSpace({ x: -7000, y: 10 });
    await settle();
    expect((await h.host.store.load()).placements).toEqual([expect.objectContaining({ id: 'g|deep-space', x: -7000, y: 10 })]);
  });

  it('tidying galaxies into a spiral writes placements only, and undo puts them back', async () => {
    const h = await hosted();
    h.s().updateGroup('g-garden', { x: 77777, y: 0 });
    await settle();
    h.s().arrangeGalaxiesSpiral();
    await settle();
    const saved = await h.host.store.load();
    expect(saved.groups).toEqual([]);
    expect(saved.placements.find((p) => p.id === 'g|g-garden')).not.toMatchObject({ x: 77777 });
    h.s().toasts.at(-1)!.action!.run();
    await settle();
    expect(h.s().groups.find((g) => g.id === 'g-garden')).toMatchObject({ x: 77777, y: 0 });
    expect(h.writes.length).toBeGreaterThan(0);
    expect(h.writes.every((w) => w === 'placements' || w === 'prefs')).toBe(true);
  });

  it('a placement survives a refresh with changes', async () => {
    const h = await hosted();
    h.s().updateGroup('g-move', { x: 4242, y: 2424 });
    await settle();
    h.host.change((v) => v.planets.push({ id: 't-new', system: 's-pond', type: 'task', title: 'Net the leaves', status: 'todo', priority: 2 }));
    await h.s().refreshHost();
    expect(h.s().groups.find((g) => g.id === 'g-move')).toMatchObject({ x: 4242, y: 2424 });
    expect(h.s().tasks.some((t) => t.id === 't-new')).toBe(true);
  });

  it('host records never reach the adapter, whatever path a write takes', async () => {
    const h = await hosted();
    const s = h.s();
    // try everything, allowed or not
    s.updateTask('t-compost', { title: 'x' });
    s.completeTask('t-compost');
    s.updateProject('s-beds', { x: 5, y: 5 });
    s.updateGroup('g-garden', { x: 6, y: 6 });
    s.setPrefs({ theme: 'light', layers: { moons: false, belts: true, beacons: true } });
    s.arrangeGalaxiesSpiral();
    s.startFocus({ taskId: null });
    s.stopFocus();
    await settle();
    const saved = await h.host.store.load();
    expect(saved.groups).toEqual([]);
    expect(saved.projects).toEqual([]);
    expect(saved.tasks).toEqual([]);
    expect(saved.sessions).toEqual([]);
    expect(saved.focus).toBeNull();
    expect(saved.prefs.theme).toBe('light');
    expect(saved.prefs.layers.moons).toBe(false);
    expect(saved.placements.length).toBeGreaterThan(0);
  });
});

describe('hosted store: refresh', () => {
  it('does nothing when the host answers unchanged', async () => {
    const h = await hosted();
    const tasks = h.s().tasks;
    await h.s().refreshHost();
    expect(h.host.calls.unchanged).toBe(1);
    expect(h.s().tasks).toBe(tasks);
  });

  it('replaces host records when the verse changed, keeping the selection if it still exists', async () => {
    const h = await hosted();
    h.s().select({ type: 'task', id: 't-compost' });
    h.host.change((v) => {
      v.planets.find((p) => p.id === 't-compost')!.title = 'Turn the compost twice';
    });
    await h.s().refreshHost();
    expect(h.s().host!.rev).toBe('2');
    expect(h.s().tasks.find((t) => t.id === 't-compost')!.title).toBe('Turn the compost twice');
    expect(h.s().selection).toEqual({ type: 'task', id: 't-compost' });
  });

  it('clears the selection when the record is gone', async () => {
    const h = await hosted();
    h.s().select({ type: 'task', id: 't-compost' });
    h.host.change((v) => {
      v.planets = v.planets.filter((p) => p.id !== 't-compost');
    });
    await h.s().refreshHost();
    expect(h.s().selection).toBeNull();
  });

  it('keeps the sky and reports an error when a refresh fails', async () => {
    const h = await hosted();
    const n = h.s().tasks.length;
    h.host.verse = () => Promise.reject(new Error('timed out'));
    await h.s().refreshHost();
    expect(h.s().tasks.length).toBe(n);
    expect(h.s().host!.error).toMatch(/timed out/);
  });
});

describe('refresh schedule', () => {
  function fakes(visible = true) {
    const doc = Object.assign(new EventTarget(), { visibilityState: visible ? 'visible' : 'hidden' }) as unknown as Document & { visibilityState: string };
    const w = Object.assign(new EventTarget(), {
      setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
      clearInterval: (id: number) => clearInterval(id),
    }) as unknown as Window;
    return { doc, w };
  }

  it('refreshes every 30 s while visible, and not while hidden', async () => {
    vi.useFakeTimers();
    const { doc, w } = fakes();
    const refresh = vi.fn();
    const stop = startHostRefresh(refresh, { win: w, doc });
    await vi.advanceTimersByTimeAsync(29_999);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    (doc as { visibilityState: string }).visibilityState = 'hidden';
    await vi.advanceTimersByTimeAsync(90_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    stop();
  });

  it('refreshes on focus and when the page becomes visible; stops cleanly', async () => {
    vi.useFakeTimers();
    const { doc, w } = fakes(false);
    const refresh = vi.fn();
    const stop = startHostRefresh(refresh, { win: w, doc });
    w.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    doc.dispatchEvent(new Event('visibilitychange')); // still hidden
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    (doc as { visibilityState: string }).visibilityState = 'visible';
    doc.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
    w.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('never runs two refreshes at once', async () => {
    vi.useFakeTimers();
    const { doc, w } = fakes();
    let release!: () => void;
    const refresh = vi.fn(() => new Promise<void>((r) => (release = r)));
    const stop = startHostRefresh(refresh, { win: w, doc });
    w.dispatchEvent(new Event('focus'));
    w.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    w.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    stop();
  });
});
