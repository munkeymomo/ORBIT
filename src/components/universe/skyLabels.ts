/**
 * The words of the sky at the current view, worked out once per frame for the systems on screen: where each
 * planet's name goes (or that it is hidden until hovered), which systems' and galaxies' dates are too close
 * together to label one by one, and the boxes nothing may cover (a system's own name, its star, its dates).
 */
import { clamp } from '../../lib/util';
import { circleRect, collapseWhenCrowded, placeOrbitLabels, wrapLabel, type Measure, type OrbitLabel, type Rect } from './labels';
import { galaxyBeaconSpot, LOD, systemBeaconSpot, type GalaxyPlace, type Size, type SystemPlace, type View } from './space';
import type { Beacon } from '../../host/types';
import { daysBetween } from '../../lib/util';

/** Planet names: 11.5px; a star's name: 13px or 15px, semibold; date labels: 11px, semibold. */
export const STAR_NAME_W = 220;
export const PLANET_LABEL_W = 150;

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

/** The box under a star that holds its name (up to two lines) and its one-line summary. */
export function starNameRect(s: SystemPlace, sx: number, sy: number, k: number, measure: Measure): Rect {
  const rs = starRadius(s, k);
  const scale = (rs >= 30 ? 15 : 13) / 11.5;
  const lines = wrapLabel(s.pv.project.name, STAR_NAME_W, (t) => measure(t) * scale * 1.06, 2);
  const st = s.pv.stats;
  const meta = `${s.pv.project.host?.code ? `${s.pv.project.host.code} · ` : ''}${st.open} open · ${Math.round(st.progress * 100)}%${st.parked ? ` · ${st.parked} parked` : ''}${st.overdue ? ` · ${st.overdue} overdue` : ''}`;
  const w = Math.min(STAR_NAME_W, Math.max(measure(meta), ...lines.map((l) => measure(l) * scale * 1.06)) + 20);
  const h = lines.length * (rs >= 30 ? 19 : 17) + 21;
  return { x: sx - w / 2, y: sy + rs + 6 + 8, w, h };
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
            r: d / 2 + 5,
            text: t.title,
            rank: (t.status === 'done' ? 0 : 10) + (tv.active ? 8 : 0) + (late ? 5 : 0) + t.priority,
            force: t.id === p.selectedTask,
          },
        ];
      });
      const laid = placeOrbitLabels(items, { cx: sx, cy: sy, measure, maxW: PLANET_LABEL_W, blocked, bounds });
      // close up every name that fits is shown; a little further out only the selected one (the rest on hover)
      for (const l of laid) planets.set(l.id, k >= LOD.planetLabels || l.id === p.selectedTask ? l : { ...l, shown: false });
    }
  }
  return { planets, crowded };
}
