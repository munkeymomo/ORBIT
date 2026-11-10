/**
 * A verse's arrows (relations between two of its planets, such as "made from") as curves on screen. Pure, so the
 * drawn list can be tested. An arrow is drawn only when both of its planets are drawn one by one, in systems of the
 * same galaxy; it is never a dependency, never "blocked", and never touches a task's scoring.
 */
import type { Arrow } from '../../host/types';
import { clamp } from '../../lib/util';
import { LOD, type GalaxyPlace, type View } from './space';
import { starNameRect, starRadius } from './skyLabels';
import type { Measure, Rect } from './labels';

export interface ArrowCurve {
  from: string;
  to: string;
  label?: string;
  /** Start and end on the planets' edges, and the control point (screen px). */
  ax: number;
  ay: number;
  bx: number;
  by: number;
  cx: number;
  cy: number;
  /** It bows around a star. */
  detour?: boolean;
}

export interface Spot {
  x: number;
  y: number;
  r: number;
  galaxy: string;
  /** The system it orbits. */
  system?: string;
}

/** A system's star and its name box on screen: what an arrow must not cross. `reach` is how far its planets orbit. */
export interface StarBox {
  x: number;
  y: number;
  /** The star's disc, with room for its glow. */
  r: number;
  /** Where its name is drawn. */
  name: Rect;
  reach: number;
  /** Which system this is. */
  system?: string;
}

/** Where every planet drawn one by one sits on screen (tasks and items), by id; with `size`, only those in view. */
export function planetSpots(galaxies: GalaxyPlace[], view: View, universeLevel: boolean, size?: { w: number; h: number }): Map<string, Spot> {
  const k = view.k;
  const out = new Map<string, Spot>();
  if (universeLevel || k < LOD.planets) return out;
  for (const g of galaxies)
    for (const s of g.systems) {
      if (s.busy) continue;
      const put = (id: string, i: number) => {
        const sl = s.slots[i];
        if (!sl) return;
        const x = (s.x + sl.x) * k + view.x;
        const y = (s.y + sl.y) * k + view.y;
        if (size && (x < -20 || y < -20 || x > size.w + 20 || y > size.h + 20)) return;
        out.set(id, { x: (s.x + sl.x) * k + view.x, y: (s.y + sl.y) * k + view.y, r: clamp(sl.d * k, 14, 64) / 2, galaxy: g.id, system: s.pv.project.id });
      };
      s.pv.tasks.forEach((tv, i) => put(tv.task.id, i));
      (s.pv.items ?? []).forEach((iv, j) => put(iv.item.id, s.pv.tasks.length + j));
    }
  return out;
}

/** Every drawn system's star and name box, by system id (for `arrowCurves`). */
export function starBoxes(galaxies: GalaxyPlace[], view: View, measure: Measure): Map<string, StarBox> {
  const out = new Map<string, StarBox>();
  const k = view.k;
  for (const g of galaxies)
    for (const s of g.systems) {
      if (s.busy) continue;
      const x = s.x * k + view.x;
      const y = s.y * k + view.y;
      const r = starRadius(s, k);
      // out to the planets' far edges
      const reach = Math.max(r + 30, ...s.slots.map((sl) => Math.hypot(sl.x, sl.y) * k + clamp(sl.d * k, 14, 64) / 2));
      out.set(s.pv.project.id, { x, y, r: r + 10, name: starNameRect(s, x, y, k, measure), reach, system: s.pv.project.id });
    }
  return out;
}

/** Whether a segment A→B passes through the star's disc. */
export function crossesDisc(A: { x: number; y: number }, B: { x: number; y: number }, star: StarBox): boolean {
  const dx = B.x - A.x;
  const dy = B.y - A.y;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((star.x - A.x) * dx + (star.y - A.y) * dy) / len2, 0, 1);
  return Math.hypot(A.x + dx * t - star.x, A.y + dy * t - star.y) < star.r;
}

const inBox = (x: number, y: number, r: Rect, slack: number) => x > r.x - slack && x < r.x + r.w + slack && y > r.y - slack && y < r.y + r.h + slack;

/** Whether the straight line A→B crosses the star's disc or its name box (a few px of slack). */
export function crossesStar(A: { x: number; y: number }, B: { x: number; y: number }, star: StarBox): boolean {
  if (crossesDisc(A, B, star)) return true;
  for (let i = 1; i < 24; i++) if (inBox(A.x + ((B.x - A.x) * i) / 24, A.y + ((B.y - A.y) * i) / 24, star.name, 4)) return true;
  return false;
}

/** Whether the quadratic curve A–C–B passes through the star's disc or name box. */
function curveHitsStar(A: { x: number; y: number }, B: { x: number; y: number }, cx: number, cy: number, star: StarBox): boolean {
  for (let i = 1; i < 20; i++) {
    const t = i / 20;
    const u = 1 - t;
    const x = u * u * A.x + 2 * u * t * cx + t * t * B.x;
    const y = u * u * A.y + 2 * u * t * cy + t * t * B.y;
    if (Math.hypot(x - star.x, y - star.y) < star.r || inBox(x, y, star.name, 6)) return true;
  }
  return false;
}

/**
 * The arrows to draw: both ends drawn, in one galaxy. A chord that would pass through a system's star or its name
 * bows out around it (past the planets' orbit, on the side away from the name); any other bends only a little to its
 * left, so A→B and B→A part.
 */
export function arrowCurves(arrows: Arrow[], spots: Map<string, Spot>, stars?: Map<string, StarBox>): ArrowCurve[] {
  const out: ArrowCurve[] = [];
  for (const a of arrows) {
    const A = spots.get(a.from);
    const B = spots.get(a.to);
    if (!A || !B || A.galaxy !== B.galaxy || a.from === a.to) continue;
    const dx = B.x - A.x;
    const dy = B.y - A.y;
    const d = Math.hypot(dx, dy);
    if (d < A.r + B.r + 6) continue;
    const nx = -dy / d;
    const ny = dx / d;
    const mx = (A.x + B.x) / 2;
    const my = (A.y + B.y) / 2;
    let bend = Math.min(24, d * 0.1);
    // the star (of either end's system) in the way: go around it
    const blocker = [A.system, B.system]
      .filter((id, i, all): id is string => !!id && all.indexOf(id) === i)
      .map((id) => stars?.get(id))
      .find((st): st is StarBox => !!st && crossesStar(A, B, st));
    if (blocker) {
      // how far the chord's line is from the star along the normal, and which side is away from the name below it
      const off = (mx - blocker.x) * nx + (my - blocker.y) * ny;
      const nameC = { x: blocker.name.x + blocker.name.w / 2, y: blocker.name.y + blocker.name.h / 2 };
      const nameSide = (nameC.x - mx) * nx + (nameC.y - my) * ny; // the name's side along the normal
      const away = nameSide > 0 ? -1 : 1;
      // all the way round: the curve's middle ends up past the planets' orbit; on the side with fewer planets in
      // the way, the side away from the name when it is a tie
      const fullOn = (sg: number) => clamp(2 * (sg * (blocker.reach + 16) - off), -420, 420);
      const planetsOn = (sg: number) => {
        const cxx = mx + nx * fullOn(sg);
        const cyy = my + ny * fullOn(sg);
        let n = 0;
        for (const [id, sp] of spots) {
          if (id === a.from || id === a.to || sp.system !== blocker.system) continue;
          for (let i = 1; i < 20; i++) {
            const t = i / 20;
            const u = 1 - t;
            const x = u * u * A.x + 2 * u * t * cxx + t * t * B.x;
            const y = u * u * A.y + 2 * u * t * cyy + t * t * B.y;
            if (Math.hypot(x - sp.x, y - sp.y) < sp.r + 4) {
              n++;
              break;
            }
          }
        }
        return n;
      };
      const sign = planetsOn(-away) < planetsOn(away) ? -away : away;
      const full = fullOn(sign);
      bend = full;
      // a chord that only grazes the name box needs just enough of a bow to clear it
      if (!crossesDisc(A, B, blocker)) {
        for (let b = 16; b < Math.abs(full); b += 8) {
          if (!curveHitsStar(A, B, mx + nx * sign * b, my + ny * sign * b, blocker)) {
            bend = sign * b;
            break;
          }
        }
      }
    }
    const cx = mx + nx * bend;
    const cy = my + ny * bend;
    // leave each planet at its edge, along the curve's direction there
    const sa = Math.atan2(cy - A.y, cx - A.x);
    const sb = Math.atan2(cy - B.y, cx - B.x);
    out.push({
      from: a.from,
      to: a.to,
      label: a.label,
      ax: A.x + Math.cos(sa) * (A.r + 5),
      ay: A.y + Math.sin(sa) * (A.r + 5),
      bx: B.x + Math.cos(sb) * (B.r + 7),
      by: B.y + Math.sin(sb) * (B.r + 7),
      cx,
      cy,
      detour: !!blocker,
    });
  }
  return out;
}

/** The point halfway along a curve (where its label goes). */
export function curveMid(c: ArrowCurve) {
  return { x: 0.25 * c.ax + 0.5 * c.cx + 0.25 * c.bx, y: 0.25 * c.ay + 0.5 * c.cy + 0.25 * c.by };
}

/**
 * Where a curve's label sits: the middle, or the nearest point along it that is not on a star or a star's name
 * (so the chip never hides them).
 */
export function curveLabelPoint(c: ArrowCurve, stars?: Map<string, StarBox>, halfW = 45): { x: number; y: number } {
  const at = (t: number) => {
    const u = 1 - t;
    return { x: u * u * c.ax + 2 * u * t * c.cx + t * t * c.bx, y: u * u * c.ay + 2 * u * t * c.cy + t * t * c.by };
  };
  if (stars)
    for (const t of [0.5, 0.44, 0.56, 0.38, 0.62, 0.32, 0.68, 0.26, 0.74, 0.2, 0.8]) {
      const p = at(t);
      // the chip is wider than a point: keep its middle `halfW` px and 14 px clear of every box
      const hit = [...stars.values()].some((st) => Math.hypot(p.x - st.x, p.y - st.y) < st.r + 6 || (p.x > st.name.x - halfW && p.x < st.name.x + st.name.w + halfW && p.y > st.name.y - 14 && p.y < st.name.y + st.name.h + 14));
      if (!hit) return p;
    }
  return at(0.5);
}
