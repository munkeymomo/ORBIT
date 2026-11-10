/**
 * Where each galaxy's name, chip and counts go at the whole-universe view, so that neighbouring galaxies' words
 * never cover each other. Pure (screen pixels in, boxes out).
 *
 * Each label is tried, in order: under its galaxy (the usual place), above it, beside it (right, then left), then the
 * short form (the name and chip only, counts on hover) in the same places. A label covers no other label and no other
 * galaxy's bright middle. The biggest galaxies are placed first. One that finds no free place keeps the short form
 * under its galaxy.
 */
import { overlaps, type Rect } from './labels';

export interface GalaxyLabelInput {
  id: string;
  /** Galaxy centre and radius on screen. */
  cx: number;
  cy: number;
  sr: number;
  /** Width the label needs (its widest line, with padding). */
  w: number;
  /** It has a chip (one more line). */
  chip: boolean;
}

export interface GalaxyLabelSpot extends Rect {
  /** The short form: name (and chip) only. */
  brief: boolean;
  side: 'below' | 'above' | 'right' | 'left';
}

/** Heights of the label's lines (px), as GalaxyLabel draws them. */
export const GALAXY_LABEL_H = { name: 36, chip: 24, counts: 18, bar: 12 } as const;

export function galaxyLabelHeight(chip: boolean, brief: boolean) {
  return GALAXY_LABEL_H.name + (chip ? GALAXY_LABEL_H.chip : 0) + (brief ? 0 : GALAXY_LABEL_H.counts + GALAXY_LABEL_H.bar);
}

/** How far from the centre the label's near edge is (as before: inside the disk's lower part for big galaxies). */
export const galaxyLabelGap = (sr: number) => Math.min(sr * 0.92, sr * 0.5 + 70);

export function placeGalaxyLabels(items: GalaxyLabelInput[], bounds: { w: number; h: number; top: number }): Map<string, GalaxyLabelSpot> {
  const out = new Map<string, GalaxyLabelSpot>();
  const placed: Rect[] = [];
  const inBounds = (r: Rect) => r.y >= bounds.top - 4 && r.y + r.h <= bounds.h + 4 && r.x >= -20 && r.x + r.w <= bounds.w + 20;
  const order = [...items].sort((a, b) => b.sr - a.sr || a.id.localeCompare(b.id));
  // the bright middle of every galaxy (its spiral): no other galaxy's words go over it
  const cores = new Map(items.map((it) => [it.id, { x: it.cx - it.sr * 0.72, y: it.cy - it.sr * 0.72, w: it.sr * 1.44, h: it.sr * 1.44 }]));
  for (const it of order) {
    const gap = galaxyLabelGap(it.sr);
    const make = (side: GalaxyLabelSpot['side'], brief: boolean): GalaxyLabelSpot => {
      const h = galaxyLabelHeight(it.chip, brief);
      if (side === 'right' || side === 'left') {
        const x = side === 'right' ? it.cx + it.sr * 0.8 + 6 : it.cx - it.sr * 0.8 - 6 - it.w;
        return { x, y: it.cy - h / 2, w: it.w, h, brief, side };
      }
      const y = side === 'below' ? it.cy + gap : it.cy - gap - h;
      return { x: it.cx - it.w / 2, y, w: it.w, h, brief, side };
    };
    const sides: GalaxyLabelSpot['side'][] = ['below', 'above', 'right', 'left'];
    const tries = [...sides.map((d) => make(d, false)), ...sides.map((d) => make(d, true))];
    const others = [...cores].filter(([id]) => id !== it.id).map(([, r]) => r);
    const free = (r: Rect) => !placed.some((p) => overlaps(r, p, 4)) && !others.some((c) => overlaps(r, c));
    const spot = tries.find((r) => free(r) && inBounds(r)) ?? tries.find(free) ?? tries[sides.length];
    placed.push(spot);
    out.set(it.id, spot);
  }
  return out;
}
