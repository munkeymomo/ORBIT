/**
 * The words of the sky at the current view, worked out once per frame for the systems on screen: where each
 * planet's name goes (or that it is hidden until hovered), which systems' and galaxies' dates are too close
 * together to label one by one, and the boxes nothing may cover (a system's own name, its star, its dates).
 */
import { clamp } from '../../lib/util';
import { circleRect, collapseWhenCrowded, overlaps, placeOrbitLabels, wrapMiddle, type Measure, type OrbitLabel, type Rect } from './labels';
import { galaxyBeaconSpot, LOD, systemBeaconSpot, type GalaxyPlace, type Size, type SystemPlace, type View } from './space';
import type { Beacon } from '../../host/types';
import { changedText } from '../../host/changed';
import { daysBetween } from '../../lib/util';

/** Planet names: 11.5px; a star's name: 13px or 15px, semibold; date labels: 11px, semibold. */
export const STAR_NAME_W = 220;
export const PLANET_LABEL_W = 150;
/** From this zoom an item's name is followed by its `sub`. */
export const ITEM_SUB_ZOOM = 1.05;

export function beaconText(b: Beacon, today: string, full: boolean): string {
  const when =
    b.state === 'achieved' || b.state === 'rescoped' ? b.state : !b.due ? b.state : (() => {
      const d = daysBetween(today, b.due!);
      return d < 0 ? `${-d} d late` : d === 0 ? 'today' : `in ${d} d`;
    })();
  const name = full ? [b.code, b.title].filter(Boolean).join(' ') : (b.code ?? b.title);
  return `${name} · ${when}${full && b.serves ? ` · serves ${b.serves}` : ''}`;
}

/** The star's size on screen, as StarNode draws it. */
export const starRadius = (s: SystemPlace, k: number) => clamp(s.pv.radius * k, 9, 66);

/**
 * Whether the line under a star's name (its counts) is drawn. A big star or a close view shows it; a system that holds
 * items always does ("n items", "1 item"), so one holding a single item, the smallest star of its galaxy, is not the one
 * that loses its line while its neighbours keep theirs.
 */
export function starShowsMeta(pv: SystemPlace['pv'], k: number): boolean {
  return clamp(pv.radius * k, 9, 66) >= 15 || k >= 0.5 || (pv.itemCount ?? 0) > 0;
}

/** A system's name as it is drawn: up to three lines, the middle cut ("Head… tail") when it still does not fit. */
export function starNameLines(name: string, rs: number, measure: Measure): string[] {
  const scale = (rs >= 30 ? 15 : 13) / 11.5;
  return wrapMiddle(name, STAR_NAME_W, (t) => measure(t) * scale * 1.06, 3);
}

/** The box under a star that holds its name (up to three lines) and its one-line summary. */
export function starNameRect(s: SystemPlace, sx: number, sy: number, k: number, measure: Measure): Rect {
  const rs = starRadius(s, k);
  const scale = (rs >= 30 ? 15 : 13) / 11.5;
  const lines = starNameLines(s.pv.project.name, rs, measure);
  const meta = `${s.pv.project.host?.code ? `${s.pv.project.host.code} · ` : ''}${starSummary(s.pv)}`;
  const w = Math.min(STAR_NAME_W, Math.max(measure(meta), ...lines.map((l) => measure(l) * scale * 1.06)) + 20);
  const h = lines.length * (rs >= 30 ? 19 : 17) + 21;
  return { x: sx - w / 2, y: sy + rs + 6 + 8, w, h };
}

/**
 * Whether the selected planet's brackets would sit on the line of counts under its star's name (a planet directly
 * below the star, on the first orbit). The brackets win: the counts line is not drawn then (the name stays; the counts are in
 * the star's accessible name and its panel).
 */
export function selectedCoversMeta(s: SystemPlace, sx: number, sy: number, k: number, selectedId: string | null, measure: Measure): boolean {
  if (!selectedId || s.busy) return false;
  const ti = s.pv.tasks.findIndex((tv) => tv.task.id === selectedId);
  const ii = (s.pv.items ?? []).findIndex((iv) => iv.item.id === selectedId);
  const sl = ti >= 0 ? s.slots[ti] : ii >= 0 ? s.slots[s.pv.tasks.length + ii] : undefined;
  if (!sl) return false;
  // the brackets: a square round the planet, out to d/2 + 15 (see SelectedMark)
  const d = clamp(sl.d * k, 14, 64);
  const half = d / 2 + 15;
  const px = sx + sl.x * k;
  const py = sy + sl.y * k;
  const box = starNameRect(s, sx, sy, k, measure);
  const meta: Rect = { x: box.x, y: box.y + box.h - 19, w: box.w, h: 19 };
  const br: Rect = { x: px - half, y: py - half, w: 2 * half, h: 2 * half };
  return overlaps(br, meta, 2);
}

/** The one-line summary under a star, as StarNode words it: TASK counts, and "n items" for a system that holds items. */
export function starSummary(pv: SystemPlace['pv']): string {
  const st = pv.stats;
  const items = pv.itemCount ?? 0;
  const ch = pv.changed?.moons ? ` · ${changedText(pv.changed.moons)}` : '';
  if (st.total === 0) return (items ? `${items} item${items === 1 ? '' : 's'}` : 'No tasks yet') + ch;
  return `${st.open} open${st.parked ? ` · ${st.parked} parked` : ''}${items ? ` · ${items} items` : ''} · ${Math.round(st.progress * 100)}%${st.overdue ? ` · ${st.overdue} overdue` : ''}${pv.changed?.moons ? ` · ${changedText(pv.changed.moons)}` : ''}`;
}

export interface SkyLabels {
  /** By task id: where its name goes, and whether it shows without hovering. */
  planets: Map<string, OrbitLabel>;
  /** Galaxies and systems (by id) whose dates are too close to label one by one: they show "n dates". */
  crowded: Set<string>;
}

export function layoutSky(p: {
  galaxies: GalaxyPlace[];
  view: View;
  size: Size;
  universeLevel: boolean;
  /** The selected planet (a task or an item): its name is always placed. */
  selectedTask: string | null;
  today: string;
  beacons: boolean;
  measure: Measure;
  /** Date labels are drawn at 11px semibold: a little wider than planet names. */
  measureBold?: Measure;
  /** Corners the canvas's own controls take (minimap, zoom): no name goes under them. */
  ui?: Rect[];
}): SkyLabels {
  const { view, size, measure } = p;
  const bold = p.measureBold ?? ((t: string) => measure(t) * 1.02);
  const k = view.k;
  const top = size.top ?? 76;
  const bounds: Rect = { x: 4, y: top, w: size.w - 8, h: size.h - top - 4 };
  const planets = new Map<string, OrbitLabel>();
  const crowded = new Set<string>();
  const toS = (x: number, y: number) => [x * k + view.x, y * k + view.y] as const;
  const near = (x: number, y: number, r: number) => x + r > -40 && y + r > -40 && x - r < size.w + 40 && y - r < size.h + 40;

  for (const g of p.galaxies) {
    // dates on a galaxy's rim
    if (p.beacons && g.beacons.length > 1) {
      const full = !p.universeLevel;
      const sr = g.r * k;
      if (full || sr >= 150) {
        const boxes = g.beacons.map((b, i) => {
          const s = galaxyBeaconSpot(g, i);
          const [bx, by] = toS(s.x, s.y);
          return { x: bx - 6, y: by - 8, w: bold(beaconText(b, p.today, full)) + 18, h: 16 };
        });
        if (collapseWhenCrowded(boxes)) crowded.add(g.id);
      }
    }
    if (p.universeLevel || k < LOD.systems) continue;
    for (const s of g.systems) {
      const [sx, sy] = toS(s.x, s.y);
      if (!near(sx, sy, s.extent * k)) continue;
      const dateBoxes =
        p.beacons && s.beacons.length
          ? s.beacons.map((b, i) => {
              const at = systemBeaconSpot(s, i);
              const [bx, by] = toS(at.x, at.y);
              return { x: bx - 6, y: by - 8, w: bold(beaconText(b, p.today, k >= LOD.planets)) + 18, h: 16 };
            })
          : [];
      if (dateBoxes.length > 1 && collapseWhenCrowded(dateBoxes)) crowded.add(s.pv.project.id);
      if (k < LOD.planets || s.busy) continue;
      const rs = starRadius(s, k);
      const blocked: Rect[] = [circleRect(sx, sy, rs + 8), starNameRect(s, sx, sy, k, measure), ...(p.ui ?? [])];
      if (crowded.has(s.pv.project.id)) blocked.push({ ...dateBoxes[0], w: bold(`${s.beacons.length} dates`) + 18 });
      else blocked.push(...dateBoxes);
      if (s.belt) blocked.push({ x: sx - 230, y: sy + s.belt.r * k + 4, w: 460, h: 34 });
      const items = s.pv.tasks.flatMap((tv, i) => {
        const sl = s.slots[i];
        if (!sl) return [];
        const d = clamp(sl.d * k, 14, 64);
        const t = tv.task;
        const late = t.status !== 'done' && !!t.due && daysBetween(p.today, t.due) < 0;
        return [
          {
            id: t.id,
            x: sx + sl.x * k,
            y: sy + sl.y * k,
            // the selected planet wears brackets out to d/2 + 15: its name keeps clear of them
            r: d / 2 + (t.id === p.selectedTask ? 15 : 5),
            text: t.title,
            rank: (t.status === 'done' ? 0 : 10) + (tv.active ? 8 : 0) + (late ? 5 : 0) + t.priority,
            force: t.id === p.selectedTask,
            pill: tv.changed > 0 ? changedText(tv.changed) : undefined,
          },
        ];
      });
      const nt = s.pv.tasks.length;
      (s.pv.items ?? []).forEach((iv, j) => {
        const sl = s.slots[nt + j];
        if (!sl) return;
        const d = clamp(sl.d * k, 14, 64);
        const it = iv.item;
        items.push({
          id: it.id,
          x: sx + sl.x * k,
          y: sy + sl.y * k,
          r: d / 2 + (it.id === p.selectedTask ? 15 : 5),
          // its `sub` too, close up
          text: it.sub && k >= ITEM_SUB_ZOOM ? `${it.title} · ${it.sub}` : it.title,
          // the live and big first; ghosts and the gone last
          rank: (it.state === 'live' ? 10 : 2) + (it.ghost ? -6 : 0) + Math.round(sl.d / 15),
          force: it.id === p.selectedTask,
          pill: iv.changed > 0 ? changedText(iv.changed) : undefined,
        });
      });
      const laid = placeOrbitLabels(items, { cx: sx, cy: sy, measure, maxW: PLANET_LABEL_W, blocked, bounds });
      // close up every name that fits is shown; a little further out only the selected one (the rest on hover)
      for (const l of laid) planets.set(l.id, k >= LOD.planetLabels || l.id === p.selectedTask ? l : { ...l, shown: false });
    }
  }
  return { planets, crowded };
}
