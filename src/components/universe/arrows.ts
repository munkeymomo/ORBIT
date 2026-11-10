/**
 * A verse's arrows (relations between two of its planets, such as "made from") as curves on screen. Pure, so the
 * drawn list can be tested. An arrow is drawn only when both of its planets are drawn one by one, in systems of the
 * same galaxy; it is never a dependency, never "blocked", and never touches a task's scoring.
 */
import type { Arrow } from '../../host/types';
import { clamp } from '../../lib/util';
import { LOD, type GalaxyPlace, type View } from './space';

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
}

interface Spot {
  x: number;
  y: number;
  r: number;
  galaxy: string;
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
        out.set(id, { x: (s.x + sl.x) * k + view.x, y: (s.y + sl.y) * k + view.y, r: clamp(sl.d * k, 14, 64) / 2, galaxy: g.id });
      };
      s.pv.tasks.forEach((tv, i) => put(tv.task.id, i));
      (s.pv.items ?? []).forEach((iv, j) => put(iv.item.id, s.pv.tasks.length + j));
    }
  return out;
}

/** The arrows to draw: both ends drawn, in one galaxy. Each bends a little to its left, so A→B and B→A part. */
export function arrowCurves(arrows: Arrow[], spots: Map<string, Spot>): ArrowCurve[] {
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
    const bend = Math.min(60, d * 0.18);
    const cx = (A.x + B.x) / 2 + nx * bend;
    const cy = (A.y + B.y) / 2 + ny * bend;
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
    });
  }
  return out;
}

/** The point halfway along a curve (where its label goes). */
export function curveMid(c: ArrowCurve) {
  return { x: 0.25 * c.ax + 0.5 * c.cx + 0.25 * c.bx, y: 0.25 * c.ay + 0.5 * c.cy + 0.25 * c.by };
}
