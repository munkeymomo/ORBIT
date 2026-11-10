import { describe, expect, it } from 'vitest';
import { buildModel } from '../../src/components/universe/model';
import { buildSpace, contextAt, fitGalaxy, fitSystem, fitUniverse, MAX_K, PADS, systemBeaconSpot, UNIVERSE_LABEL_ROOM, type SpaceExtras, type Size } from '../../src/components/universe/space';
import {
  collapseWhenCrowded,
  ellipsize,
  moonListPlacement,
  outsideSystem,
  overlaps,
  placeOrbitLabels,
  sidesFor,
  wrapLabel,
  type Rect,
} from '../../src/components/universe/labels';
import { beaconText, layoutSky, starNameRect } from '../../src/components/universe/skyLabels';
import { clusterOutlinePoints, convexHull, universeLabelBox } from '../../src/components/universe/SpacePainter';
import { adaptVerse } from '../../src/host/adapt';
import { abilities } from '../../src/host/caps';
import { demoVerse } from '../../src/host/fakeHost';
import type { UniverseFilter } from '../../src/store/store';

/* Where words go in the sky (labels.ts, skyLabels.ts) and how a view is fitted (space.ts). */

const NOW = Date.UTC(2026, 10, 10, 9, 0, 0);
const TODAY = '2026-11-10';
const measure = (t: string) => t.length * 6;
const FILTER: UniverseFilter = { query: '', dueSoon: false, highPriority: false, parkedOnly: false, showDone: false, groupId: null, hasLinked: false, uses: null, showFinished: false };

function sky() {
  const a = adaptVerse(demoVerse(NOW), []);
  const can = abilities({ protocol: 1, host: { name: 'Host' }, caps: {}, verses: [{ id: 'main', name: 'M', plain: 'p', legend: 'l', editable: false }] });
  const model = buildModel({ projects: a.projects, tasks: a.tasks, filter: FILTER, activeTaskId: null, today: TODAY, attachments: a.extras.attachments, can });
  const extras: SpaceExtras = { beacons: a.extras.beacons, attachments: a.extras.attachments, collections: a.extras.collections };
  const galaxies = buildSpace(model, a.groups, a.deepSpace ?? { x: 0, y: 0 }, false, null, extras);
  const sys = (id: string) => galaxies.flatMap((g) => g.systems).find((s) => s.pv.project.id === id)!;
  return { galaxies, sys };
}

describe('words that fit', () => {
  it('ellipsize cuts at a word and says so', () => {
    expect(ellipsize('Short', 100, measure)).toBe('Short');
    expect(ellipsize('Noted in passing and waiting for a plan', 110, measure)).toBe('Noted in passing…');
    expect(ellipsize('Noted in passing and waiting for a plan', 100, measure)).toBe('Noted in…');
    expect(ellipsize('Supercalifragilistic', 60, measure)).toBe('Supercali…');
  });
  it('wrapLabel uses two lines at most, the second ending in an ellipsis when it must', () => {
    expect(wrapLabel('Turn the compost', 150, measure)).toEqual(['Turn the compost']);
    const l = wrapLabel('Strip the old wallpaper from the chimney breast in the back bedroom', 150, measure);
    expect(l).toHaveLength(2);
    expect(l[0]).toBe('Strip the old wallpaper');
    expect(l[1].endsWith('…')).toBe(true);
    for (const line of l) expect(measure(line)).toBeLessThanOrEqual(150);
  });
});

describe('planet names round a star', () => {
  const ring = (n: number, r: number, cx = 500, cy = 400) =>
    Array.from({ length: n }, (_, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      return { id: `p${i}`, x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r, r: 14, text: `Task number ${i} with a fairly long title to wrap`, rank: i % 4 };
    });

  it('the outward side comes first', () => {
    expect(sidesFor(0)[0]).toBe('right');
    expect(sidesFor(Math.PI)[0]).toBe('left');
    expect(sidesFor(-Math.PI / 2)[0]).toBe('above');
    expect(sidesFor(Math.PI / 2)[0]).toBe('below');
  });

  it('no two shown names overlap; none covers the system’s name, the star or another planet', () => {
    const items = ring(12, 110);
    const name: Rect = { x: 400, y: 450, w: 200, h: 36 };
    const star: Rect = { x: 450, y: 350, w: 100, h: 100 };
    const laid = placeOrbitLabels(items, { cx: 500, cy: 400, measure, blocked: [name, star] });
    const shown = laid.filter((l) => l.shown);
    expect(shown.length).toBeGreaterThan(3);
    expect(shown.length).toBeLessThan(12); // too many for the room: some wait for a hover
    for (const a of shown) {
      expect(overlaps(a.rect, name)).toBe(false);
      expect(overlaps(a.rect, star)).toBe(false);
      for (const b of shown) if (a !== b) expect(overlaps(a.rect, b.rect)).toBe(false);
      for (const p of items) if (p.id !== a.id) expect(overlaps(a.rect, { x: p.x - p.r, y: p.y - p.r, w: 2 * p.r, h: 2 * p.r })).toBe(false);
    }
  });

  it('the selected planet’s name is always shown, and placed first', () => {
    const items = ring(12, 60).map((it, i) => ({ ...it, force: i === 5 }));
    const laid = placeOrbitLabels(items, { cx: 500, cy: 400, measure });
    expect(laid[5].shown).toBe(true);
  });

  it('more important names win the room (late, then priority)', () => {
    const a = { id: 'a', x: 600, y: 400, r: 10, text: 'Low priority one', rank: 1 };
    const b = { id: 'b', x: 600, y: 412, r: 10, text: 'Critical and late', rank: 20 };
    const laid = placeOrbitLabels([a, b], { cx: 500, cy: 400, measure, maxW: 120 });
    expect(laid[1].shown).toBe(true);
  });

  it('names stay inside the bounds they are given (below the toolbar)', () => {
    const laid = placeOrbitLabels(ring(8, 110), { cx: 500, cy: 140, measure, bounds: { x: 0, y: 70, w: 1000, h: 700 } });
    for (const l of laid.filter((x) => x.shown)) expect(l.rect.y).toBeGreaterThanOrEqual(70);
  });

  it('the busy demo system: shown names never cover its name, each other, or its dates', () => {
    const { galaxies, sys } = sky();
    const s = sys('s-refit');
    const size: Size = { w: 1524, h: 825, top: 70 };
    const view = fitSystem(s, size, measure);
    const out = layoutSky({ galaxies, view, size, universeLevel: false, selectedTask: 't-refit-2', today: TODAY, beacons: true, measure });
    const sx = s.x * view.k + view.x;
    const sy = s.y * view.k + view.y;
    const name = starNameRect(s, sx, sy, view.k, measure);
    const ids = s.pv.tasks.map((t) => t.task.id);
    const shown = ids.map((id) => out.planets.get(id)!).filter((l) => l.shown);
    expect(out.planets.get('t-refit-2')!.shown).toBe(true);
    expect(shown.length).toBeGreaterThanOrEqual(8);
    const dates = s.beacons.map((b, i) => {
      const p = systemBeaconSpot(s, i);
      return { x: p.x * view.k + view.x - 6, y: p.y * view.k + view.y - 8, w: measure(beaconText(b, TODAY, true)) * 1.02 + 18, h: 16 };
    });
    for (const a of shown) {
      expect(overlaps(a.rect, name)).toBe(false);
      for (const d of dates) expect(overlaps(a.rect, d)).toBe(false);
      for (const b of shown) if (a !== b) expect(overlaps(a.rect, b.rect)).toBe(false);
    }
  });
});

describe('dates and moon lists', () => {
  it('dates too close together collapse into one count', () => {
    expect(collapseWhenCrowded([{ x: 0, y: 0, w: 100, h: 16 }, { x: 0, y: 30, w: 100, h: 16 }])).toBe(false);
    expect(collapseWhenCrowded([{ x: 0, y: 0, w: 100, h: 16 }, { x: 0, y: 1, w: 100, h: 16 }])).toBe(true);
  });

  it('a galaxy whose rim dates crowd at a small size is marked crowded; at a large size it is not', () => {
    const { galaxies } = sky();
    const garden = galaxies.find((g) => g.id === 'g-garden')!;
    const at = (k: number) => {
      const view = { k, x: 700 - garden.x * k, y: 450 - garden.y * k };
      return layoutSky({ galaxies, view, size: { w: 1400, h: 900, top: 70 }, universeLevel: false, selectedTask: null, today: TODAY, beacons: true, measure }).crowded.has('g-garden');
    };
    expect(at(0.34)).toBe(false);
    expect(at(0.05)).toBe(true);
  });

  it('the moon list goes away from the panel when there is room, never wider than the cap', () => {
    expect(moonListPlacement({ x: 600, off: 40, canvasW: 1000, panelRight: true })).toEqual({ left: true, maxW: 240 });
    expect(moonListPlacement({ x: 120, off: 40, canvasW: 1000, panelRight: true }).left).toBe(false);
    expect(moonListPlacement({ x: 600, off: 40, canvasW: 1000, panelRight: false }).left).toBe(false);
  });

  it('outside the system when it fits there (left first), else in a top corner, else nowhere', () => {
    const base = { sy: 400, py: 380, outer: 200, canvasH: 820, top: 70, w: 230, h: 120 };
    expect(outsideSystem({ ...base, sx: 700, canvasW: 1400 })).toMatchObject({ left: true, box: { x: 700 - 200 - 10 - 230 } });
    expect(outsideSystem({ ...base, sx: 300, canvasW: 1000 })).toMatchObject({ left: false, box: { x: 510 } });
    // neither side: the top-left corner, clear of the system's circle
    const c = outsideSystem({ ...base, sx: 381, sy: 411, py: 380, canvasW: 784, outer: 210 })!;
    expect(c.box).toMatchObject({ x: 12, y: 74 });
    // a big system in a small canvas: nowhere
    expect(outsideSystem({ ...base, sx: 400, sy: 400, outer: 390, canvasW: 800 })).toBeNull();
    // never under the minimap or zoom control
    expect(outsideSystem({ ...base, sx: 381, sy: 411, canvasW: 784, outer: 210, avoid: [{ x: 0, y: 60, w: 300, h: 200 }] })?.box.x).not.toBe(12);
  });
});

describe('fitting views', () => {
  it('the universe leaves room under the galaxies for their names, at any width', () => {
    const { galaxies } = sky();
    for (const w of [1204, 1524, 1844]) {
      const size: Size = { w, h: 825, top: 70 };
      const v = fitUniverse(galaxies, size);
      const bottom = Math.max(...galaxies.map((g) => (g.y + g.r) * v.k + v.y));
      expect(bottom + UNIVERSE_LABEL_ROOM).toBeLessThanOrEqual(size.h - PADS.bottom + 1);
      const topmost = Math.min(...galaxies.map((g) => (g.y - g.r) * v.k + v.y));
      expect(topmost).toBeGreaterThanOrEqual(70);
    }
  });

  it('a system fits below the toolbar, with room beside it for names and its dates inside the canvas', () => {
    const { sys } = sky();
    for (const w of [784, 1104, 1524, 1844]) {
      const size: Size = { w, h: 825, top: 70 };
      const s = sys('s-refit');
      const v = fitSystem(s, size, measure);
      expect(v.k).toBeLessThanOrEqual(1.6);
      const top = (s.y + 12 - s.extent - 24) * v.k + v.y;
      expect(top).toBeGreaterThanOrEqual(70 - 1);
      s.beacons.forEach((b, i) => {
        const p = systemBeaconSpot(s, i);
        const right = p.x * v.k + v.x + 10 + measure(beaconText(b, TODAY, true));
        expect(right).toBeLessThanOrEqual(w - PADS.side + 1);
      });
    }
    expect(MAX_K).toBeGreaterThan(1.6);
  });
});

describe('clusters', () => {
  it('one outline holds every member galaxy and its name', () => {
    const a = universeLabelBox(100, 100, 40, 120);
    const b = universeLabelBox(400, 160, 60, 120);
    const pts = [...clusterOutlinePoints(100, 100, 50, a), ...clusterOutlinePoints(400, 160, 70, b)];
    const hull = convexHull(pts);
    const xs = hull.map((p) => p[0]);
    const ys = hull.map((p) => p[1]);
    expect(Math.min(...xs)).toBeLessThanOrEqual(50);
    expect(Math.max(...xs)).toBeGreaterThanOrEqual(470);
    expect(Math.max(...ys)).toBeGreaterThanOrEqual(b.y + b.h);
    expect(Math.min(...ys)).toBeLessThanOrEqual(50);
  });
  it('convexHull drops points inside', () => {
    expect(convexHull([[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]]).length).toBe(4);
  });
});

describe('the level of the view', () => {
  const one = (r: number) => [{ id: 'g', x: 0, y: 0, r, systems: [] }] as unknown as Parameters<typeof contextAt>[0];
  it('one galaxy at the whole-universe fit is universe level, whatever the toolbar and banner measure', () => {
    for (const top of [76, 120, 190, 260]) {
      for (const r of [150, 300, 700]) {
        const size = { w: 1600, h: 900, top };
        const gs = one(r);
        expect(contextAt(gs, fitUniverse(gs, size), size).galaxy).toBeNull();
        expect(contextAt(gs, fitGalaxy(gs[0], size), size).galaxy?.id).toBe('g');
      }
    }
  });
});
