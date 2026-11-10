/**
 * The demo host's other arrangements of the same invented records (a garden, a house move, a workshop, a bakery and
 * a market stall), on the SAME galaxies as its task verse ("main"):
 *   - `map`    "Map" / Overview: each galaxy's contents by kind — its plans as planets (size: open tasks, ring: share
 *              done) — with portal systems into the other two;
 *   - `things` "Things" / Tools & materials: families as systems, items with sizes, rings and moons, "made from"
 *              arrows, a ghost item shown outside its home galaxy, and a system with more than forty items;
 *   - `notes`  "Notes" / Writing: notebooks as systems, notes with moons (some changed since), dates, and a verse
 *              action ("New notebook…") the demo host answers.
 * Every record carries `also` lists both ways: a task and the thing it uses, a plan and its system, a note and what it
 * refers to, and each galaxy and the same galaxy in every other verse.
 */
import { addDays, toDateKey } from '../lib/util';
import type { Also, Attachment, Beacon, Family, Galaxy, Planet, System, Verse, VerseInfo } from './types';

export const VERSE_INFO: VerseInfo[] = [
  { id: 'map', name: 'Map', plain: 'Overview', legend: 'Each galaxy by kind · size: open tasks · ring: share done · violet swirls lead to the other views', editable: false },
  {
    id: 'things',
    name: 'Things',
    plain: 'Tools & materials',
    legend: 'Colour: kind of thing · size: how often it is used · ring: share in good order · moons: its papers · arrows: made from',
    editable: false,
  },
  {
    id: 'notes',
    name: 'Notes',
    plain: 'Writing',
    legend: 'Size: length · ring: share read through · moons: what a note refers to · red moon: changed since it was written',
    editable: false,
    actions: [{ id: 'new-notebook', label: 'New notebook…' }],
  },
];

/** Galaxies every verse has, with the words of each verse for them. */
const GALAXIES: { id: string; name: string; color: string; cluster: string }[] = [
  { id: 'g-garden', name: 'Garden', color: 'lime', cluster: 'c-home' },
  { id: 'g-move', name: 'House move', color: 'sky', cluster: 'c-home' },
  { id: 'g-workshop', name: 'Workshop', color: 'amber', cluster: 'c-home' },
  { id: 'g-bakery', name: 'Bakery', color: 'coral', cluster: 'c-trade' },
  { id: 'g-market', name: 'Saturday market stall', color: 'violet', cluster: 'c-trade' },
];
const CLUSTERS = [
  { id: 'c-home', name: 'Around the house' },
  { id: 'c-trade', name: 'Trade and markets' },
];
const VERSE_WORD: Record<string, string> = { main: 'its tasks', map: 'on the map', things: 'its tools & materials', notes: 'its notes' };

/** The same galaxy in every other verse. */
export function galaxyAlso(galaxy: string, here: string): Also[] {
  return ['main', 'map', 'things', 'notes'].filter((v) => v !== here).map((verse) => ({ verse, galaxy, note: VERSE_WORD[verse] }));
}

const THING_FAMILIES: Record<string, Family> = {
  tool: { label: 'Tools', color: '#f5b544' },
  plant: { label: 'Plants', color: '#8cc94f' },
  supplier: { label: 'Suppliers', color: '#e46fae' },
  material: { label: 'Materials', color: '#d9b38c' },
  made: { label: 'Made here', color: '#5ad1c8' },
  doc: { label: 'Documents', color: '#4fa3f0' },
  photo: { label: 'Photos', color: '#c9a574' },
};

const item = (id: string, system: string, title: string, family: string, extra: Partial<Planet> = {}): Planet => ({
  id,
  system,
  type: 'item',
  title,
  kind: family,
  family,
  state: 'live',
  open: { kind: family, id },
  ...extra,
});
const paper = (id: string, family: 'doc' | 'photo', label: string, extra: Partial<Attachment> = {}): Attachment => ({ id, kind: family, family, label, state: 'live', open: { kind: family, id }, ...extra });

/* ---------------- Things ---------------- */

/** Where each thing lives in the things verse (for wormholes from the task verse and from notes). */
export const THING_HOME: Record<string, { galaxy: string; system: string }> = {};

function thingsVerse(): Verse {
  const systems: System[] = [];
  const planets: Planet[] = [];
  const sys = (id: string, galaxy: string, name: string, family: string, extra: Partial<System> = {}) => {
    systems.push({ id, galaxy, name, color: undefined, code: THING_FAMILIES[family]?.label, ...extra });
  };
  const put = (p: Planet) => {
    planets.push(p);
    const s = systems.find((x) => x.id === p.system)!;
    if (!p.ghost) THING_HOME[p.id] = { galaxy: s.galaxy!, system: s.id };
  };

  // Workshop
  sys('th-ws-tools', 'g-workshop', 'Workshop tools', 'tool', { color: 'amber' });
  sys('th-ws-materials', 'g-workshop', 'Timber and boards', 'material', { color: 'sand' });
  sys('th-ws-made', 'g-workshop', 'Made in the workshop', 'made', { color: 'teal' });
  sys('th-ws-fixings', 'g-workshop', 'Screws and fixings', 'material', { color: 'rose', note: 'Every size of screw, nail and plug in the drawers.', count: 52 });
  put(item('i-saw', 'th-ws-tools', 'Mitre saw', 'tool', { sub: 'Shed, top shelf', size: 9, ring: 0.9, facts: [{ label: 'Bought', value: '2021' }, { label: 'Blade', value: '254 mm, 60 teeth' }], attachments: [paper('d-saw-manual', 'doc', 'Manual'), paper('d-saw-photo', 'photo', 'New blade fitted')] }));
  put(item('i-drill', 'th-ws-tools', 'Cordless drill', 'tool', { sub: 'Two batteries', size: 16, ring: 0.7, facts: [{ label: 'Battery', value: '18 V' }], attachments: [paper('d-drill-warranty', 'doc', 'Warranty card'), paper('d-drill-bits', 'photo', 'Bit set layout')] }));
  put(item('i-level', 'th-ws-tools', 'Spirit level', 'tool', { sub: 'Lent out', state: 'gone', size: 3, note: 'Lent to next door in March; not back yet.' }));
  put(item('i-sander', 'th-ws-tools', 'Orbital sander', 'tool', { size: 7, ring: 0.5, attachments: [paper('d-sander-pads', 'doc', 'Pad sizes')] }));
  put(item('i-ladder', 'th-ws-tools', 'Step ladder', 'tool', { size: 5, ring: 1 }));
  put(item('i-planer', 'th-ws-tools', 'Hand planer', 'tool', { size: 1, state: 'archived', note: 'Kept for parts.' }));
  put(item('i-larch', 'th-ws-materials', 'Larch boards', 'material', { sub: '30 cm, untreated', size: 4, ring: 0.4, facts: [{ label: 'Left', value: '6 boards' }] }));
  put(item('i-ply', 'th-ws-materials', 'Birch plywood', 'material', { sub: '18 mm', size: 2, ring: 0.8 }));
  put(item('i-oakfloor', 'th-ws-materials', 'Oak-effect flooring', 'material', { size: 3, ring: 0.2 }));
  put(item('i-brackets', 'th-ws-materials', 'Shelf brackets', 'material', { size: 2, ring: 1 }));
  put(item('i-shelf', 'th-ws-made', 'Bookshelf', 'made', { sub: 'Spare room', size: 6, ring: 1, attachments: [paper('d-shelf-drawing', 'doc', 'Drawing, v2'), paper('d-shelf-photo', 'photo', 'Finished, side view')] }));
  put(item('i-bench', 'th-ws-made', 'Potting bench', 'made', { sub: 'For the greenhouse', size: 4, ring: 0.6 }));
  const fixings = ['Wood screws', 'Machine screws', 'Wall plugs', 'Panel pins', 'Coach bolts', 'Washers', 'Hinges', 'Picture hooks', 'Cable clips', 'Nails'];
  for (let i = 0; i < 46; i++) {
    const kind = fixings[i % fixings.length];
    const size = `${3 + (i % 5)}×${20 + ((i * 7) % 60)}`;
    put(item(`i-fix-${i + 1}`, 'th-ws-fixings', `${kind} ${size}`, 'material', { sub: `Drawer ${1 + (i % 12)}`, size: 1 + (i % 4), ring: ((i * 37) % 100) / 100 }));
  }

  // Garden
  sys('th-gd-tools', 'g-garden', 'Garden tools', 'tool', { color: 'amber' });
  sys('th-gd-plants', 'g-garden', 'Plants', 'plant', { color: 'lime' });
  sys('th-gd-materials', 'g-garden', 'Soil and compost', 'material', { color: 'sand' });
  sys('th-gd-made', 'g-garden', 'Built in the garden', 'made', { color: 'teal' });
  put(item('i-trays', 'th-gd-tools', 'Seed trays', 'tool', { size: 12, ring: 0.75 }));
  put(item('i-kit', 'th-gd-tools', 'Soil test kit', 'tool', { size: 2, ring: 0.3, sub: 'Two tests left' }));
  put(item('i-canes', 'th-gd-tools', 'Bamboo canes', 'tool', { size: 6, ring: 0.9 }));
  // a ghost: the drill lives in the workshop, and is shown here because the garden borrows it
  planets.push(
    item('i-drill@garden', 'th-gd-tools', 'Cordless drill', 'tool', {
      ghost: true,
      size: 16,
      sub: 'Lives in the workshop',
      also: [{ verse: 'things', galaxy: 'g-workshop', system: 'th-ws-tools', object: 'i-drill', note: 'its home: Workshop tools' }],
    }),
  );
  put(item('i-tomato', 'th-gd-plants', 'Tomato ‘Gardener’s Delight’', 'plant', { size: 10, ring: 0.6, attachments: [paper('d-tom-photo', 'photo', 'Seedlings, week 3')] }));
  put(item('i-basil', 'th-gd-plants', 'Basil', 'plant', { size: 5, ring: 0.9 }));
  put(item('i-chilli', 'th-gd-plants', 'Chilli ‘Apache’', 'plant', { size: 2, state: 'archived', note: 'Did not come through the winter.' }));
  put(item('i-potato', 'th-gd-plants', 'Seed potatoes', 'plant', { size: 8, ring: 0.1 }));
  put(item('i-clippings', 'th-gd-materials', 'Grass clippings', 'material', { size: 9, ring: 0.5 }));
  put(item('i-compost', 'th-gd-materials', 'Compost', 'material', { size: 11, ring: 0.4, sub: 'Bay two' }));
  put(item('i-gd-larch', 'th-gd-materials', 'Larch offcuts', 'material', { size: 3, ring: 0.6 }));
  put(item('i-bed', 'th-gd-made', 'Raised bed frame', 'made', { size: 7, ring: 0.3, sub: 'Half built', attachments: [paper('d-bed-sketch', 'doc', 'Bed layout sketch', { flag: 'changed' })] }));

  // House move
  sys('th-mv-supplies', 'g-move', 'Packing supplies', 'material', { color: 'indigo' });
  sys('th-mv-suppliers', 'g-move', 'Suppliers', 'supplier', { color: 'rose' });
  put(item('i-boxes', 'th-mv-supplies', 'Removal boxes', 'material', { size: 30, ring: 0.4, sub: '40 flat, 12 made up' }));
  put(item('i-tape', 'th-mv-supplies', 'Parcel tape', 'material', { size: 6, ring: 0.5 }));
  put(item('i-wrap', 'th-mv-supplies', 'Bubble wrap', 'material', { size: 4, ring: 0.2 }));
  put(item('i-van', 'th-mv-suppliers', 'Van hire', 'supplier', { size: 3, sub: 'Quote 88', attachments: [paper('d-van-quote', 'doc', 'Quote 88')] }));
  put(item('i-boxshop', 'th-mv-suppliers', 'Box supplier', 'supplier', { size: 2 }));
  put(item('i-timber', 'th-mv-suppliers', 'Timber yard', 'supplier', { size: 2, sub: 'Order 2231' }));

  // Bakery
  sys('th-bk-equipment', 'g-bakery', 'Bakery equipment', 'tool', { color: 'coral' });
  sys('th-bk-pantry', 'g-bakery', 'Pantry', 'material', { color: 'sand' });
  put(item('i-oven', 'th-bk-equipment', 'Deck oven', 'tool', { size: 40, ring: 0.85, facts: [{ label: 'Decks', value: '3' }, { label: 'Serviced', value: 'June' }], attachments: [paper('d-oven-service', 'doc', 'Service sheet', { flag: 'changed' }), paper('d-oven-manual', 'doc', 'Manual')] }));
  put(item('i-prover', 'th-bk-equipment', 'Proving cabinet', 'tool', { size: 22, ring: 0.6 }));
  put(item('i-mixer', 'th-bk-equipment', 'Spiral mixer', 'tool', { size: 28, ring: 0.95 }));
  put(item('i-flour', 'th-bk-pantry', 'Strong white flour', 'material', { size: 35, ring: 0.3, sub: '6 sacks' }));
  put(item('i-rye', 'th-bk-pantry', 'Dark rye flour', 'material', { size: 12, ring: 0.5 }));
  put(item('i-salt', 'th-bk-pantry', 'Sea salt', 'material', { size: 8, ring: 0.7 }));
  put(item('i-starter', 'th-bk-pantry', 'Sourdough starter', 'material', { size: 14, ring: 1, sub: 'Fed daily' }));

  // Market stall
  sys('th-mk-kit', 'g-market', 'Stall kit', 'tool', { color: 'violet' });
  put(item('i-gazebo', 'th-mk-kit', 'Gazebo', 'tool', { size: 4, ring: 0.5, note: 'One side panel torn.', attachments: [paper('d-gazebo-photo', 'photo', 'Torn panel')] }));
  put(item('i-board', 'th-mk-kit', 'Price board', 'tool', { size: 3, ring: 0.3 }));
  put(item('i-tin', 'th-mk-kit', 'Cash tin', 'tool', { size: 4, ring: 1 }));

  const arrows = [
    { from: 'i-shelf', to: 'i-ply', label: 'made from' },
    { from: 'i-shelf', to: 'i-brackets', label: 'made from' },
    { from: 'i-bench', to: 'i-larch', label: 'made from' },
    { from: 'i-bed', to: 'i-gd-larch', label: 'made from' },
    { from: 'i-compost', to: 'i-clippings', label: 'made from' },
    { from: 'i-starter', to: 'i-rye', label: 'made from' },
  ];

  return {
    verse: 'things',
    rev: '1',
    families: THING_FAMILIES,
    clusters: CLUSTERS,
    galaxies: GALAXIES.map((g) => ({ ...g, chip: 'Tools & materials', also: galaxyAlso(g.id, 'things') })),
    systems,
    planets,
    arrows,
    collections: [],
    beacons: [],
  };
}

/* ---------------- Notes ---------------- */

const NOTE_FAMILIES: Record<string, Family> = {
  note: { label: 'Notes', color: '#b9a8ff' },
  tool: { label: 'Tools', color: '#f5b544' },
  plant: { label: 'Plants', color: '#8cc94f' },
  supplier: { label: 'Suppliers', color: '#e46fae' },
  material: { label: 'Materials', color: '#d9b38c' },
  made: { label: 'Made here', color: '#5ad1c8' },
  doc: { label: 'Documents', color: '#4fa3f0' },
  photo: { label: 'Photos', color: '#c9a574' },
};

function notesVerse(now: number): Verse {
  const day = (n: number) => addDays(toDateKey(now), n);
  /** A moon of a note that is a thing: with a wormhole to it. */
  const thing = (id: string, family: string, label: string, extra: Partial<Attachment> = {}): Attachment => {
    const home = THING_HOME[id];
    return { id: `n-${id}`, kind: family, family, label, state: 'live', ...(home ? { also: [{ verse: 'things', ...home, object: id, note: 'in Things' }] } : {}), ...extra };
  };
  const note = (id: string, system: string, title: string, extra: Partial<Planet> = {}) => item(id, system, title, 'note', extra);
  const systems: System[] = [
    { id: 'nt-gd-diary', galaxy: 'g-garden', name: 'Garden diary', color: 'lime', actions: [{ id: 'new-note', label: 'New note…' }], open: { kind: 'notebook', id: 'nt-gd-diary' } },
    { id: 'nt-mv-book', galaxy: 'g-move', name: 'Move notebook', color: 'sky', actions: [{ id: 'new-note', label: 'New note…' }] },
    { id: 'nt-ws-log', galaxy: 'g-workshop', name: 'Workshop log', color: 'amber', actions: [{ id: 'new-note', label: 'New note…' }] },
    { id: 'nt-bk-recipes', galaxy: 'g-bakery', name: 'Recipe notes', color: 'coral', actions: [{ id: 'new-note', label: 'New note…' }] },
    { id: 'nt-mk-stall', galaxy: 'g-market', name: 'Stall notes', color: 'violet' },
  ];
  const planets: Planet[] = [
    note('n-soil', 'nt-gd-diary', 'Soil test notes', {
      size: 3,
      ring: 0.5,
      notes: 'pH 6.4 in bed two; the others to follow.',
      attachments: [thing('i-kit', 'tool', 'Soil test kit'), paper('n-site-photo', 'photo', 'Site photo, March', { flag: 'changed' })],
      also: [{ verse: 'main', galaxy: 'g-garden', system: 's-beds', object: 't-soil', note: 'the task it is for' }],
    }),
    note('n-plan', 'nt-gd-diary', 'Planting plan 2026', {
      size: 9,
      ring: 0.8,
      attachments: [paper('n-bed-sketch', 'doc', 'Bed layout sketch', { flag: 'changed' }), thing('i-tomato', 'plant', 'Tomato ‘Gardener’s Delight’'), thing('i-potato', 'plant', 'Seed potatoes')],
      also: [{ verse: 'main', galaxy: 'g-garden', system: 's-beds', note: 'the plan it is for' }],
    }),
    note('n-pond', 'nt-gd-diary', 'Pond liner ideas', { size: 2, ring: 0.1 }),
    note('n-frost', 'nt-gd-diary', 'Frost dates, last five years', { size: 1, ring: 1, state: 'archived' }),
    note('n-checklist', 'nt-mv-book', 'Moving day checklist', {
      size: 7,
      ring: 0.4,
      attachments: [thing('i-van', 'supplier', 'Van hire', { flag: 'changed' }), paper('n-dates', 'doc', 'Moving dates'), thing('i-boxes', 'material', 'Removal boxes')],
      also: [{ verse: 'main', galaxy: 'g-move', system: 's-packing', object: 't-van', note: 'Book the van' }],
    }),
    note('n-meters', 'nt-mv-book', 'Meter readings', { size: 1, ring: 0 }),
    note('n-refit', 'nt-ws-log', 'Spare room refit diary', {
      size: 12,
      ring: 0.3,
      attachments: [thing('i-sander', 'tool', 'Orbital sander'), thing('i-oakfloor', 'material', 'Oak-effect flooring', { flag: 'changed' })],
      also: [{ verse: 'main', galaxy: 'g-workshop', system: 's-refit', note: 'the refit’s tasks' }],
    }),
    note('n-shelf', 'nt-ws-log', 'Bookshelf build notes', { size: 4, ring: 1, attachments: [thing('i-shelf', 'made', 'Bookshelf')] }),
    note('n-sourdough', 'nt-bk-recipes', 'Sourdough timings', { size: 6, ring: 0.9, attachments: [thing('i-starter', 'material', 'Sourdough starter'), thing('i-oven', 'tool', 'Deck oven', { flag: 'changed' })] }),
    note('n-rye', 'nt-bk-recipes', 'Rye ratios', { size: 3, ring: 0.6 }),
    note('n-pitch', 'nt-mk-stall', 'Pitch layout', { size: 2, ring: 0.5, attachments: [thing('i-gazebo', 'tool', 'Gazebo')] }),
  ];
  const beacons: Beacon[] = [
    { id: 'n-b-review', system: 'nt-gd-diary', title: 'Diary review', due: day(3), state: 'soon' },
    { id: 'n-b-move', galaxy: 'g-move', code: 'M1', title: 'Moving day', due: day(14), state: 'planned' },
    { id: 'n-b-recipes', system: 'nt-bk-recipes', title: 'Autumn menu', due: day(-2), state: 'late' },
  ];
  return {
    verse: 'notes',
    rev: '1',
    families: NOTE_FAMILIES,
    clusters: CLUSTERS,
    galaxies: GALAXIES.map((g) => ({ ...g, chip: 'Notebooks', also: galaxyAlso(g.id, 'notes') })),
    systems,
    planets,
    beacons,
  };
}

/* ---------------- Map ---------------- */

function mapVerse(main: Verse): Verse {
  const systems: System[] = [];
  const planets: Planet[] = [];
  for (const g of GALAXIES) {
    const plans = `map-${g.id}-plans`;
    systems.push({ id: plans, galaxy: g.id, name: 'Plans', color: g.color, note: `What ${g.name} is working on, one planet per plan.` });
    systems.push({ id: `map-${g.id}-things`, galaxy: g.id, name: 'Tools & materials', portal: { verse: 'things' }, also: [{ verse: 'things', galaxy: g.id, note: VERSE_WORD.things }] });
    systems.push({ id: `map-${g.id}-notes`, galaxy: g.id, name: 'Notes', portal: { verse: 'notes', label: 'Read the notes' }, also: [{ verse: 'notes', galaxy: g.id, note: VERSE_WORD.notes }] });
    for (const s of main.systems.filter((x) => x.galaxy === g.id)) {
      const tasks = main.planets.filter((p) => p.type === 'task' && p.system === s.id);
      const done = tasks.filter((p) => p.status === 'done').length;
      const open = tasks.length - done;
      planets.push({
        id: `mp-${s.id}`,
        system: plans,
        type: 'item',
        title: s.name,
        sub: [s.code, `${open} open`].filter(Boolean).join(' · '),
        kind: 'plan',
        family: 'plan',
        state: 'live',
        size: Math.max(open, 0),
        ring: tasks.length ? done / tasks.length : 0,
        facts: [
          { label: 'Open tasks', value: String(open) },
          { label: 'Done', value: String(done) },
        ],
        also: [{ verse: 'main', galaxy: g.id, system: s.id, note: `${open} open task${open === 1 ? '' : 's'}` }],
      });
    }
  }
  return {
    verse: 'map',
    rev: '1',
    families: { plan: { label: 'Plans', color: '#a99bff' } },
    clusters: CLUSTERS,
    galaxies: GALAXIES.map((g): Galaxy => ({ ...g, chip: 'Overview', also: galaxyAlso(g.id, 'map'), actions: [{ id: 'galaxy-summary', label: 'Print a summary…' }] })),
    systems,
    planets,
  };
}

/* ---------------- links into the task verse ---------------- */

/** Which thing each of the task verse's attachments is (by attachment id). */
const ATTACHMENT_THING: Record<string, string> = {
  'a-saw': 'i-saw',
  'a-drill': 'i-drill',
  'a-lost': 'i-level',
  'a-kit': 'i-kit',
  'a-tray': 'i-trays',
  'a-tom': 'i-tomato',
  'a-van': 'i-van',
  'a-boxes': 'i-boxshop',
  'a-boards': 'i-timber',
};

/**
 * Adds wormholes both ways between the task verse and the others: a moon that is a thing, the task that uses it and
 * the thing ("3 tasks use it"); each system and its plan on the map; each galaxy and the same galaxy elsewhere.
 */
export function linkVerses(main: Verse, others: Verse[]): void {
  const things = others.find((v) => v.verse === 'things');
  const map = others.find((v) => v.verse === 'map');
  const users = new Map<string, Planet[]>();
  for (const p of main.planets) {
    if (p.type !== 'task') continue;
    for (const a of p.attachments ?? []) {
      const id = ATTACHMENT_THING[a.id] ?? (/^a-refit-\d+-a$/.test(a.id) ? 'i-sander' : undefined);
      const home = id && THING_HOME[id];
      if (!id || !home) continue;
      a.also = [{ verse: 'things', ...home, object: id, note: `${a.label} in Things` }];
      const mine = (p.also ??= []);
      if (!mine.some((x) => x.object === id)) mine.push({ verse: 'things', ...home, object: id, note: `uses ${a.label}` });
      users.set(id, [...(users.get(id) ?? []), p]);
    }
  }
  for (const [id, tasks] of users) {
    const t = things?.planets.find((p) => p.id === id);
    if (!t) continue;
    const first = tasks[0];
    const sys = main.systems.find((s) => s.id === first.system);
    t.also = [
      ...(t.also ?? []),
      { verse: 'main', galaxy: sys?.galaxy ?? undefined, system: first.system, object: first.id, note: tasks.length === 1 ? `“${first.title}” uses it` : `${tasks.length} tasks use it` },
    ];
  }
  for (const s of main.systems) {
    const plan = map?.planets.find((p) => p.id === `mp-${s.id}`);
    if (!plan || !s.galaxy) continue;
    s.also = [...(s.also ?? []), { verse: 'map', galaxy: s.galaxy, system: plan.system, object: plan.id, note: 'on the map' }];
  }
  for (const g of main.galaxies) if (GALAXIES.some((x) => x.id === g.id)) g.also = [...(g.also ?? []), ...galaxyAlso(g.id, 'main')];
}

/** The other verses, built against the task verse (and linked to it both ways). */
export function otherVerses(main: Verse, now = Date.now()): Verse[] {
  const things = thingsVerse();
  const notes = notesVerse(now);
  const map = mapVerse(main);
  const out = [map, things, notes];
  linkVerses(main, out);
  return out;
}

/** "New notebook…" in the notes verse, and "New note…" in a notebook: what the demo host's own dialog makes. */
export function demoAction(verses: Map<string, Verse>, id: string, ctx: Record<string, string>, seq: number): boolean {
  const notes = verses.get('notes');
  if (!notes) return false;
  if (id === 'new-notebook') {
    const galaxy = notes.galaxies.some((g) => g.id === ctx.galaxy) ? ctx.galaxy : 'g-garden';
    notes.systems.push({ id: `nt-new-${seq}`, galaxy, name: `Notebook ${seq}`, actions: [{ id: 'new-note', label: 'New note…' }] });
    return true;
  }
  if (id === 'new-note' && ctx.system && notes.systems.some((s) => s.id === ctx.system)) {
    notes.planets.push(item(`n-new-${seq}`, ctx.system, `Untitled note ${seq}`, 'note', { size: 1, ring: 0 }));
    return true;
  }
  return false;
}
