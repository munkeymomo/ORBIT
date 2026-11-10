import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/components/universe/model';
import { buildSpace, CLUTTER } from '../../src/components/universe/space';
import { layoutSky, starSummary } from '../../src/components/universe/skyLabels';
import { changedInSystem, changedMoons, changedText } from '../../src/host/changed';
import { adaptVerse } from '../../src/host/adapt';
import { abilities } from '../../src/host/caps';
import { createFakeHost } from '../../src/host/fakeHost';
import type { Attachment, Planet, Verse } from '../../src/host/types';
import type { UniverseFilter } from '../../src/store/store';

const TODAY = '2026-11-10';
const FILTER: UniverseFilter = { query: '', dueSoon: false, highPriority: false, parkedOnly: false, showDone: false, groupId: null, hasLinked: false, hasChanged: false, uses: null, showFinished: false };
const can = abilities({ protocol: 1, host: { name: 'Host' }, caps: {}, verses: [{ id: 'v', name: 'V', plain: 'p', legend: 'l', editable: false }] });

const moon = (id: string, changed = false): Attachment => ({ id, kind: 'k', family: 'f', label: id, state: 'live', ...(changed ? { flag: 'changed' as const } : {}) });
const item = (id: string, system: string, attachments: Attachment[] = [], extra: Partial<Planet> = {}): Planet => ({ id, system, type: 'item', title: id, attachments, ...extra });
const task = (id: string, system: string, attachments: Attachment[] = [], extra: Partial<Planet> = {}): Planet => ({ id, system, type: 'task', title: id, status: 'todo', priority: 2, attachments, ...extra });

function verse(planets: Planet[]): Verse {
  return {
    verse: 'v',
    rev: '1',
    galaxies: [
      { id: 'g1', name: 'One', color: 'lime' },
      { id: 'g2', name: 'Two', color: 'sky' },
    ],
    systems: [
      { id: 's1', galaxy: 'g1', name: 'S1' },
      { id: 's2', galaxy: 'g1', name: 'S2' },
      { id: 's3', galaxy: 'g2', name: 'S3' },
    ],
    planets,
  } as Verse;
}

function world(planets: Planet[], filter: Partial<UniverseFilter> = {}) {
  const a = adaptVerse(verse(planets), []);
  const model = buildModel({ projects: a.projects, tasks: a.tasks, filter: { ...FILTER, ...filter }, activeTaskId: null, today: TODAY, attachments: a.extras.attachments, items: a.extras.items, can });
  const galaxies = buildSpace(model, a.groups, a.deepSpace ?? { x: 0, y: 0 }, Object.values(filter).some(Boolean), null, { beacons: [], attachments: a.extras.attachments, collections: {} });
  const sys = (id: string) => galaxies.flatMap((g) => g.systems).find((s) => s.pv.project.id === id)!;
  return { a, model, galaxies, sys, gal: (id: string) => galaxies.find((g) => g.id === id)! };
}

describe('changed moons, derived (no protocol field)', () => {
  it('counts only the moons sent with flag changed; `more` never counts', () => {
    expect(changedMoons(undefined)).toEqual([]);
    expect(changedMoons({ items: [moon('a'), moon('b', true), moon('c', true)], more: 7 }).map((m) => m.id)).toEqual(['b', 'c']);
    const { sys } = world([task('t1', 's1', [moon('a')], { more: 5 }), item('i1', 's1', [moon('b')], { more: 9 })]);
    expect(sys('s1').pv.changed.moons).toBe(0);
    expect(sys('s1').pv.changed.planets).toEqual([]);
  });

  it('marks a planet (task or item) with at least one changed moon, and counts the moons per planet, system and galaxy', () => {
    const w = world([
      task('t1', 's1', [moon('a', true), moon('b', true), moon('c')]),
      task('t2', 's1', [moon('d')]),
      item('i1', 's1', [moon('e', true)]),
      item('i2', 's2', [moon('f', true), moon('g')]),
      item('i3', 's3', []),
    ]);
    const s1 = w.sys('s1').pv;
    expect(s1.changed.planets.map((p) => [p.id, p.type, p.moons.length])).toEqual([['t1', 'task', 2], ['i1', 'item', 1]]);
    expect(s1.changed.moons).toBe(3);
    expect(s1.tasks.map((t) => [t.task.id, t.changed])).toEqual([['t1', 2], ['t2', 0]]);
    expect(s1.items.map((i) => [i.item.id, i.changed])).toEqual([['i1', 1]]);
    expect(w.sys('s2').pv.changed.moons).toBe(1);
    expect(w.sys('s3').pv.changed.moons).toBe(0);
    // the galaxy adds up its systems: 3 + 1 changed moons on 3 marked planets
    expect(w.gal('g1')).toMatchObject({ changed: 4, changedPlanets: 3 });
    expect(w.gal('g2')).toMatchObject({ changed: 0, changedPlanets: 0 });
  });

  it('leaves out a done task and a ghost item, and does not touch task counts', () => {
    const w = world([
      task('t1', 's1', [moon('a', true)], { status: 'done' }),
      task('t2', 's1', [moon('b', true)]),
      item('i1', 's1', [moon('c', true)], { ghost: true }),
    ]);
    expect(w.sys('s1').pv.changed.planets.map((p) => p.id)).toEqual(['t2']);
    // "changed" is not a task state: open/overdue are what they were
    expect(w.sys('s1').pv.stats).toMatchObject({ open: 1, done: 1, overdue: 0 });
    expect(changedInSystem('s1', [], {}, [])).toEqual({ planets: [], moons: 0 });
  });

  it('works for a system drawn as a ring of dots (more than 40 items)', () => {
    const many = Array.from({ length: CLUTTER.tasks + 5 }, (_, i) => item(`x${i}`, 's1', i === 3 || i === 30 ? [moon(`m${i}`, true), moon(`n${i}`, true)] : [moon(`o${i}`)]));
    const w = world(many);
    expect(w.sys('s1').busy).toBe(true);
    expect(w.sys('s1').busyItems).toBe(true);
    expect(w.sys('s1').pv.changed.moons).toBe(4);
    expect(w.sys('s1').pv.changed.planets.map((p) => p.id)).toEqual(['x3', 'x30']);
    expect(w.gal('g1').changed).toBe(4);
    // and more than 40 open tasks
    const busyTasks = Array.from({ length: CLUTTER.tasks + 3 }, (_, i) => task(`u${i}`, 's2', i === 0 ? [moon('z', true)] : []));
    const t = world(busyTasks);
    expect(t.sys('s2').busy).toBe(true);
    expect(t.sys('s2').pv.changed.moons).toBe(1);
  });

  it('the Notes demo verse: the changed moons the host sent, per galaxy', async () => {
    const host = createFakeHost({ now: Date.UTC(2026, 10, 10, 9) });
    await host.handshake();
    const notes = (await host.verse('notes')) as Verse;
    const sent = notes.planets.filter((p) => p.attachments?.some((m) => m.flag === 'changed'));
    expect(sent.length).toBeGreaterThanOrEqual(4);
    const a = adaptVerse(notes, []);
    const model = buildModel({ projects: a.projects, tasks: [], filter: FILTER, activeTaskId: null, today: TODAY, items: a.extras.items, readOnly: true, can });
    const galaxies = buildSpace(model, a.groups, a.deepSpace ?? { x: 0, y: 0 }, false, null, { beacons: a.extras.beacons, attachments: {}, collections: {} });
    const total = notes.planets.reduce((n, p) => n + (p.attachments ?? []).filter((m) => m.flag === 'changed').length, 0);
    expect(galaxies.reduce((n, g) => n + g.changed, 0)).toBe(total);
    expect(galaxies.reduce((n, g) => n + g.changedPlanets, 0)).toBe(sent.length);
    expect(galaxies.find((g) => g.id === 'g-market')!.changed).toBe(0);
  });

  it('the filter keeps marked planets matching and dims the rest; a system with none stops matching', () => {
    const w = world([task('t1', 's1', [moon('a', true)]), task('t2', 's1', []), item('i1', 's2', [moon('b')]), item('i2', 's2', [moon('c', true)])], { hasChanged: true });
    expect(w.sys('s1').pv.tasks.map((t) => [t.task.id, t.matches])).toEqual([['t1', true], ['t2', false]]);
    expect(w.sys('s2').pv.items.map((i) => [i.item.id, i.matches])).toEqual([['i1', false], ['i2', true]]);
    expect(w.sys('s3').pv.matches).toBe(false);
    expect(w.sys('s1').pv.matches).toBe(true);
    expect(w.gal('g2').matches).toBe(false);
    // off: everything matches
    expect(world([task('t2', 's1', [])]).sys('s1').pv.tasks[0].matches).toBe(true);
  });

  it('words: the system summary says "n changed"; the label layout gives a marked planet a pill line', () => {
    const w = world([task('t1', 's1', [moon('a', true), moon('b', true)]), task('t2', 's1', [])]);
    expect(changedText(2)).toBe('2 changed');
    expect(starSummary(w.sys('s1').pv)).toMatch(/ · 2 changed$/);
    expect(starSummary(w.sys('s2').pv)).not.toMatch(/changed/);
    const sys = w.sys('s1');
    const k = 1;
    const sky = layoutSky({
      galaxies: w.galaxies,
      view: { x: -sys.x, y: -sys.y + 300, k },
      size: { w: 1200, h: 800, top: 76 },
      universeLevel: false,
      selectedTask: null,
      today: TODAY,
      beacons: true,
      measure: (t) => t.length * 6,
    });
    expect(sky.planets.get('t1')!.pill).toBe('2 changed');
    expect(sky.planets.get('t2')!.pill).toBeUndefined();
    // the pill is a line of its own in the label's box
    expect(sky.planets.get('t1')!.rect.h).toBeGreaterThan(sky.planets.get('t2')!.rect.h);
  });
});
