/**
 * Where words go in the sky: planet names around a star, dates beside galaxies and systems, and the list of a
 * selected planet's moons. Pure functions (screen pixels in, boxes out), so they can be tested without a canvas.
 *
 * Rules for planet names:
 *   - a name sits on the outward side of its planet (away from the star), left- or right-aligned beside it, or
 *     centred above or below it near the top and bottom of the orbit;
 *   - it wraps to two lines at most, and the second line ends in an ellipsis at a word when it is still too long;
 *   - it never covers the system's own name, the star, another planet, or a name already placed; names are placed
 *     in order of importance (the selected one first, then late, then by priority), and one that finds no room
 *     is hidden (it shows on hover, and always when its planet is selected).
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Measure = (text: string) => number;

export function overlaps(a: Rect, b: Rect, pad = 0): boolean {
  return a.x < b.x + b.w + pad && b.x < a.x + a.w + pad && a.y < b.y + b.h + pad && b.y < a.y + a.h + pad;
}

export function inside(a: Rect, b: Rect): boolean {
  return a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
}

/** A circle as the square that holds it. */
export const circleRect = (x: number, y: number, r: number): Rect => ({ x: x - r, y: y - r, w: 2 * r, h: 2 * r });

const ELLIPSIS = '…';

/** The longest start of `text` that fits in `maxW`, cut at a word when one fits, with an ellipsis. */
export function ellipsize(text: string, maxW: number, measure: Measure): string {
  const t = text.trim();
  if (measure(t) <= maxW) return t;
  const words = t.split(/\s+/);
  let out = '';
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (measure(next + ELLIPSIS) > maxW) break;
    out = next;
  }
  if (out) return out.replace(/[\s,.;:–—-]+$/, '') + ELLIPSIS;
  // not even one word fits: cut the first word by characters
  let cut = '';
  for (const ch of words[0]) {
    if (measure(cut + ch + ELLIPSIS) > maxW) break;
    cut += ch;
  }
  return (cut || words[0].slice(0, 1)) + ELLIPSIS;
}

/** Word-wraps `text` into at most `maxLines` lines of `maxW`; the last line ends in an ellipsis if it must. */
export function wrapLabel(text: string, maxW: number, measure: Measure, maxLines = 2): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let i = 0;
  while (i < words.length && lines.length < maxLines) {
    if (lines.length === maxLines - 1) {
      lines.push(ellipsize(words.slice(i).join(' '), maxW, measure));
      return lines;
    }
    let line = words[i];
    if (measure(line) > maxW) {
      // a single long word: it gets a line of its own, cut
      lines.push(ellipsize(line, maxW, measure));
      i++;
      continue;
    }
    i++;
    while (i < words.length && measure(`${line} ${words[i]}`) <= maxW) line += ` ${words[i++]}`;
    lines.push(line);
  }
  return lines;
}

/**
 * Wraps `text` into at most `maxLines` lines. When it does not fit, the MIDDLE is cut ("Head… tail"), keeping the
 * start and the end, so names that differ only at the end stay different.
 */
export function wrapMiddle(text: string, maxW: number, measure: Measure, maxLines = 3): string[] {
  const clean = text.trim().replace(/\s+/g, ' ');
  const fits = (t: string) => wrapLabel(t, maxW, measure, maxLines + 1).length <= maxLines;
  if (fits(clean)) return wrapLabel(clean, maxW, measure, maxLines);
  for (let keep = clean.length - 1; keep >= 6; keep--) {
    const tailN = Math.ceil(keep * 0.4);
    let tail = clean.slice(clean.length - tailN);
    // start the tail at a word, not in the middle of one
    const sp = tail.indexOf(' ');
    if (sp > 0 && sp < tail.length - 3 && clean[clean.length - tailN - 1] !== ' ') tail = tail.slice(sp + 1);
    const head = clean.slice(0, keep - tailN).trimEnd();
    const cand = `${head}… ${tail}`;
    if (fits(cand)) return wrapLabel(cand, maxW, measure, maxLines);
  }
  return wrapLabel(clean, maxW, measure, maxLines);
}

export interface OrbitLabelInput {
  id: string;
  /** The planet's centre and radius (screen px). */
  x: number;
  y: number;
  r: number;
  text: string;
  /** Higher is placed first. */
  rank: number;
  /** Always shown (the selected planet). */
  force?: boolean;
  /** A small pill under the name ("2 changed"): it takes a line of its own, so no other name covers it. */
  pill?: string;
}

/** The height of a label's pill line (px), and the room its glyph and padding take beside its words. */
export const PILL_H = 17;
export const PILL_PAD = 24;

export type LabelSide = 'right' | 'left' | 'above' | 'below';

export interface OrbitLabel {
  id: string;
  shown: boolean;
  side: LabelSide;
  rect: Rect;
  lines: string[];
  /** The pill's words, when the planet has one (its box is the last 17px of `rect`). */
  pill?: string;
}

export interface OrbitLabelOptions {
  /** The star's centre: names go on the side away from it. */
  cx: number;
  cy: number;
  measure: Measure;
  maxW?: number;
  lineH?: number;
  gap?: number;
  /** Nothing may cover these (the system's name, the star, dates beside it). */
  blocked?: Rect[];
  /** Names must stay inside this (the visible canvas, below the toolbar). */
  bounds?: Rect;
}

/** The box a label would take on one side of its planet. */
export function labelRect(it: { x: number; y: number; r: number }, side: LabelSide, w: number, h: number, gap: number): Rect {
  switch (side) {
    case 'right':
      return { x: it.x + it.r + gap, y: it.y - h / 2, w, h };
    case 'left':
      return { x: it.x - it.r - gap - w, y: it.y - h / 2, w, h };
    case 'above':
      return { x: it.x - w / 2, y: it.y - it.r - gap - h, w, h };
    case 'below':
      return { x: it.x - w / 2, y: it.y + it.r + gap, w, h };
  }
}

/** The sides to try for a planet at angle `a` from its star: the outward side first. */
export function sidesFor(a: number): LabelSide[] {
  const ux = Math.cos(a);
  const uy = Math.sin(a);
  if (Math.abs(ux) >= 0.45) {
    const out: LabelSide = ux > 0 ? 'right' : 'left';
    const v: LabelSide = uy < 0 ? 'above' : 'below';
    return [out, v, v === 'above' ? 'below' : 'above', out === 'right' ? 'left' : 'right'];
  }
  const out: LabelSide = uy < 0 ? 'above' : 'below';
  const h: LabelSide = ux >= 0 ? 'right' : 'left';
  return [out, h, h === 'right' ? 'left' : 'right', out === 'above' ? 'below' : 'above'];
}

export function placeOrbitLabels(items: OrbitLabelInput[], o: OrbitLabelOptions): OrbitLabel[] {
  const maxW = o.maxW ?? 150;
  const lineH = o.lineH ?? 14;
  const gap = o.gap ?? 5;
  const blocked = o.blocked ?? [];
  const disks = items.map((it) => ({ id: it.id, rect: circleRect(it.x, it.y, it.r) }));
  const placed: Rect[] = [];
  const order = [...items].sort((a, b) => Number(!!b.force) - Number(!!a.force) || b.rank - a.rank);
  const out = new Map<string, OrbitLabel>();
  for (const it of order) {
    const lines = wrapLabel(it.text, maxW, o.measure, 2);
    const w = Math.ceil(Math.max(...lines.map((l) => o.measure(l)), it.pill ? o.measure(it.pill) * 0.92 + PILL_PAD : 0, 1));
    const h = lines.length * lineH + (it.pill ? PILL_H : 0);
    const sides = sidesFor(Math.atan2(it.y - o.cy, it.x - o.cx));
    const free = (r: Rect) =>
      (!o.bounds || inside(r, o.bounds)) &&
      !blocked.some((b) => overlaps(r, b, 2)) &&
      !placed.some((p) => overlaps(r, p, 3)) &&
      !disks.some((d) => d.id !== it.id && overlaps(r, d.rect, 1));
    let side: LabelSide = sides[0];
    let rect = labelRect(it, side, w, h, gap);
    let shown = false;
    for (const s of sides) {
      const r = labelRect(it, s, w, h, gap);
      if (free(r)) {
        side = s;
        rect = r;
        shown = true;
        break;
      }
    }
    if (!shown && it.force) {
      // the selected planet's name is always shown: on the first side that covers nothing it must not cover
      const ok = sides.find((s) => !blocked.some((b) => overlaps(labelRect(it, s, w, h, gap), b, 2)));
      side = ok ?? sides[0];
      rect = labelRect(it, side, w, h, gap);
      shown = true;
    }
    if (shown) placed.push(rect);
    out.set(it.id, { id: it.id, shown, side, rect, lines, pill: it.pill });
  }
  return items.map((it) => out.get(it.id)!);
}

/**
 * Labels beside a column of markers (dates on a galaxy's rim, or beside a system): when any two would touch,
 * they are collapsed into one ("3 dates") at the first marker, and the markers stay clickable one by one.
 */
export function collapseWhenCrowded(boxes: Rect[], pad = 2): boolean {
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) if (overlaps(boxes[i], boxes[j], pad)) return true;
  return false;
}

/**
 * Where the selected planet's moon list goes: on the side away from the detail panel (the panel is on the
 * right) when there is room there, inside the canvas, never wider than `cap`.
 */
export function moonListPlacement(p: { x: number; off: number; canvasW: number; panelRight: boolean; min?: number; cap?: number }): { left: boolean; maxW: number } {
  const min = p.min ?? 150;
  const cap = p.cap ?? 240;
  const roomRight = p.canvasW - (p.x + p.off) - 12;
  const roomLeft = p.x - p.off - 12;
  let left: boolean;
  if (p.panelRight) left = roomLeft >= min || roomLeft >= roomRight;
  else left = roomRight < min && roomLeft > roomRight;
  const room = left ? roomLeft : roomRight;
  return { left, maxW: Math.max(Math.min(cap, room), Math.min(min, Math.max(room, 90))) };
}

/**
 * The moon list placed outside a system altogether (past its outer orbit or belt: a circle of `outer` px round
 * the star at `sx`, `sy`), so it covers none of the system: left of it (away from the detail panel), right of
 * it, or in the top-left or top-right corner below the toolbar. Null when nowhere fits; the caller then puts it
 * beside the planet. `left` says the list hugs its right edge (it sits to the left of the system).
 */
export function outsideSystem(p: {
  sx: number;
  sy: number;
  /** The selected planet's height on screen: the list is centred on it where it can be. */
  py: number;
  outer: number;
  canvasW: number;
  canvasH: number;
  top: number;
  w: number;
  h: number;
  avoid?: Rect[];
}): { box: Rect; left: boolean } | null {
  const { w, h } = p;
  const y = Math.max(p.top + 4, Math.min(p.py - h / 2, p.canvasH - h - 76));
  const candidates: { box: Rect; left: boolean }[] = [
    { box: { x: p.sx - p.outer - 10 - w, y, w, h }, left: true },
    { box: { x: p.sx + p.outer + 10, y, w, h }, left: false },
    { box: { x: 12, y: p.top + 4, w, h }, left: false },
    { box: { x: p.canvasW - 12 - w, y: p.top + 4, w, h }, left: true },
  ];
  const canvas: Rect = { x: 8, y: p.top, w: p.canvasW - 16, h: p.canvasH - p.top - 8 };
  const clearOfCircle = (r: Rect) => {
    const nx = Math.max(r.x, Math.min(p.sx, r.x + r.w));
    const ny = Math.max(r.y, Math.min(p.sy, r.y + r.h));
    return Math.hypot(nx - p.sx, ny - p.sy) > p.outer + 4;
  };
  return candidates.find((c) => inside(c.box, canvas) && clearOfCircle(c.box) && !(p.avoid ?? []).some((a) => overlaps(c.box, a, 4))) ?? null;
}
