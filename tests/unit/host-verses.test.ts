import { describe, expect, it } from 'vitest';
import { createFakeHost } from '../../src/host/fakeHost';
import { createOrbitStore } from '../../src/store/store';
import { MemoryAdapter } from '../../src/data/storage';
import { errorMessage } from '../../src/lib/errors';
import { wormholeText } from '../../src/components/host/Wormholes';

/*
 * Stage 5: planets that are records (items), several verses, wormholes, portals and host actions.
 */

const NOW = Date.UTC(2026, 10, 10, 9, 0, 0);

/** An error made in another realm (a host living in the parent frame): not an `instanceof Error` here. */
function foreignError(message: string) {
  const e = Object.create(null) as { message: string; name: string };
  e.message = message;
  e.name = 'Error';
  return e;
}

async function editable() {
  const host = createFakeHost({ now: NOW, editable: true });
  const info = await host.handshake();
  const store = createOrbitStore({ now: () => NOW });
  await store.getState().init(new MemoryAdapter(), null, { host: { host, info } });
  const s = () => store.getState();
  await s().hostSettled();
  const settle = async () => {
    await s().hostSettled();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { host, store, s, settle, toasts: () => s().toasts.map((t) => t.text) };
}

describe('errors from another realm keep their words', () => {
  it('errorMessage reads .message whatever realm made the error', () => {
    const e = foreignError('The parent frame said no.');
    expect(e instanceof Error).toBe(false);
    expect(errorMessage(e)).toBe('The parent frame said no.');
    expect(errorMessage('plain words')).toBe('plain words');
    expect(errorMessage({}, 'fallback')).toBe('fallback');
    expect(errorMessage(new Error('  spaced  '))).toBe('spaced');
    expect(errorMessage(null, 'nothing')).toBe('nothing');
  });

  it('a refusal from a host in the parent frame is shown in its words', async () => {
    const h = await editable();
    const api = h.host.tasks!;
    api.update = () => Promise.reject(foreignError('Frozen by the other frame.'));
    h.s().updateTask('t-compost', { title: 'Nope' });
    await h.settle();
    expect(h.s().tasks.find((t) => t.id === 't-compost')!.title).toBe('Turn the compost');
    expect(h.toasts()).toContain('Frozen by the other frame.');
  });

  it('a host action rejected from another realm says why', async () => {
    const h = await editable();
    h.host.action = () => Promise.reject(foreignError('No dialog today.'));
    await h.s().hostAction('anything', {});
    expect(h.toasts().some((t) => t.includes('No dialog today.'))).toBe(true);
  });
});

/* ---------------- stage 5: items, verses, wormholes ---------------- */

import Ajv2020 from 'ajv/dist/2020';
import schemaText from '../../src/host/host-protocol-v1.schema.json?raw';
import { adaptVerse, itemDiameter, ITEM_DIAMETER } from '../../src/host/adapt';
import { offeredVerses, resolveLanding, startVerse, workVerseOf, verseSwitch } from '../../src/host/verses';
import { buildModel, itemSystemRadius, projectRadius } from '../../src/components/universe/model';
import { buildSpace, CLUTTER, LOD } from '../../src/components/universe/space';
import { arrowCurves, planetSpots } from '../../src/components/universe/arrows';
import { placeGalaxyLabels } from '../../src/components/universe/galaxyLabels';
import { overlaps } from '../../src/components/universe/labels';
import { abilities } from '../../src/host/caps';
import { isBlocked, rankNext } from '../../src/lib/scoring';
import { completedByDay, parkedTasks, projectStats } from '../../src/store/selectors';
import { findItem, shownGroups, shownProjects } from '../../src/store/shown';
import type { Handshake, OrbitHost, Planet, Verse } from '../../src/host/types';
import type { UniverseFilter } from '../../src/store/store';

const TODAY = '2026-11-10';
const FILTER: UniverseFilter = { query: '', dueSoon: false, highPriority: false, parkedOnly: false, showDone: false, groupId: null, hasLinked: false, uses: null, showFinished: false };

async function hosted(o: Parameters<typeof createFakeHost>[0] = {}) {
  const host = createFakeHost({ now: NOW, editable: true, ...o });
  const info = await host.handshake();
  const store = createOrbitStore({ now: () => NOW });
  await store.getState().init(new MemoryAdapter(), null, { host: { host, info } });
  const s = () => store.getState();
  await s().hostSettled();
  return { host, store, s, toasts: () => s().toasts.map((t) => t.text) };
}

const settle = () => new Promise((r) => setTimeout(r, 0));
const itemIds = (v: Verse) => v.planets.filter((p) => p.type === 'item').map((p) => p.id);

describe('the demo host: four verses on the same galaxies (validated against the JSON Schema)', () => {
  const schema = JSON.parse(schemaText);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(schema);
  const check = (def: string, doc: unknown) => {
    const v = ajv.getSchema(`${schema.$id}#/$defs/${def}`)!;
    return v(doc) ? [] : v.errors;
  };

  it('handshake (with verse actions) and every verse validate, editable or not, and after an action', async () => {
    for (const editable of [true, false]) {
      const host = createFakeHost({ now: NOW, editable });
      const info = await host.handshake();
      expect(check('handshake', info)).toEqual([]);
      expect(info.verses.map((v) => v.id)).toEqual(['main', 'map', 'things', 'notes']);
      expect(info.verses.find((v) => v.id === 'notes')!.actions).toEqual([{ id: 'new-notebook', label: 'New notebook…' }]);
      for (const v of info.verses) expect(check('verse', await host.verse(v.id))).toEqual([]);
      await host.action!('new-notebook', { verse: 'notes', galaxy: 'g-move' });
      expect(check('verse', await host.verse('notes'))).toEqual([]);
    }
  });

  it('the same galaxies in every verse, each with wormholes to the others', async () => {
    const host = createFakeHost({ now: NOW });
    const verses = await Promise.all(['main', 'map', 'things', 'notes'].map((id) => host.verse(id) as Promise<Verse>));
    const home = ['g-garden', 'g-move', 'g-workshop', 'g-bakery', 'g-market'];
    for (const v of verses) {
      for (const g of home) {
        const gal = v.galaxies.find((x) => x.id === g)!;
        expect(gal, `${v.verse} has ${g}`).toBeTruthy();
        expect(new Set(gal.also!.map((a) => a.verse))).toEqual(new Set(['main', 'map', 'things', 'notes'].filter((x) => x !== v.verse)));
      }
    }
  });

  it('wormholes both ways: a task and the thing it uses, a system and its plan on the map', async () => {
    const host = createFakeHost({ now: NOW });
    const main = (await host.verse('main')) as Verse;
    const things = (await host.verse('things')) as Verse;
    const map = (await host.verse('map')) as Verse;
    const bed = main.planets.find((p) => p.id === 't-raised-bed')!;
    expect(bed.also).toContainEqual(expect.objectContaining({ verse: 'things', object: 'i-saw', system: 'th-ws-tools', galaxy: 'g-workshop' }));
    expect(bed.attachments!.find((a) => a.id === 'a-saw')!.also).toEqual([expect.objectContaining({ verse: 'things', object: 'i-saw' })]);
    const saw = things.planets.find((p) => p.id === 'i-saw')!;
    expect(saw.also).toContainEqual(expect.objectContaining({ verse: 'main', object: 't-raised-bed' }));
    const sander = things.planets.find((p) => p.id === 'i-sander')!;
    expect(sander.also!.at(-1)!.note).toMatch(/^\d+ tasks use it$/);
    expect(main.systems.find((s) => s.id === 's-beds')!.also).toContainEqual(expect.objectContaining({ verse: 'map', object: 'mp-s-beds' }));
    expect(map.planets.find((p) => p.id === 'mp-s-beds')!.also).toEqual([expect.objectContaining({ verse: 'main', system: 's-beds' })]);
  });

  it('things: sizes, rings, moons, arrows, a ghost, and a system of more than forty items', async () => {
    const host = createFakeHost({ now: NOW });
    const things = (await host.verse('things')) as Verse;
    expect(things.planets.every((p) => p.type === 'item')).toBe(true);
    expect(things.planets.filter((p) => p.system === 'th-ws-fixings').length).toBeGreaterThan(CLUTTER.tasks);
    expect(things.planets.filter((p) => p.ghost).map((p) => p.id)).toEqual(['i-drill@garden']);
    expect(things.arrows!.length).toBeGreaterThan(3);
    const notes = (await host.verse('notes')) as Verse;
    expect(notes.planets.some((p) => p.attachments?.some((a) => a.flag === 'changed'))).toBe(true);
    expect(notes.beacons!.length).toBeGreaterThan(0);
  });
});

describe('adapting items', () => {
  const things = () => createFakeHost({ now: NOW }).verse('things') as Promise<Verse>;

  it('items are never tasks: they are kept by system, with size, ring, state, ghost and moons', async () => {
    const v = await things();
    const a = adaptVerse(v, []);
    expect(a.tasks).toEqual([]);
    expect(Object.values(a.extras.items).flat().map((i) => i.id).sort()).toEqual(itemIds(v).sort());
    const drill = a.extras.items['th-ws-tools'].find((i) => i.id === 'i-drill')!;
    expect(drill).toMatchObject({ family: 'tool', state: 'live', ring: 0.7, ghost: false, verse: 'things' });
    expect(drill.moons.items.map((m) => m.id)).toEqual(['d-drill-warranty', 'd-drill-bits']);
    expect(a.extras.items['th-ws-tools'].find((i) => i.id === 'i-level')!.state).toBe('gone');
    expect(a.extras.items['th-ws-tools'].find((i) => i.id === 'i-planer')!.state).toBe('archived');
    expect(a.extras.items['th-gd-tools'].find((i) => i.id === 'i-drill@garden')!.ghost).toBe(true);
  });

  it('size maps by square root onto the planet range, relative to the largest; missing → default; no ring → null', () => {
    expect(itemDiameter(40, 40)).toBe(ITEM_DIAMETER.max);
    expect(itemDiameter(0, 40)).toBe(ITEM_DIAMETER.min);
    expect(itemDiameter(10, 40)).toBe(Math.round(ITEM_DIAMETER.min + (ITEM_DIAMETER.max - ITEM_DIAMETER.min) * 0.5));
    expect(itemDiameter(undefined, 40)).toBe(ITEM_DIAMETER.default);
    const v: Verse = {
      verse: 'v', rev: '1', families: {}, galaxies: [{ id: 'g', name: 'G' }], systems: [{ id: 's', galaxy: 'g', name: 'S' }],
      planets: [
        { id: 'a', system: 's', type: 'item', title: 'A', kind: 'k', family: 'f', size: 4 },
        { id: 'b', system: 's', type: 'item', title: 'B', kind: 'k', family: 'f', ring: 1.7, state: 'weird' as never },
      ],
    };
    const [a, b] = adaptVerse(v, []).extras.items.s;
    expect(a).toMatchObject({ diameter: ITEM_DIAMETER.max, ring: null, state: 'live' });
    expect(b).toMatchObject({ diameter: ITEM_DIAMETER.default, ring: 1, state: 'live' });
  });

  it('arrows keep only those whose two ends the verse has', () => {
    const v: Verse = {
      verse: 'v', rev: '1', families: {}, galaxies: [{ id: 'g', name: 'G' }], systems: [{ id: 's', galaxy: 'g', name: 'S' }],
      planets: [
        { id: 'a', system: 's', type: 'item', title: 'A', kind: 'k', family: 'f' },
        { id: 'b', system: 's', type: 'item', title: 'B', kind: 'k', family: 'f' },
      ],
      arrows: [{ from: 'a', to: 'b', label: 'made from' }, { from: 'a', to: 'nowhere' }, { from: 'a', to: 'a' }],
    };
    expect(adaptVerse(v, []).extras.arrows).toEqual([{ from: 'a', to: 'b', label: 'made from' }]);
  });

  it('portal and actions reach the system and galaxy references', async () => {
    const map = (await createFakeHost({ now: NOW }).verse('map')) as Verse;
    const a = adaptVerse(map, []);
    expect(a.projects.find((p) => p.id === 'map-g-garden-things')!.host!.portal).toEqual({ verse: 'things', label: undefined });
    expect(a.projects.find((p) => p.id === 'map-g-garden-things')!.color).toBe('violet');
    expect(a.groups.find((g) => g.id === 'g-garden')!.host!.actions).toEqual([{ id: 'galaxy-summary', label: 'Print a summary…' }]);
  });
});

describe('items never reach anything that works on tasks', () => {
  it('not in tasks, Today, Next, Insights, search, parking, focus, or any task count', async () => {
    const h = await hosted();
    await h.s().showVerse('things');
    const items = [...Object.values(h.s().host!.items).flat(), ...Object.values(h.s().host!.sky!.items).flat()].map((i) => i.id);
    expect(items).toContain('i-oven'); // the work verse's own item
    expect(items).toContain('i-saw');
    const ids = new Set(h.s().tasks.map((t) => t.id));
    for (const id of items) expect(ids.has(id)).toBe(false);
    // Next and What-next
    const ranked = rankNext(h.s().tasks, { todayKey: TODAY, availableMin: 60, energy: 'medium', checkpoints: new Map(), planned: new Map(), activeTaskId: null });
    expect(ranked.suggestions.length).toBeGreaterThan(0);
    for (const s of ranked.suggestions) expect(items).not.toContain(s.task.id);
    // Insights and parking
    expect(completedByDay(h.s().tasks, [TODAY], h.s().projects).flatMap((d) => d.byProject.map((b) => b.projectId))).not.toContain('th-ws-tools');
    expect(parkedTasks(h.s().tasks).some((t) => items.includes(t.id))).toBe(false);
    // counts: a system of items has no tasks
    expect(projectStats('s-recipes', h.s().tasks, TODAY).total).toBe(0);
    // focus, parking and the day plan refuse an item quietly
    h.s().startFocus({ taskId: 'i-oven' });
    expect(h.s().focus).toBeNull();
    h.s().planTask('i-oven', TODAY, 'morning');
    expect(h.s().dayItems).toEqual([]);
    h.s().parkTask('i-oven', { stoppedAt: 'x' });
    expect(h.s().checkpoints).toEqual([]);
    // search reads tasks and projects only (the palette's source)
    expect(h.s().tasks.some((t) => t.title === 'Mitre saw')).toBe(false);
  });

  it('the model counts tasks as tasks and items as "n items"', async () => {
    const v = (await createFakeHost({ now: NOW }).verse('things')) as Verse;
    const a = adaptVerse(v, []);
    const model = buildModel({ projects: a.projects, tasks: [], filter: FILTER, activeTaskId: null, today: TODAY, items: a.extras.items, readOnly: true, can: abilities(null) });
    const fix = model.find((p) => p.project.id === 'th-ws-fixings')!;
    expect(fix.stats.total).toBe(0);
    expect(fix.itemCount).toBe(52); // the host's count
    expect(model.find((p) => p.project.id === 'th-ws-tools')!.itemCount).toBe(6);
    expect(model.every((p) => !p.canAdd)).toBe(true);
    const galaxies = buildSpace(model, a.groups, a.deepSpace ?? { x: 0, y: 0 }, false, null, { beacons: [], attachments: {}, collections: {} });
    const ws = galaxies.find((g) => g.id === 'g-workshop')!;
    expect(ws.total).toBe(0);
    expect(ws.items).toBe(52 + 6 + 4 + 2);
    const busy = ws.systems.find((s) => s.pv.project.id === 'th-ws-fixings')!;
    expect(busy).toMatchObject({ busy: true, busyItems: true, slots: [] });
    const tools = ws.systems.find((s) => s.pv.project.id === 'th-ws-tools')!;
    expect(tools.busy).toBe(false);
    expect(tools.slots.length).toBe(6); // one per item, no "add" slot
  });
});

describe('the size of a system that holds items', () => {
  it('goes with how many it holds: the task systems\' √ mapping and 40–80 limits, relative to the busiest in its galaxy', () => {
    expect(itemSystemRadius(0, 30)).toBe(40);
    expect(itemSystemRadius(2, 52)).toBeGreaterThanOrEqual(40);
    expect(itemSystemRadius(52, 52)).toBe(80);
    expect(itemSystemRadius(13, 52)).toBeCloseTo(40 + 40 * Math.sqrt(13 / 52), 6);
    expect(itemSystemRadius(2, 52)).toBeLessThan(itemSystemRadius(15, 52));
    expect(itemSystemRadius(15, 52)).toBeLessThan(itemSystemRadius(52, 52));
    // a galaxy of small systems does not inflate them
    expect(itemSystemRadius(3, 3)).toBeCloseTo(40 + 40 * Math.sqrt(3 / 12), 6);
    expect(itemSystemRadius(500, 3)).toBe(80);
  });
  it('the model sizes the demo\'s three batch systems (14, 2 and 6 items) apart, and tasks keep the old rule', async () => {
    const v = (await createFakeHost({ now: NOW }).verse('things')) as Verse;
    const a = adaptVerse(v, []);
    const model = buildModel({ projects: a.projects, tasks: [], filter: FILTER, activeTaskId: null, today: TODAY, items: a.extras.items, readOnly: true, can: abilities(null) });
    const r = (id: string) => model.find((p) => p.project.id === id)!.radius;
    expect(r('th-bk-run1')).toBeGreaterThan(r('th-bk-run3'));
    expect(r('th-bk-run3')).toBeGreaterThan(r('th-bk-run2'));
    expect(r('th-ws-fixings')).toBe(80);
    expect(projectRadius([])).toBe(40);
  });
});

describe('arrows', () => {
  const view = { x: 0, y: 0, k: 1 };
  async function laid() {
    const v = (await createFakeHost({ now: NOW }).verse('things')) as Verse;
    const a = adaptVerse(v, []);
    const model = buildModel({ projects: a.projects, tasks: [], filter: FILTER, activeTaskId: null, today: TODAY, items: a.extras.items, readOnly: true });
    const galaxies = buildSpace(model, a.groups, { x: 0, y: 0 }, false, null);
    return { a, galaxies };
  }
  it('drawn between planets drawn one by one; skipped when an end is missing or the view is too far out', async () => {
    const { a, galaxies } = await laid();
    const spots = planetSpots(galaxies, view, false);
    const curves = arrowCurves([...a.extras.arrows, { from: 'i-compost', to: 'i-gone-away' }], spots);
    expect(curves.map((c) => `${c.from}>${c.to}`)).toContain('i-compost>i-clippings');
    expect(curves.some((c) => c.to === 'i-gone-away')).toBe(false);
    expect(arrowCurves(a.extras.arrows, planetSpots(galaxies, { ...view, k: LOD.planets / 2 }, false))).toEqual([]);
    expect(arrowCurves(a.extras.arrows, planetSpots(galaxies, view, true))).toEqual([]);
    // only those in view, with a size
    expect(arrowCurves(a.extras.arrows, planetSpots(galaxies, { x: 1e6, y: 1e6, k: 1 }, false, { w: 800, h: 600 }))).toEqual([]);
  });
  it('never make a task blocked, and never touch dependencies', async () => {
    const h = await hosted();
    h.host.change((v) => (v.arrows = [{ from: 't-compost', to: 't-soil', label: 'feeds' }]));
    await h.s().refreshHost();
    expect(h.s().host!.arrows).toEqual([{ from: 't-compost', to: 't-soil', label: 'feeds' }]);
    const byId = new Map(h.s().tasks.map((t) => [t.id, t]));
    expect(isBlocked(byId.get('t-compost')!, byId)).toEqual([]);
    expect(isBlocked(byId.get('t-soil')!, byId)).toEqual([]);
    expect(byId.get('t-compost')!.dependsOn).toEqual([]);
    expect(byId.get('t-soil')!.dependsOn).toEqual([]);
  });
});

describe('several verses in the store', () => {
  it('opens the start verse; the work verse is the first offered editable one', async () => {
    const h = await hosted();
    expect(h.s().host).toMatchObject({ verseId: 'main', shown: 'main', sky: null });
    const info = await h.host.handshake();
    expect(workVerseOf(info)).toBe('main');
    expect(workVerseOf({ ...info, verses: info.verses.map((v) => ({ ...v, editable: v.id === 'notes' })) })).toBe('notes');
    expect(workVerseOf({ ...info, verses: info.verses.map((v) => ({ ...v, editable: false })) })).toBe(startVerse(info));
  });

  it('switching: the other verse is fetched once, then cached (instant) and refreshed with since', async () => {
    const h = await hosted();
    const calls = () => h.host.calls.verse;
    const before = calls();
    expect(await h.s().showVerse('things')).toBe(true);
    expect(calls()).toBe(before + 1);
    expect(h.s().host!.shown).toBe('things');
    expect(h.s().host!.sky!.verseId).toBe('things');
    await h.s().showVerse('main');
    expect(h.s().host!.sky).toBeNull();
    const unchanged = h.host.calls.unchanged;
    const p = h.s().showVerse('things');
    // on screen at once, from the cache
    expect(h.s().host!.shown).toBe('things');
    await p;
    await settle();
    expect(h.host.calls.unchanged).toBe(unchanged + 1);
    // a change on the host's side arrives with the next switch back
    await h.s().showVerse('main');
    h.host.changeVerse('things', (v) => v.planets.push({ id: 'i-new', system: 'th-ws-tools', type: 'item', title: 'New clamp', kind: 'tool', family: 'tool' }));
    await h.s().showVerse('things');
    await settle();
    expect(h.s().host!.sky!.items['th-ws-tools'].some((i) => i.id === 'i-new')).toBe(true);
  });

  it('the camera stays on the same galaxy, at once; at the whole universe it shows the whole verse', async () => {
    const h = await hosted();
    await h.s().showVerse('things', { galaxy: 'g-workshop' });
    expect(h.s().flight).toMatchObject({ kind: 'galaxy', id: 'g-workshop', instant: true });
    await h.s().showVerse('map');
    expect(h.s().flight).toMatchObject({ kind: 'universe', id: null, instant: true });
    // a galaxy keeps its place in every verse
    const main = new Map(h.s().groups.map((g) => [g.id, { x: g.x, y: g.y }]));
    for (const g of h.s().host!.sky!.groups) if (main.has(g.id)) expect({ x: g.x, y: g.y }).toEqual(main.get(g.id));
  });

  it('the selection stays only if the same object is in the new verse', async () => {
    const h = await hosted();
    h.s().select({ type: 'group', id: 'g-garden' });
    await h.s().showVerse('things');
    expect(h.s().selection).toEqual({ type: 'group', id: 'g-garden' });
    h.s().select({ type: 'item', id: 'i-saw' });
    await h.s().showVerse('map');
    expect(h.s().selection).toBeNull();
    h.s().select({ type: 'project', id: 'map-g-garden-plans' });
    await h.s().showVerse('notes');
    expect(h.s().selection).toBeNull();
  });

  it('the work verse’s tasks stay live while another verse is on screen; no personal galaxy outside it', async () => {
    const h = await hosted({ personal: true });
    const own = h.s().createGroup('Allotment notes');
    await h.s().showVerse('things');
    expect(h.s().groups.some((g) => g.id === own.id)).toBe(true); // still ORBIT's
    expect(shownGroups(h.s()).some((g) => g.id === own.id)).toBe(false); // not drawn here
    expect(shownProjects(h.s()).every((p) => !!p.host)).toBe(true);
    // the dock's tasks are the work verse's, and refreshed
    expect(h.s().tasks.some((t) => t.id === 't-compost')).toBe(true);
    h.s().startFocus({ taskId: 't-compost' });
    expect(h.s().focus?.taskId).toBe('t-compost');
    h.host.change((v) => (v.planets.find((p) => p.id === 't-compost')!.title = 'Turn the compost twice'));
    await h.s().refreshHost();
    expect(h.s().tasks.find((t) => t.id === 't-compost')!.title).toBe('Turn the compost twice');
    expect(h.s().host!.shown).toBe('things');
    expect(h.s().focus?.taskId).toBe('t-compost');
  });

  it('periodic refresh asks the work verse and the verse on screen, not every cached one', async () => {
    const h = await hosted();
    await h.s().showVerse('map');
    await h.s().showVerse('things');
    await settle();
    const asked: string[] = [];
    const orig = h.host.verse.bind(h.host);
    h.host.verse = (id, since) => (asked.push(id), orig(id, since));
    await h.s().refreshHost();
    expect(asked.sort()).toEqual(['main', 'things']);
  });

  it('selecting a task while another verse shows brings the work verse back and flies to it', async () => {
    const h = await hosted();
    await h.s().showVerse('things');
    const fades: number[] = [];
    const off = verseSwitch.on(() => fades.push(1));
    h.s().select({ type: 'task', id: 't-van' });
    off();
    expect(fades.length).toBe(1);
    expect(h.s().host!.sky).toBeNull();
    expect(h.s().selection).toEqual({ type: 'task', id: 't-van' });
    expect(h.s().flight).toMatchObject({ kind: 'system', id: 's-packing' });
  });

  it('a verse with shown: false is not offered, and cannot be switched to', async () => {
    const host = createFakeHost({ now: NOW, editable: true });
    const hs = host.handshake.bind(host);
    host.handshake = async () => {
      const i = await hs();
      i.verses.find((v) => v.id === 'notes')!.shown = false;
      return i;
    };
    const info = await host.handshake();
    expect(offeredVerses(info).map((v) => v.id)).toEqual(['main', 'map', 'things']);
    const store = createOrbitStore({ now: () => NOW });
    await store.getState().init(new MemoryAdapter(), null, { host: { host, info } });
    expect(await store.getState().showVerse('notes')).toBe(false);
    expect(store.getState().host!.shown).toBe('main');
  });

  it('when the verse on screen stops being offered, the work verse comes back', async () => {
    const h = await hosted();
    await h.s().showVerse('notes');
    const hs = h.host.handshake.bind(h.host);
    h.host.handshake = async () => {
      const i = await hs();
      i.verses = i.verses.filter((v) => v.id !== 'notes');
      return i;
    };
    await h.s().refreshHost();
    expect(h.s().host!.shown).toBe('main');
    expect(h.s().host!.sky).toBeNull();
  });

  it('placements: a system of another verse is dragged within its galaxy only; a galaxy keeps one place everywhere', async () => {
    const h = await hosted();
    await h.s().showVerse('things');
    h.s().updateProject('th-ws-tools', { x: 123, y: -45 });
    await settle();
    expect(h.s().placements.find((p) => p.id === 'things|th-ws-tools')).toMatchObject({ x: 123, y: -45 });
    expect(shownProjects(h.s()).find((p) => p.id === 'th-ws-tools')).toMatchObject({ x: 123, y: -45 });
    h.s().updateProject('th-ws-tools', { groupId: 'g-garden' });
    expect(shownProjects(h.s()).find((p) => p.id === 'th-ws-tools')!.groupId).toBe('g-workshop');
    h.s().updateGroup('g-garden', { x: 9000, y: 9000 });
    await settle();
    expect(shownGroups(h.s()).find((g) => g.id === 'g-garden')).toMatchObject({ x: 9000, y: 9000 });
    expect(h.s().groups.find((g) => g.id === 'g-garden')).toMatchObject({ x: 9000, y: 9000 });
    expect(h.s().placements.find((p) => p.id === 'g|g-garden')).toMatchObject({ x: 9000, y: 9000 });
    const saved = await h.host.store.load();
    expect(saved.groups).toEqual([]);
    expect(saved.projects).toEqual([]);
  });
});

describe('wormholes', () => {
  const content = {
    groups: [{ id: 'g' }],
    projects: [{ id: 's', groupId: 'g' }],
    tasks: [{ id: 't', projectId: 's' }],
    items: { s: [{ id: 'i', system: 's', moons: { items: [{ id: 'm', kind: 'k', family: 'f', label: 'M', state: 'live' as const }], more: 0 } }] },
  };
  it('resolves to the most precise target the verse has', () => {
    expect(resolveLanding(content, { object: 't' })).toEqual({ flight: { kind: 'system', id: 's' }, select: { type: 'task', id: 't' }, missing: false });
    expect(resolveLanding(content, { object: 'i', system: 'x' })).toEqual({ flight: { kind: 'system', id: 's' }, select: { type: 'item', id: 'i' }, missing: false });
    expect(resolveLanding(content, { object: 'm' })).toMatchObject({ flight: { kind: 'system', id: 's' }, select: { type: 'item', id: 'i' } });
    expect(resolveLanding(content, { system: 's' })).toEqual({ flight: { kind: 'system', id: 's' }, missing: false });
    expect(resolveLanding(content, { galaxy: 'g' })).toEqual({ flight: { kind: 'galaxy', id: 'g' }, missing: false });
  });
  it('falls back to the galaxy, else the whole verse, and says the target was missing', () => {
    expect(resolveLanding(content, { object: 'gone', system: 'nope', galaxy: 'g' })).toEqual({ flight: { kind: 'galaxy', id: 'g' }, missing: true });
    expect(resolveLanding(content, { object: 'gone' })).toEqual({ flight: { kind: 'universe', id: null }, missing: true });
    expect(resolveLanding(content, undefined)).toEqual({ flight: { kind: 'universe', id: null }, missing: false });
  });
  it('following one switches verse, selects the record and flies to its system; and back again', async () => {
    const h = await hosted();
    const bed = h.s().tasks.find((t) => t.id === 't-raised-bed')!;
    const saw = bed.host!.also!.find((a) => a.object === 'i-saw')!;
    expect(await h.s().followWormhole(saw)).toBe(true);
    expect(h.s().host!.shown).toBe('things');
    expect(h.s().selection).toEqual({ type: 'item', id: 'i-saw' });
    expect(h.s().flight).toMatchObject({ kind: 'system', id: 'th-ws-tools', instant: true });
    expect(findItem(h.s(), 'i-saw')!.title).toBe('Mitre saw');
    const back = findItem(h.s(), 'i-saw')!.also.find((a) => a.verse === 'main')!;
    await h.s().followWormhole(back);
    expect(h.s().host!.shown).toBe('main');
    expect(h.s().selection).toEqual({ type: 'task', id: 't-raised-bed' });
    expect(h.s().flight).toMatchObject({ kind: 'system', id: 's-beds' });
  });
  it('a wormhole into the verse already on screen only flies and selects: no switch, no crossfade, an animated flight', async () => {
    const h = await hosted();
    await h.s().showVerse('things');
    let switches = 0;
    const off = verseSwitch.on(() => switches++);
    const sky = h.s().host!.sky;
    const ghost = findItem(h.s(), 'i-drill@garden')!;
    expect(await h.s().followWormhole(ghost.also[0])).toBe(true);
    off();
    expect(switches).toBe(0);
    expect(h.s().host!.sky).toBe(sky);
    expect(h.s().host!.shown).toBe('things');
    expect(h.s().selection).toEqual({ type: 'item', id: 'i-drill' });
    expect(h.s().flight).toMatchObject({ kind: 'system', id: 'th-ws-tools', instant: false });
  });
  it('words a wormhole: "Go to where it lives" when its verse is the one on screen, else the verse name', () => {
    const verses = new Map([['things', { id: 'things', name: 'Things', plain: 'Tools & materials', legend: '', editable: false }]]);
    const a = { verse: 'things', object: 'i-drill', note: 'its home: Workshop tools' };
    expect(wormholeText(a, verses, 'things')).toMatchObject({ here: true, head: 'Go to where it lives', note: 'its home: Workshop tools' });
    expect(wormholeText(a, verses, 'main')).toMatchObject({ here: false, head: 'Things' });
    expect(wormholeText(a, verses)).toMatchObject({ here: false, head: 'Things' });
  });
  it('a target that is not there lands on its galaxy and says so', async () => {
    const h = await hosted();
    await h.s().followWormhole({ verse: 'things', galaxy: 'g-garden', object: 'i-not-here' });
    expect(h.s().flight).toMatchObject({ kind: 'galaxy', id: 'g-garden' });
    expect(h.toasts().some((t) => /not in Things now; showing its galaxy/.test(t))).toBe(true);
    await h.s().followWormhole({ verse: 'things', object: 'i-not-here' });
    expect(h.s().flight).toMatchObject({ kind: 'universe' });
  });
  it('a portal leads to its verse in the same galaxy', async () => {
    const h = await hosted();
    await h.s().showVerse('map');
    const portal = shownProjects(h.s()).find((p) => p.id === 'map-g-bakery-notes')!;
    expect(portal.host!.portal).toEqual({ verse: 'notes', label: 'Read the notes' });
    await h.s().showVerse(portal.host!.portal!.verse, { galaxy: portal.groupId! });
    expect(h.s().host!.shown).toBe('notes');
    expect(h.s().flight).toMatchObject({ kind: 'galaxy', id: 'g-bakery' });
  });
});

describe('host actions and host.at.verse', () => {
  it('called with the context; true refreshes the verse on screen', async () => {
    const h = await hosted();
    await h.s().showVerse('notes');
    const before = shownProjects(h.s()).length;
    expect(await h.s().hostAction('new-notebook', { verse: 'notes', galaxy: 'g-move' })).toBe(true);
    expect(h.host.log.at(-1)).toEqual({ op: 'action', args: ['new-notebook', { verse: 'notes', galaxy: 'g-move' }] });
    expect(shownProjects(h.s()).length).toBe(before + 1);
    expect(shownProjects(h.s()).at(-1)!.groupId).toBe('g-move');
    // false: nothing changed, no refresh
    const calls = h.host.calls.verse;
    expect(await h.s().hostAction('galaxy-summary', { verse: 'map', galaxy: 'g-garden' })).toBe(false);
    expect(h.host.calls.verse).toBe(calls);
  });
  it('a rejection is a toast with the host’s words', async () => {
    const h = await hosted();
    h.host.refuseNext('Notebooks are full.');
    expect(await h.s().hostAction('new-notebook', { verse: 'notes' })).toBe(false);
    expect(h.toasts().some((t) => t.includes('Notebooks are full.'))).toBe(true);
  });
  it('host.at.verse opens that verse first (with the work verse loaded behind it), and an item there can be the target', async () => {
    const h = await hosted({ at: { verse: 'things', planet: 'i-saw' } });
    expect(h.s().host).toMatchObject({ verseId: 'main', shown: 'things' });
    expect(h.s().selection).toEqual({ type: 'item', id: 'i-saw' });
    expect(h.s().flight).toMatchObject({ kind: 'system', id: 'th-ws-tools' });
    expect(h.s().tasks.length).toBeGreaterThan(10);
    const hidden = await hosted({ at: { verse: 'nowhere' } });
    expect(hidden.s().host!.shown).toBe('main');
  });
  it('one verse only: nothing to switch (the switcher needs two)', async () => {
    const h = await hosted({ verses: 'one' });
    expect(offeredVerses(h.s().host!.info).length).toBe(1);
  });
});

describe('galaxy names at the whole universe never cover each other', () => {
  it('moves crowded labels above, beside, or to their short form', () => {
    const items = [0, 1, 2, 3].map((i) => ({ id: `g${i}`, cx: 300 + i * 120, cy: 300 + (i % 2) * 60, sr: 50, w: 190, chip: true }));
    const spots = placeGalaxyLabels(items, { w: 1200, h: 900, top: 80 });
    const boxes = [...spots.values()];
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlaps(boxes[i], boxes[j])).toBe(false);
    expect(new Set(boxes.map((b) => b.side)).size).toBeGreaterThan(1);
  });
  it('a lone galaxy keeps its full label underneath', () => {
    const spots = placeGalaxyLabels([{ id: 'g', cx: 500, cy: 300, sr: 80, w: 190, chip: false }], { w: 1200, h: 900, top: 80 });
    expect(spots.get('g')).toMatchObject({ side: 'below', brief: false });
  });
});

describe('adopt, then the working state is not saved', () => {
  it('says plainly that the host has the tasks but their working state was not saved', async () => {
    const h = await hosted({ personal: true });
    const own = h.s().createProject({ name: 'Shed', groupId: null });
    h.s().createTask({ projectId: own.id, title: 'Oil the hinges' });
    await settle();
    const store = h.host.store;
    const bulk = store.bulkPut.bind(store);
    store.bulkPut = (t, rows) => (t === 'taskWork' ? Promise.reject(foreignError('disk full')) : bulk(t, rows));
    const put = store.put.bind(store);
    store.put = (t, row) => (t === 'taskWork' ? Promise.reject(foreignError('disk full')) : put(t, row));
    expect(await h.s().adoptProject(own.id)).toBe(1);
    await settle();
    expect(h.toasts().some((t) => /has the task now, but ORBIT could not save its working state/.test(t))).toBe(true);
  });
});

void (null as unknown as Handshake | OrbitHost | Planet);

describe('the sky does not jump on refresh', () => {
  it('after one galaxy is dragged, the others (and deep space) keep their places', async () => {
    const h = await hosted();
    const before = new Map(h.s().groups.map((g) => [g.id, { x: g.x, y: g.y }]));
    const deep = { ...h.s().prefs.deepSpace };
    h.s().updateGroup('g-workshop', { x: 50_000, y: 50_000 });
    await settle();
    h.host.change((v) => (v.planets.find((p) => p.id === 't-brackets')!.title = 'Buy brackets and screws'));
    await h.s().refreshHost();
    for (const g of h.s().groups) if (g.id !== 'g-workshop') expect({ id: g.id, x: g.x, y: g.y }).toEqual({ id: g.id, ...before.get(g.id)! });
    expect(h.s().groups.find((g) => g.id === 'g-workshop')).toMatchObject({ x: 50_000, y: 50_000 });
    expect(h.s().prefs.deepSpace).toEqual(deep);
  });
});
