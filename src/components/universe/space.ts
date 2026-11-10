import type { Group, HostRef } from '../../types';
import type { Beacon, Collection } from '../../host/types';
import type { MoonSet } from '../../host/adapt';
import { colorHex } from '../../lib/colors';
import { clamp } from '../../lib/util';
import { orbitLayout, type ProjectView } from './model';
import { findFreeSpot, SYSTEM_SPACING } from '../../data/layout';

/**
 * The Universe as a three-level hierarchy, drawn with semantic zoom:
 *   universe → galaxies (groups) → systems (projects, a star) → planets (tasks).
 * World units: a system is ~300 across, a galaxy ~2000, galaxies ~3800 apart.
 */

export const DEEP_SPACE_ID = 'deep-space';
export const MIN_K = 0.04;
export const MAX_K = 2.6;

/** Zoom thresholds for level of detail. */
export const LOD = {
  /** Systems become interactive stars with names. Below this they are points of light. */
  systems: 0.17,
  /** Orbits and planet dots appear. */
  planetDots: 0.24,
  /** Planets become interactive. */
  planets: 0.58,
  /** Planet names appear. */
  planetLabels: 0.72,
} as const;

export interface View {
  x: number;
  y: number;
  k: number;
}

export interface Slot {
  x: number;
  y: number;
  d: number;
}

/** When the sky would get too busy to read (host records only; ORBIT's own sky is unchanged). */
export const CLUTTER = {
  /** Moons drawn on one planet before the rest are counted as "+n". */
  moons: 5,
  /** Open tasks in one system above which they are drawn as a ring of dots with a count. */
  tasks: 40,
  /** Belt items above which a belt is drawn as a ring of haze with a count. */
  belt: 60,
} as const;

/** What a host adds to the sky (empty when standalone). */
export interface SpaceExtras {
  beacons: Beacon[];
  attachments: Record<string, MoonSet>;
  collections: Record<string, Collection>;
}

export interface SystemPlace {
  pv: ProjectView;
  galaxyId: string;
  /** World position */
  x: number;
  y: number;
  /** Position relative to the galaxy */
  rx: number;
  ry: number;
  rings: number[];
  /** Planet slots relative to the star; the last slot is the "add a task" slot. */
  slots: Slot[];
  /** Radius that contains the whole system including labels. */
  extent: number;
  /** Too many open tasks to draw one by one: they are a ring of dots with a count. */
  busy: boolean;
  /** The system's belt (what it holds that no planet uses), at radius r (world units). */
  belt: { r: number; collection: Collection; haze: boolean } | null;
  /** Beacons drawn beside the system. */
  beacons: Beacon[];
  /** Radius (world units) of the ring the system's beacons sit on. */
  beaconR: number;
  host?: HostRef;
}

export interface GalaxyPlace {
  id: string;
  name: string;
  hex: string;
  x: number;
  y: number;
  r: number;
  virtual: boolean;
  group: Group | null;
  systems: SystemPlace[];
  open: number;
  done: number;
  total: number;
  parked: number;
  overdue: number;
  matches: boolean;
  hasActive: boolean;
  /** Beacons on the galaxy's rim. */
  beacons: Beacon[];
  host?: HostRef;
}

/** Where a galaxy's i-th beacon sits on its rim (world units). */
export function galaxyBeaconSpot(g: { x: number; y: number; r: number }, i: number) {
  const a = -0.95 + i * 0.3;
  const r = g.r * 1.06;
  return { x: g.x + Math.cos(a) * r, y: g.y + Math.sin(a) * r };
}

/** Where a system's i-th beacon sits beside it (world units), upper right, clear of planets and belt. */
export function systemBeaconSpot(s: { x: number; y: number; beaconR: number }, i: number) {
  const a = -1.1 + i * 0.34;
  return { x: s.x + Math.cos(a) * s.beaconR, y: s.y + Math.sin(a) * s.beaconR };
}

const NO_EXTRAS: SpaceExtras = { beacons: [], attachments: {}, collections: {} };

export function systemExtent(rings: number[], radius: number): number {
  return (rings.at(-1) ?? radius + 50) + 48;
}

export function buildSpace(
  model: ProjectView[],
  groups: Group[],
  deepSpace: { x: number; y: number },
  filterOn: boolean,
  drag: { kind: 'system'; id: string; wx: number; wy: number } | { kind: 'galaxy'; id: string; x: number; y: number } | null,
  extras: SpaceExtras = NO_EXTRAS,
): GalaxyPlace[] {
  const beaconsOfSystem = new Map<string, Beacon[]>();
  const beaconsOfGalaxy = new Map<string, Beacon[]>();
  for (const b of extras.beacons) {
    if (b.system) beaconsOfSystem.set(b.system, [...(beaconsOfSystem.get(b.system) ?? []), b]);
    else if (b.galaxy) beaconsOfGalaxy.set(b.galaxy, [...(beaconsOfGalaxy.get(b.galaxy) ?? []), b]);
  }
  const groupIds = new Set(groups.map((g) => g.id));
  const centre = (id: string, x: number, y: number) => (drag?.kind === 'galaxy' && drag.id === id ? { x: drag.x, y: drag.y } : { x, y });
  const make = (id: string, name: string, color: string, at: { x: number; y: number }, group: Group | null): GalaxyPlace => {
    const members = model.filter((pv) => (group ? pv.project.groupId === group.id : !pv.project.groupId || !groupIds.has(pv.project.groupId)));
    const c = centre(id, at.x, at.y);
    const dragged = (pv: ProjectView) => drag?.kind === 'system' && drag.id === pv.project.id;
    const systems: SystemPlace[] = members.map((pv) => {
      const rel = drag?.kind === 'system' && dragged(pv) ? { x: drag.wx - c.x, y: drag.wy - c.y } : { x: pv.project.x, y: pv.project.y };
      const host = pv.project.host;
      const busy = !!host && pv.stats.open > CLUTTER.tasks;
      const laid = busy ? { rings: [pv.radius + 86], slots: [] } : orbitLayout(pv, pv.canAdd);
      const { rings, slots } = laid;
      const outer = rings.at(-1) ?? pv.radius + 50;
      const coll = extras.collections[pv.project.id];
      const belt = coll ? { r: outer + 74, collection: coll, haze: coll.total > CLUTTER.belt || !coll.items?.length } : null;
      const beacons = beaconsOfSystem.get(pv.project.id) ?? [];
      const beaconR = (belt ? belt.r : outer) + 46;
      let extent = systemExtent(rings, pv.radius);
      if (belt) extent = Math.max(extent, belt.r + 60);
      if (beacons.length) extent = Math.max(extent, beaconR + 24);
      return { pv, galaxyId: id, x: c.x + rel.x, y: c.y + rel.y, rx: rel.x, ry: rel.y, rings, slots, extent, busy, belt, beacons, beaconR, host };
    });
    // A star being dragged does not stretch its galaxy.
    const r = Math.max(700, ...systems.filter((s) => !dragged(s.pv)).map((s) => Math.hypot(s.rx, s.ry) + s.extent + 120));
    const sum = (f: (s: SystemPlace) => number) => systems.reduce((a, s) => a + f(s), 0);
    return {
      id,
      name,
      hex: colorHex(color),
      x: c.x,
      y: c.y,
      r,
      // deep space, or a holder the host made up for loose systems
      virtual: !group || !!group.host?.virtual,
      group,
      systems,
      open: sum((s) => s.pv.stats.open),
      done: sum((s) => s.pv.stats.done),
      total: sum((s) => s.pv.stats.total),
      parked: sum((s) => s.pv.stats.parked),
      overdue: sum((s) => s.pv.stats.overdue),
      matches: !filterOn || systems.some((s) => s.pv.matches),
      hasActive: systems.some((s) => s.pv.hasActive),
      beacons: group ? (beaconsOfGalaxy.get(group.id) ?? []) : [],
      host: group?.host,
    };
  };
  const out = groups.map((g) => make(g.id, g.name, g.color, { x: g.x, y: g.y }, g));
  const deep = make(DEEP_SPACE_ID, 'Deep space', '#8E95A9', deepSpace, null);
  if (deep.systems.length) out.push(deep);
  return out;
}

/* ---------------- view maths ---------------- */

export interface Size {
  w: number;
  h: number;
  /** Space taken by the toolbar at the top (measured). */
  top?: number;
}
export const PADS = { top: 76, bottom: 72, side: 40 };
/** Room kept beside a system for planet names that hang outside its outer orbit (screen px, each side). */
export const NAME_ROOM = 80;
/** Room under the galaxies of the whole universe for their names, chips and counts (screen px). */
export const UNIVERSE_LABEL_ROOM = 96;
/** Room above for a cluster's name on its outline (screen px). */
export const CLUSTER_ROOM = 22;

const topPad = (size: Size) => size.top ?? PADS.top;

export function fitCircle(cx: number, cy: number, r: number, size: Size, maxK = MAX_K, side = PADS.side): View {
  const top = topPad(size);
  const k = clamp(Math.min((size.w - side * 2) / (2 * r), (size.h - top - PADS.bottom) / (2 * r)), MIN_K, maxK);
  const midY = top + (size.h - top - PADS.bottom) / 2;
  return { k, x: size.w / 2 - cx * k, y: midY - cy * k };
}

/**
 * The whole universe: every galaxy, with room in screen pixels for the names under them and for a cluster's
 * name above (so the fit is the same at any window size, and a wide window is filled as far as its height allows).
 */
export function fitUniverse(galaxies: GalaxyPlace[], size: Size): View {
  if (!galaxies.length) return { x: size.w / 2, y: size.h / 2, k: 0.4 };
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const g of galaxies) {
    minX = Math.min(minX, g.x - g.r);
    maxX = Math.max(maxX, g.x + g.r);
    minY = Math.min(minY, g.y - g.r);
    maxY = Math.max(maxY, g.y + g.r);
  }
  const top = topPad(size) + CLUSTER_ROOM;
  const availW = size.w - PADS.side * 2;
  const availH = size.h - top - PADS.bottom - UNIVERSE_LABEL_ROOM;
  const k = clamp(Math.min(availW / Math.max(1, maxX - minX), Math.max(40, availH) / Math.max(1, maxY - minY)), MIN_K, 0.6);
  const contentH = (maxY - minY) * k + UNIVERSE_LABEL_ROOM;
  const y0 = top + Math.max(0, (size.h - top - PADS.bottom - contentH) / 2);
  return { k, x: size.w / 2 - ((minX + maxX) / 2) * k, y: y0 - minY * k };
}

export function fitGalaxy(g: GalaxyPlace, size: Size): View {
  return fitCircle(g.x, g.y, g.r + 60, size, 0.9);
}

/**
 * A system: its outer orbit, belt and dates, with room beside it for planet names; then the labels of its
 * dates (which hang to the right of their diamonds, at a fixed size) are kept in view, by moving the system
 * left when there is room on that side, or else by zooming out a little.
 */
export function fitSystem(s: SystemPlace, size: Size, measure: (t: string) => number = (t) => t.length * 6.3): View {
  // planet names need room beside the outer orbit; a very narrow canvas gives the system all it has
  const side = size.w >= 700 ? PADS.side + NAME_ROOM : PADS.side;
  let v = fitCircle(s.x, s.y + 12, s.extent + 24, size, 1.6, side);
  if (!s.beacons.length) return v;
  const right = size.w - PADS.side;
  for (let i = 0; i < 4; i++) {
    let need = -Infinity;
    s.beacons.forEach((b, j) => {
      const a = -1.1 + j * 0.34;
      const bx = (s.x + Math.cos(a) * s.beaconR) * v.k + v.x;
      need = Math.max(need, bx + 10 + measure(`${[b.code, b.title].filter(Boolean).join(' ')} · in 00 d${b.serves ? ` · serves ${b.serves}` : ''}`) + 6);
    });
    const over = need - right;
    if (over <= 0) break;
    const leftEdge = (s.x - s.extent - 24) * v.k + v.x;
    const room = leftEdge - PADS.side;
    if (room >= over) {
      v = { ...v, x: v.x - over };
      break;
    }
    if (room > 0) v = { ...v, x: v.x - room };
    // zoom out about the system's centre so the labels come in
    const k2 = Math.max(MIN_K, v.k * Math.max(0.8, (right - ((s.x * v.k + v.x))) / Math.max(1, need - (s.x * v.k + v.x))));
    const cx = s.x * v.k + v.x;
    const cy = (s.y + 12) * v.k + v.y;
    v = { k: k2, x: cx - s.x * k2, y: cy - (s.y + 12) * k2 };
  }
  return v;
}

/**
 * Where are we? A galaxy counts as "entered" when it fills a good part of the view
 * and sits under its centre; likewise a system inside it. Zoom alone is not enough:
 * the whole-universe view can have its centre inside a small, distant galaxy.
 */
export function contextAt(galaxies: GalaxyPlace[], view: View, size: Size): { galaxy: GalaxyPlace | null; system: SystemPlace | null } {
  const top = topPad(size);
  const usable = Math.max(1, Math.min(size.w, size.h - top - PADS.bottom));
  const cx = (size.w / 2 - view.x) / view.k;
  const cy = (top + (size.h - top - PADS.bottom) / 2 - view.y) / view.k;
  let galaxy: GalaxyPlace | null = null;
  let best = Infinity;
  for (const g of galaxies) {
    const fill = (2 * g.r * view.k) / usable;
    const d = Math.hypot(g.x - cx, g.y - cy) / g.r;
    if (fill >= 0.6 && d < 1.0 && d < best) {
      best = d;
      galaxy = g;
    }
  }
  let system: SystemPlace | null = null;
  if (galaxy) {
    let bestS = Infinity;
    for (const s of galaxy.systems) {
      const fill = (2 * s.extent * view.k) / usable;
      const d = Math.hypot(s.x - cx, s.y - cy) / s.extent;
      if (fill >= 0.5 && d < 1.2 && d < bestS) {
        bestS = d;
        system = s;
      }
    }
  }
  return { galaxy, system };
}

/**
 * The galaxy a point is over, nearest centre first (relative to size). The catch area reaches a little past
 * the disk so that dropping onto a galaxy's name, which sits on its rim at universe level, still counts.
 */
export function galaxyAt(galaxies: GalaxyPlace[], x: number, y: number, reach = 1.3): GalaxyPlace | null {
  let best: GalaxyPlace | null = null;
  let bestD = Infinity;
  for (const g of galaxies) {
    const d = Math.hypot(g.x - x, g.y - y) / g.r;
    if (d < reach && d < bestD) {
      bestD = d;
      best = g;
    }
  }
  return best;
}

/**
 * Where a star dropped on a galaxy settles, relative to that galaxy's centre: as near the drop point as
 * possible, inside the disk, and clear of the systems already there (drops at universe zoom are coarse).
 */
export function settleInGalaxy(g: GalaxyPlace, wx: number, wy: number, excludeId: string): { x: number; y: number } {
  let rx = wx - g.x;
  let ry = wy - g.y;
  const maxR = Math.max(0, g.r * 0.8 - 200);
  const d = Math.hypot(rx, ry);
  if (d > maxR && d > 0) {
    rx = (rx / d) * maxR;
    ry = (ry / d) * maxR;
  }
  const taken = g.systems.filter((s) => s.pv.project.id !== excludeId).map((s) => ({ x: s.rx, y: s.ry }));
  return findFreeSpot(Math.round(rx), Math.round(ry), taken, SYSTEM_SPACING);
}

export function screenToWorld(view: View, sx: number, sy: number) {
  return { x: (sx - view.x) / view.k, y: (sy - view.y) / view.k };
}

/** Smooth zoom interpolation: world centre moves linearly while scale changes in log space. */
export function interpolateView(a: View, b: View, t: number, size: Size): View {
  const ax = (size.w / 2 - a.x) / a.k;
  const ay = (size.h / 2 - a.y) / a.k;
  const bx = (size.w / 2 - b.x) / b.k;
  const by = (size.h / 2 - b.y) / b.k;
  const k = Math.exp(Math.log(a.k) + (Math.log(b.k) - Math.log(a.k)) * t);
  // Bias the centre towards the destination early when zooming out, late when zooming in.
  const zoomingIn = b.k > a.k;
  const tt = zoomingIn ? t ** 0.7 : 1 - (1 - t) ** 0.7;
  const cx = ax + (bx - ax) * tt;
  const cy = ay + (by - ay) * tt;
  return { k, x: size.w / 2 - cx * k, y: size.h / 2 - cy * k };
}

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/* ---------------- procedural galaxies ---------------- */

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r: () => number) {
  const u = Math.max(1e-9, r());
  const v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface Particles {
  n: number;
  /** Unit-radius positions */
  x: Float32Array;
  y: Float32Array;
  size: Float32Array;
  alpha: Float32Array;
  /** 0 = white-hot core, 1 = galaxy colour, 2 = pale blue arm stars */
  tone: Uint8Array;
}

const particleCache = new Map<string, Particles>();

/** A spiral galaxy, deterministic per galaxy id. Denser galaxies hold more open work. */
export function spiralParticles(id: string, density: number): Particles {
  const n = Math.round(clamp(1600 + density * 70, 1600, 3200) / 100) * 100;
  const key = `${id}:${n}`;
  const hit = particleCache.get(key);
  if (hit) return hit;
  const r = rng(hashString(id));
  const arms = 2 + (hashString(id) % 3);
  const twist = 2.9 + r() * 1.1;
  const rot = r() * Math.PI * 2;
  const p: Particles = { n, x: new Float32Array(n), y: new Float32Array(n), size: new Float32Array(n), alpha: new Float32Array(n), tone: new Uint8Array(n) };
  for (let i = 0; i < n; i++) {
    const kind = i % 6; // 0: soft disk between the arms, 1: bulge, else: arm stars
    let x: number, y: number, t: number;
    if (kind === 0) {
      t = Math.sqrt(r()) * 0.92;
      const a = r() * Math.PI * 2;
      x = Math.cos(a) * t;
      y = Math.sin(a) * t;
    } else if (kind === 1) {
      t = Math.abs(gauss(r)) * 0.11;
      const a = r() * Math.PI * 2;
      x = Math.cos(a) * t;
      y = Math.sin(a) * t;
    } else {
      t = 0.08 + Math.pow(r(), 0.9) * 0.9;
      const arm = i % arms;
      const base = rot + (arm * 2 * Math.PI) / arms + Math.log(1 + t * 6) * twist * 0.62;
      const a = base + gauss(r) * (0.05 + 0.1 * t);
      const rr = t + gauss(r) * 0.022;
      x = Math.cos(a) * rr;
      y = Math.sin(a) * rr;
    }
    p.x[i] = x;
    p.y[i] = y;
    const bright = r() < 0.05;
    p.tone[i] = kind === 1 || t < 0.12 ? 0 : kind === 0 ? 1 : r() < 0.25 ? 2 : 1;
    p.size[i] = kind === 1 ? 0.7 + r() * 1.1 : bright ? 1.6 + r() * 1.4 : 0.55 + r() * 0.9;
    p.alpha[i] = kind === 0 ? 0.08 + r() * 0.16 : kind === 1 ? 0.5 + r() * 0.5 : (0.45 + r() * 0.55) * (1 - t * 0.45);
  }
  particleCache.set(key, p);
  return p;
}

/** A loose cluster for deep space (no spiral). */
export function clusterParticles(id: string): Particles {
  const key = `${id}:cluster`;
  const hit = particleCache.get(key);
  if (hit) return hit;
  const r = rng(hashString(id) ^ 0x9e3779b9);
  const n = 420;
  const p: Particles = { n, x: new Float32Array(n), y: new Float32Array(n), size: new Float32Array(n), alpha: new Float32Array(n), tone: new Uint8Array(n) };
  for (let i = 0; i < n; i++) {
    const a = r() * Math.PI * 2;
    const t = Math.sqrt(r());
    p.x[i] = Math.cos(a) * t;
    p.y[i] = Math.sin(a) * t;
    p.size[i] = 0.5 + r() * 1.1;
    p.alpha[i] = 0.1 + r() * 0.3;
    p.tone[i] = r() < 0.3 ? 2 : 1;
  }
  particleCache.set(key, p);
  return p;
}

export interface FieldStar {
  x: number;
  y: number;
  s: number;
  a: number;
  c: string;
}
const TILE = 1400;
let field: FieldStar[][] | null = null;

/** Three parallax layers of background stars, tiled. */
export function starField(): { tile: number; layers: FieldStar[][] } {
  if (!field) {
    const r = rng(42);
    const tints = ['#ffffff', '#ffffff', '#dfe6ff', '#fff3df', '#cfd8ff'];
    field = [260, 170, 90].map((count, li) =>
      Array.from({ length: count }, () => ({
        x: r() * TILE,
        y: r() * TILE,
        s: (0.45 + r() * 0.7) * (1 + li * 0.35),
        a: (0.25 + r() * 0.55) * (li === 2 ? 1 : 0.8),
        c: tints[Math.floor(r() * tints.length)],
      })),
    );
  }
  return { tile: TILE, layers: field };
}
