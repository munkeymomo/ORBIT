import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/components/universe/model';
import { buildSpace, CLUTTER, galaxyBeaconSpot, systemBeaconSpot, type SpaceExtras } from '../../src/components/universe/space';
import { adaptVerse } from '../../src/host/adapt';
import { abilities } from '../../src/host/caps';
import { createFakeHost, demoVerse } from '../../src/host/fakeHost';
import type { Attachment, Verse } from '../../src/host/types';
import { createOrbitStore, type UniverseFilter } from '../../src/store/store';
import { emptySnapshot, MemoryAdapter } from '../../src/data/storage';
import { DEFAULT_PREFS } from '../../src/data/normalise';

const NOW = Date.UTC(2026, 10, 10, 9, 0, 0);
const TODAY = '2026-11-10';
const FILTER: UniverseFilter = { query: '', dueSoon: false, highPriority: false, parkedOnly: false, showDone: false, groupId: null, hasLinked: false, uses: null, showFinished: false };

function sky(v: Verse = demoVerse(NOW), filter: Partial<UniverseFilter> = {}) {
  const a = adaptVerse(v, []);
  const can = abilities({ protocol: 1, host: { name: 'Host' }, caps: {}, verses: [{ id: 'main', name: 'M', plain: 'p', legend: 'l', editable: false }] });
  const f = { ...FILTER, ...filter };
  const model = buildModel({ projects: a.projects, tasks: a.tasks, filter: f, activeTaskId: null, today: TODAY, attachments: a.extras.attachments, can });
  const extras: SpaceExtras = { beacons: a.extras.beacons, attachments: a.extras.attachments, collections: a.extras.collections };
  const galaxies = buildSpace(model, a.groups, a.deepSpace ?? { x: 0, y: 0 }, false, null, extras);
  const sys = (id: string) => galaxies.flatMap((g) => g.systems).find((s) => s.pv.project.id === id)!;
  return { a, model, galaxies, sys };
}

const att = (id: string, extra: Partial<Attachment> = {}): Attachment => ({ id, kind: 'k', family: 'tool', label: id, state: 'live', ...extra });

describe('buildSpace with what a host adds', () => {
  it('puts galaxy beacons on the rim and system beacons beside their system, inside its extent', () => {
    const { galaxies, sys } = sky();
    const garden = galaxies.find((g) => g.id === 'g-garden')!;
    expect(garden.beacons.map((b) => b.state)).toEqual(['planned', 'soon', 'late', 'achieved', 'rescoped']);
    const p = galaxyBeaconSpot(garden, 0);
    expect(Math.hypot(p.x - garden.x, p.y - garden.y)).toBeCloseTo(garden.r * 1.06, 0);
    const packing = sys('s-packing');
    expect(packing.beacons.map((b) => b.id)).toEqual(['m-van', 'm-keys']);
    for (let i = 0; i < packing.beacons.length; i++) {
      const q = systemBeaconSpot(packing, i);
      expect(Math.hypot(q.x - packing.x, q.y - packing.y)).toBeLessThan(packing.extent);
    }
  });

  it('gives belts room: the system extent covers its belt', () => {
    const { sys } = sky();
    const gh = sys('s-greenhouse');
    expect(gh.belt).toMatchObject({ haze: false });
    expect(gh.belt!.r).toBeGreaterThan(gh.rings.at(-1)!);
    expect(gh.extent).toBeGreaterThan(gh.belt!.r);
    expect(sys('s-pond').belt).toBeNull();
  });

  it('turns a belt of more than 60 into haze, and a belt of items into rocks', () => {
    const { sys } = sky();
    expect(sys('s-recipes').belt).toMatchObject({ haze: true });
    const v = demoVerse(NOW);
    v.collections = [{ system: 's-pond', total: CLUTTER.belt, items: Array.from({ length: CLUTTER.belt }, (_, i) => att(`x${i}`)) }];
    expect(sky(v).sys('s-pond').belt!.haze).toBe(false);
    v.collections = [{ system: 's-pond', total: CLUTTER.belt + 1, items: Array.from({ length: CLUTTER.belt + 1 }, (_, i) => att(`x${i}`)) }];
    expect(sky(v).sys('s-pond').belt!.haze).toBe(true);
  });

  it('draws a host system with more than 40 open tasks as a ring (no planet slots), and 40 as planets', () => {
    const { sys } = sky();
    const orders = sys('s-orders');
    expect(orders.pv.stats.open).toBeGreaterThan(CLUTTER.tasks);
    expect(orders.busy).toBe(true);
    expect(orders.slots).toEqual([]);
    expect(orders.rings).toHaveLength(1);
    const v = demoVerse(NOW);
    v.planets = v.planets.filter((p) => !(p.system === 's-orders' && p.status !== 'done' && Number(p.id.split('-')[2]) > CLUTTER.tasks));
    const forty = sky(v).sys('s-orders');
    expect(forty.pv.stats.open).toBe(CLUTTER.tasks);
    expect(forty.busy).toBe(false);
    expect(forty.slots.length).toBe(CLUTTER.tasks); // no "add a task" slot on a read-only host system
  });

  it('keeps standalone systems as they were: busy rule and add slot unchanged', () => {
    const projects = [{ id: 'p', name: 'Mine', color: 'violet', icon: 'orbit', description: '', groupId: null, x: 0, y: 0, archived: false, createdAt: 1, updatedAt: 1 }];
    const tasks = Array.from({ length: 45 }, (_, i) => ({ ...adaptVerse(demoVerse(NOW), []).tasks[0], id: `t${i}`, projectId: 'p', host: undefined }));
    const model = buildModel({ projects, tasks, filter: FILTER, activeTaskId: null, today: TODAY });
    const [deep] = buildSpace(model, [], { x: 0, y: 0 }, false, null);
    const s = deep.systems[0];
    expect(s.busy).toBe(false);
    expect(s.slots.length).toBe(46); // 45 planets + the add slot
    expect(s.belt).toBeNull();
    expect(s.beacons).toEqual([]);
    expect(deep.beacons).toEqual([]);
  });

  it('carries moons on task views, with "more"', () => {
    const { sys } = sky();
    const bed = sys('s-beds').pv.tasks.find((t) => t.task.id === 't-raised-bed')!;
    expect(bed.moons!.items.length).toBeGreaterThan(CLUTTER.moons);
    expect(bed.moons!.more).toBe(3);
  });

  it('marks host virtual galaxies like deep space', () => {
    const { galaxies } = sky();
    expect(galaxies.find((g) => g.id === 'g-loose')!.virtual).toBe(true);
    expect(galaxies.find((g) => g.id === 'g-garden')!.virtual).toBe(false);
  });
});

describe('filters for host records', () => {
  it('"Has linked items" keeps only tasks with moons', () => {
    const { model } = sky(demoVerse(NOW), { hasLinked: true });
    const shown = model.flatMap((pv) => pv.tasks.map((t) => t.task.id));
    expect(shown.sort()).toEqual(['t-boxes', 't-raised-bed', 't-soil', 't-trays', 't-van', 't-refit-2', 't-refit-6', 't-refit-10'].sort());
    expect(model.find((pv) => pv.project.id === 's-pond')!.matches).toBe(false);
  });

  it('"Uses …" highlights every task that uses the picked attachment', () => {
    const v = demoVerse(NOW);
    v.planets.find((p) => p.id === 't-trays')!.attachments!.push(att('a-saw', { family: 'tool', label: 'Mitre saw' }));
    const { model } = sky(v, { uses: 'a-saw' });
    const hits = model.flatMap((pv) => pv.tasks.filter((t) => t.matches).map((t) => t.task.id));
    expect(hits.sort()).toEqual(['t-raised-bed', 't-trays']);
    expect(model.find((pv) => pv.project.id === 's-beds')!.matches).toBe(true);
    expect(model.find((pv) => pv.project.id === 's-pond')!.matches).toBe(false);
    const uses = model.flatMap((pv) => pv.tasks.filter((t) => t.uses).map((t) => t.task.id));
    expect(uses.sort()).toEqual(['t-raised-bed', 't-trays']);
  });

  it('host systems offer no add slot when creation is not allowed', () => {
    const { model } = sky();
    expect(model.every((pv) => pv.canAdd === false)).toBe(true);
  });
});

describe('layer switches', () => {
  it('default to all on, and older or host preferences without them get the defaults', async () => {
    expect(DEFAULT_PREFS.layers).toEqual({ moons: true, belts: true, beacons: true });
    const old = { ...emptySnapshot(), prefs: { ...DEFAULT_PREFS, theme: 'light' as const } } as ReturnType<typeof emptySnapshot>;
    delete (old.prefs as Partial<typeof old.prefs>).layers;
    const store = createOrbitStore();
    await store.getState().init(new MemoryAdapter(old));
    expect(store.getState().prefs.layers).toEqual({ moons: true, belts: true, beacons: true });
    expect(store.getState().prefs.theme).toBe('light');
  });

  it('are kept in preferences (standalone and hosted)', async () => {
    const a = new MemoryAdapter();
    const s1 = createOrbitStore();
    await s1.getState().init(a);
    s1.getState().setPrefs({ layers: { moons: false, belts: true, beacons: false } });
    await new Promise((r) => setTimeout(r, 0));
    expect((await a.load()).prefs.layers).toEqual({ moons: false, belts: true, beacons: false });

    const host = createFakeHost({ now: NOW });
    const s2 = createOrbitStore();
    await s2.getState().init(new MemoryAdapter(), null, { host: { host, info: await host.handshake() } });
    s2.getState().setPrefs({ layers: { moons: true, belts: false, beacons: true } });
    await new Promise((r) => setTimeout(r, 0));
    expect((await host.store.load()).prefs.layers).toEqual({ moons: true, belts: false, beacons: true });
    // a fresh start on the same host store keeps them
    const s3 = createOrbitStore();
    await s3.getState().init(new MemoryAdapter(), null, { host: { host, info: await host.handshake() } });
    expect(s3.getState().prefs.layers.belts).toBe(false);
  });
});
