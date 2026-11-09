/**
 * Spatial layout of the Universe.
 * Galaxies (groups) have world positions; systems (projects) are positioned
 * relative to their galaxy's centre, or to deep space when they have no galaxy.
 */

/** Minimum distance between two systems inside a galaxy. */
export const SYSTEM_SPACING = 560;
/** Minimum distance between two galaxy centres. */
export const GALAXY_SPACING = 3800;

export interface Pt {
  x: number;
  y: number;
}

/** Finds an open spot near (cx, cy) at least `minDist` from every point in `taken` (golden-angle spiral). */
export function findFreeSpot(cx: number, cy: number, taken: Pt[], minDist: number): Pt {
  for (let step = 0; step < 600; step++) {
    const a = step * 2.399963;
    const r = step === 0 ? 0 : minDist * 0.45 + Math.sqrt(step) * minDist * 0.32;
    const x = Math.round(cx + Math.cos(a) * r);
    const y = Math.round(cy + Math.sin(a) * r);
    if (taken.every((p) => Math.hypot(p.x - x, p.y - y) >= minDist)) return { x, y };
  }
  return { x: Math.round(cx + taken.length * minDist), y: Math.round(cy) };
}

/** The grid used for automatic galaxy placement before v4 (kept to recognise untouched galaxies). */
export function gridSlot(i: number): Pt {
  const col = i % 3;
  const row = Math.floor(i / 3);
  return { x: col * GALAXY_SPACING, y: row * Math.round(GALAXY_SPACING * 0.85) };
}

/**
 * Galaxy slots along an Archimedean spiral arm winding out from the centre:
 * the first galaxy sits at the core and each new one continues the arm, about
 * one galaxy-spacing further along it. Arms are one spacing apart, so slots never crowd.
 */
const spiralCache: Pt[] = [];
export function spiralSlot(i: number): Pt {
  const S = GALAXY_SPACING;
  const b = S / (2 * Math.PI); // r = b·θ → successive turns are S apart
  const theta1 = 0.9 * 2 * Math.PI; // first slot out at r = 0.9·S
  const rot = -theta1 - 0.35; // turn the arm so the first step heads up-right
  if (!spiralCache.length) spiralCache.push({ x: 0, y: 0 });
  let theta = theta1;
  // rebuild incrementally from the last cached slot's angle
  for (let k = spiralCache.length; k <= i; k++) {
    theta = theta1;
    for (let j = 1; j < k; j++) theta += (S * 0.95) / (b * theta);
    const r = b * theta * (1 + 0.05 * Math.sin(k * 2.3)); // gentle, deterministic wobble
    spiralCache.push({ x: Math.round(Math.cos(theta + rot) * r), y: Math.round(Math.sin(theta + rot) * r) });
  }
  return spiralCache[i];
}

type LooseProject = { id: string; groupId?: string | null; x?: number; y?: number } & Record<string, unknown>;
type LooseGroup = { id: string } & Record<string, unknown>;

/**
 * Converts the v2 layout (absolute project positions, groups without positions)
 * to v3 (galaxy centres + relative system positions). The arrangement inside each
 * group is kept, spread out by `spread` so full systems have room to orbit.
 */
export function migrateLayoutV2toV3<P extends LooseProject, G extends LooseGroup>(
  projects: P[],
  groups: G[],
  spread = 2.2,
): { projects: P[]; groups: (G & Pt)[]; deepSpace: Pt } {
  const groupIds = new Set(groups.map((g) => g.id));
  const key = (p: P) => (p.groupId && groupIds.has(p.groupId) ? p.groupId : '__deep__');
  const clusters = [...groups.map((g) => g.id), '__deep__'];
  const centres = new Map<string, Pt>();
  let slot = 0;
  const outGroups = groups.map((g) => {
    const c = spiralSlot(slot++);
    centres.set(g.id, c);
    return { ...g, x: c.x, y: c.y };
  });
  const hasDeep = projects.some((p) => key(p) === '__deep__');
  const deepSpace = hasDeep ? spiralSlot(slot++) : spiralSlot(slot);

  const outProjects = projects.map((p) => ({ ...p }));
  for (const cid of clusters) {
    const members = outProjects.filter((p) => key(p) === cid);
    if (!members.length) continue;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    const cx = members.reduce((s, p) => s + num(p.x), 0) / members.length;
    const cy = members.reduce((s, p) => s + num(p.y), 0) / members.length;
    for (const p of members) {
      (p as LooseProject).x = Math.round((num(p.x) - cx) * spread);
      (p as LooseProject).y = Math.round((num(p.y) - cy) * spread);
    }
    // Pull apart any systems that still overlap after spreading.
    const placed: Pt[] = [];
    for (const p of members) {
      const here = { x: num(p.x), y: num(p.y) };
      const ok = placed.every((q) => Math.hypot(q.x - here.x, q.y - here.y) >= 400);
      const spot = ok ? here : findFreeSpot(here.x, here.y, placed, 400);
      (p as LooseProject).x = spot.x;
      (p as LooseProject).y = spot.y;
      placed.push(spot);
    }
  }
  return { projects: outProjects, groups: outGroups, deepSpace };
}

/** The first spiral slot clear of every taken centre. */
export function nextGalaxySpot(taken: Pt[]): Pt {
  for (let i = 0; i < 300; i++) {
    const s = spiralSlot(i);
    if (taken.every((t) => Math.hypot(t.x - s.x, t.y - s.y) >= GALAXY_SPACING * 0.8)) return s;
  }
  return findFreeSpot(0, 0, taken, GALAXY_SPACING);
}

/** Lays galaxies (oldest first) along the spiral, then deep space if it is in use. */
export function spiralLayout(galaxyIds: string[], withDeepSpace: boolean): { galaxies: Map<string, Pt>; deepSpace: Pt | null } {
  const galaxies = new Map<string, Pt>();
  galaxyIds.forEach((id, i) => galaxies.set(id, spiralSlot(i)));
  return { galaxies, deepSpace: withDeepSpace ? spiralSlot(galaxyIds.length) : null };
}

const onGrid = (p: Pt) => {
  for (let i = 0; i < 64; i++) {
    const g = gridSlot(i);
    if (g.x === p.x && g.y === p.y) return true;
  }
  return false;
};

/**
 * v3 → v4: galaxies still sitting on the old automatic grid move onto the spiral;
 * any galaxy the user has dragged somewhere else stays exactly where it is.
 */
export function relayoutAutoPlaced(
  groups: { id: string; x: number; y: number; createdAt?: number }[],
  deepSpace: Pt,
  deepInUse: boolean,
): { moves: Map<string, Pt>; deepSpace: Pt } {
  const ordered = [...groups].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const taken: Pt[] = ordered.filter((g) => !onGrid(g)).map((g) => ({ x: g.x, y: g.y }));
  const deepAuto = onGrid(deepSpace);
  if (deepInUse && !deepAuto) taken.push(deepSpace);
  const moves = new Map<string, Pt>();
  for (const g of ordered) {
    if (!onGrid(g)) continue;
    const spot = nextGalaxySpot(taken);
    taken.push(spot);
    moves.set(g.id, spot);
  }
  let ds = deepSpace;
  if (deepAuto || !deepInUse) {
    ds = nextGalaxySpot(taken);
  }
  return { moves, deepSpace: ds };
}
