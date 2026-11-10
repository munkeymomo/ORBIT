/**
 * Turns a host's verse into ORBIT records: host galaxies become groups, host systems become projects and
 * host planets of type `task` become tasks. Each carries an in-memory `host` reference; ids are the host's.
 * Everything else a verse holds (attachments, collections, beacons, clusters, families, arrows) goes into a separate
 * slice keyed by id. Planets of type `item` are records shown as planets: they become `ItemPlanet`s, kept by system
 * in `extras.items`, and are never tasks (nothing that works on tasks ever sees them).
 *
 * Positions: a galaxy sits where the person put it (placement `g|<id>`), otherwise at the first free spiral
 * slot; a system sits where the person put it (placement `<verse>|<id>`, relative to its galaxy), otherwise at
 * a free spot in its galaxy. Auto-placement walks the verse in its own order, so it is the same on every
 * refresh of the same verse and the sky does not jump.
 */
import type { Group, HostRef, Placement, Priority, Project, Task } from '../types';
import type { Also, Arrow, Attachment, AttachmentState, Beacon, Caps, Cluster, Collection, Fact, Family, Galaxy, Open, Planet, System, Verse } from './types';
import { findFreeSpot, nextGalaxySpot, SYSTEM_SPACING, type Pt } from '../data/layout';
import { PROJECT_COLORS } from '../lib/colors';
import { isValidDateKey } from '../lib/util';

/** The id the Universe uses for deep space (systems with no galaxy). Same as DEEP_SPACE_ID in space.ts. */
export const DEEP_SPACE = 'deep-space';

/** Keys of the `placements` table. */
export const placementKey = {
  galaxy: (galaxyId: string) => `g|${galaxyId}`,
  system: (verseId: string, systemId: string) => `${verseId}|${systemId}`,
};

/** A planet's moons: what was sent, and how many more the host counted but did not send. */
export interface MoonSet {
  items: Attachment[];
  more: number;
}

/** Item planets are drawn this size (world units) when the host gives no `size`. */
export const ITEM_DIAMETER = { min: 26, max: 60, default: 32 } as const;

/**
 * A record shown as a planet (a planet of type `item`). NOT a task: it lives in `extras.items`, by system, and never
 * reaches anything that works on tasks (focus, parking, Today, Next, Insights, capture, search, counts).
 */
export interface ItemPlanet {
  id: string;
  system: string;
  /** The verse it came from. */
  verse: string;
  title: string;
  sub?: string;
  kind: string;
  family: string;
  state: AttachmentState;
  /** Its diameter in world units: from `size`, relative to the largest item of the verse (√, so area follows size). */
  diameter: number;
  /** The host's `size`, as sent. */
  size?: number;
  /** 0..1, or null for no ring. */
  ring: number | null;
  /** Shown outside its home galaxy: its only action is the way home. */
  ghost: boolean;
  note?: string;
  notes?: string;
  facts: Fact[];
  /** What it uses or holds (its moons). */
  moons: MoonSet;
  open?: Open;
  also: Also[];
}

/** What a verse holds besides galaxies, systems and tasks. */
export interface HostExtras {
  families: Record<string, Family>;
  /** Moons of TASK planets, by planet id (an item keeps its own in `ItemPlanet.moons`). */
  attachments: Record<string, MoonSet>;
  /** By system id. */
  collections: Record<string, Collection>;
  beacons: Beacon[];
  clusters: Cluster[];
  /** Item planets, by system id, in verse order. */
  items: Record<string, ItemPlanet[]>;
  /** Relations between planets of this verse whose two ends it has. */
  arrows: Arrow[];
}

export const NO_EXTRAS: HostExtras = { families: {}, attachments: {}, collections: {}, beacons: [], clusters: [], items: {}, arrows: [] };

export interface AdaptedVerse {
  verseId: string;
  rev: string;
  groups: Group[];
  projects: Project[];
  tasks: Task[];
  /** Where deep space sits, or null when no system lives there. */
  deepSpace: Pt | null;
  extras: HostExtras;
  /** Planets left out (pointing at a system the verse does not have, or of no known type). */
  skipped: number;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** The host's colour if it gave one, otherwise a palette colour picked from the id (stable). */
function colorFor(id: string, color?: string): string {
  if (color && (PROJECT_COLORS.some((c) => c.id === color) || /^#[0-9a-fA-F]{6}$/.test(color))) return color;
  return PROJECT_COLORS[hash(id) % PROJECT_COLORS.length].id;
}

const caps = (c?: Caps): Caps => ({ ...(c ?? {}) });
const round = (p: Pt): Pt => ({ x: Math.round(p.x), y: Math.round(p.y) });

function galaxyRef(verse: string, g: Galaxy): HostRef {
  return {
    id: g.id,
    kind: 'galaxy',
    verse,
    caps: caps(g.caps),
    status: g.status,
    chip: g.chip,
    virtual: g.virtual,
    finished: g.finished,
    cluster: g.cluster,
    facts: g.facts,
    open: g.open,
    also: g.also,
    actions: actionsOf(g.actions),
  };
}

function systemRef(verse: string, s: System): HostRef {
  return {
    id: s.id,
    kind: 'system',
    verse,
    caps: caps(s.caps),
    code: s.code,
    status: s.status,
    note: s.note,
    virtual: s.virtual,
    count: s.count,
    facts: s.facts,
    open: s.open,
    also: s.also,
    portal: s.portal && typeof s.portal.verse === 'string' && s.portal.verse ? { verse: s.portal.verse, label: s.portal.label } : undefined,
    actions: actionsOf(s.actions),
  };
}

/** A host's actions, keeping only well-formed ones. */
function actionsOf(a: unknown): HostRef['actions'] {
  if (!Array.isArray(a)) return undefined;
  const ok = a.filter((x): x is { id: string; label: string } => !!x && typeof x.id === 'string' && !!x.id && typeof x.label === 'string' && !!x.label.trim());
  return ok.length ? ok.map((x) => ({ id: x.id, label: x.label.trim() })) : undefined;
}

const STATES: AttachmentState[] = ['live', 'archived', 'gone'];

/** An item planet's diameter: √(size / largest), across the item range; no size → the default. */
export function itemDiameter(size: number | undefined, largest: number): number {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 0 || !(largest > 0)) return ITEM_DIAMETER.default;
  return Math.round(ITEM_DIAMETER.min + (ITEM_DIAMETER.max - ITEM_DIAMETER.min) * Math.sqrt(Math.min(1, size / largest)));
}

export function planetToItem(verse: string, p: Planet, largest: number): ItemPlanet {
  const ring = typeof p.ring === 'number' && Number.isFinite(p.ring) ? Math.max(0, Math.min(1, p.ring)) : null;
  return {
    id: p.id,
    system: p.system,
    verse,
    title: p.title,
    sub: p.sub,
    kind: p.kind ?? '',
    family: p.family ?? '',
    state: STATES.includes(p.state as AttachmentState) ? (p.state as AttachmentState) : 'live',
    diameter: itemDiameter(p.size, largest),
    size: typeof p.size === 'number' ? p.size : undefined,
    ring,
    ghost: !!p.ghost,
    note: p.note,
    notes: p.notes,
    facts: p.facts ?? [],
    moons: { items: p.attachments ?? [], more: p.more ?? 0 },
    open: p.open,
    also: p.also ?? [],
  };
}

function taskRef(verse: string, p: Planet): HostRef {
  return { id: p.id, kind: 'task', verse, caps: caps(p.caps), note: p.note, dropped: p.dropped, facts: p.facts, open: p.open, also: p.also };
}

const PRIORITIES: Priority[] = [1, 2, 3, 4];

export function planetToTask(verse: string, p: Planet): Task {
  const done = p.status === 'done' || !!p.dropped;
  return {
    id: p.id,
    createdAt: p.createdAt ?? 0,
    updatedAt: p.updatedAt ?? p.createdAt ?? 0,
    projectId: p.system,
    title: p.title,
    notes: p.notes ?? '',
    status: done ? 'done' : 'todo',
    priority: PRIORITIES.includes(p.priority as Priority) ? (p.priority as Priority) : 2,
    due: isValidDateKey(p.due) ? p.due : null,
    estimateMin: null,
    energy: 'medium',
    progress: done ? 100 : 0,
    subtasks: [],
    dependsOn: [],
    links: [],
    completedAt: done ? (p.completedAt ?? p.updatedAt ?? null) : null,
    parkedAt: null,
    host: taskRef(verse, p),
  };
}

export interface AdaptOptions {
  /** Where ORBIT's own galaxies sit: the host's are auto-placed around them. */
  taken?: Pt[];
  /** ORBIT's own systems use deep space, so it needs a place even when no host system lives there. */
  deepUsed?: boolean;
  /** Where ORBIT's own systems in deep space sit: the host's are auto-placed around them. */
  deepTaken?: Pt[];
  /**
   * Where galaxies already sit on screen (another verse's): a galaxy with no placement of its own takes the same
   * place in every verse, so switching verse keeps it where it was.
   */
  centres?: Map<string, Pt>;
}

export function adaptVerse(v: Verse, placements: Placement[], opts: AdaptOptions = {}): AdaptedVerse {
  const verse = v.verse;
  const placed = new Map(placements.map((p) => [p.id, p]));
  const galaxies = v.galaxies ?? [];
  const systems = v.systems ?? [];
  const galaxyIds = new Set(galaxies.map((g) => g.id));
  const holderOf = (s: System) => (s.galaxy && galaxyIds.has(s.galaxy) ? s.galaxy : DEEP_SPACE);
  const deepUsed = !!opts.deepUsed || systems.some((s) => holderOf(s) === DEEP_SPACE);

  /* galaxy centres: placed ones first, then free spiral slots in verse order */
  const centres = new Map<string, Pt>();
  const taken: Pt[] = [...(opts.taken ?? [])];
  for (const g of galaxies) {
    const p = placed.get(placementKey.galaxy(g.id));
    if (p) {
      centres.set(g.id, round(p));
      taken.push(round(p));
    }
  }
  const deepPlaced = deepUsed ? placed.get(placementKey.galaxy(DEEP_SPACE)) : undefined;
  if (deepPlaced) taken.push(round(deepPlaced));
  for (const g of galaxies) {
    const known = opts.centres?.get(g.id);
    if (centres.has(g.id) || !known) continue;
    centres.set(g.id, round(known));
    taken.push(round(known));
  }
  for (const g of galaxies) {
    if (centres.has(g.id)) continue;
    const spot = nextGalaxySpot(taken);
    centres.set(g.id, spot);
    taken.push(spot);
  }
  const deepSpace = deepUsed ? (deepPlaced ? round(deepPlaced) : nextGalaxySpot(taken)) : null;

  /* system positions inside each galaxy (or deep space) */
  const rel = new Map<string, Pt>();
  const byHolder = new Map<string, System[]>();
  for (const s of systems) {
    const h = holderOf(s);
    if (!byHolder.has(h)) byHolder.set(h, []);
    byHolder.get(h)!.push(s);
  }
  for (const [holder, members] of byHolder) {
    const inUse: Pt[] = holder === DEEP_SPACE ? [...(opts.deepTaken ?? [])] : [];
    for (const s of members) {
      const p = placed.get(placementKey.system(verse, s.id));
      if (p) {
        rel.set(s.id, round(p));
        inUse.push(round(p));
      }
    }
    for (const s of members) {
      if (rel.has(s.id)) continue;
      const spot = findFreeSpot(0, 0, inUse, SYSTEM_SPACING);
      rel.set(s.id, spot);
      inUse.push(spot);
    }
  }

  const groups: Group[] = galaxies.map((g, i) => ({
    id: g.id,
    // verse order stands in for age, so "tidy into a spiral" keeps the host's order
    createdAt: i + 1,
    updatedAt: 0,
    name: g.name,
    color: colorFor(g.id, g.color),
    ...centres.get(g.id)!,
    host: galaxyRef(verse, g),
  }));

  const systemIds = new Set(systems.map((s) => s.id));
  const projects: Project[] = systems.map((s, i) => ({
    id: s.id,
    createdAt: i + 1,
    updatedAt: 0,
    name: s.name,
    // a portal is violet unless the host says otherwise
    color: colorFor(s.id, s.color ?? (s.portal ? 'violet' : undefined)),
    icon: 'orbit',
    description: s.note ?? '',
    groupId: holderOf(s) === DEEP_SPACE ? null : s.galaxy,
    ...rel.get(s.id)!,
    archived: false,
    host: systemRef(verse, s),
  }));

  const tasks: Task[] = [];
  const attachments: Record<string, MoonSet> = {};
  const items: Record<string, ItemPlanet[]> = {};
  const planets = v.planets ?? [];
  const largest = Math.max(0, ...planets.filter((p) => p.type === 'item' && typeof p.size === 'number' && Number.isFinite(p.size)).map((p) => p.size!));
  const planetIds = new Set<string>();
  let skipped = 0;
  for (const p of planets) {
    if (!systemIds.has(p.system) || (p.type !== 'task' && p.type !== 'item')) {
      skipped++;
      continue;
    }
    planetIds.add(p.id);
    if (p.type === 'item') {
      // a record shown as a planet: kept apart from tasks, so nothing that works on tasks ever sees it
      (items[p.system] ??= []).push(planetToItem(verse, p, largest));
      continue;
    }
    tasks.push(planetToTask(verse, p));
    if (p.attachments?.length || p.more) attachments[p.id] = { items: p.attachments ?? [], more: p.more ?? 0 };
  }
  const arrows = (v.arrows ?? []).filter((a) => a && planetIds.has(a.from) && planetIds.has(a.to) && a.from !== a.to);

  const collections: Record<string, Collection> = {};
  for (const c of v.collections ?? []) if (systemIds.has(c.system)) collections[c.system] = c;

  const beacons = (v.beacons ?? []).filter((b) => (b.system ? systemIds.has(b.system) : !!b.galaxy && galaxyIds.has(b.galaxy)));

  return {
    verseId: verse,
    rev: v.rev,
    groups,
    projects,
    tasks,
    deepSpace,
    extras: { families: v.families ?? {}, attachments, collections, beacons, clusters: v.clusters ?? [], items, arrows },
    skipped,
  };
}
