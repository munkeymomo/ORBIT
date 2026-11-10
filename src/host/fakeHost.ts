/**
 * A host that lives in memory, for ORBIT's own tests and for demos (`?orbit-host=demo`). Its records are
 * invented: a garden, a house move, a workshop and a small bakery. It covers every shape protocol 1 can send in
 * the read-only stage: a cluster of galaxies, a finished and a virtual galaxy, deep space, a virtual system, a
 * system with a note, tasks at every priority (overdue, done, dropped), moons in all three states and several
 * families (one planet with more than five, one with `more`), a small belt and a large one, beacons in all five
 * states on a galaxy rim and beside systems, and one busy system with more than forty open tasks.
 *
 * Every capability is false: ORBIT can look, move things around and open them in the host, nothing else.
 */
import { MemoryAdapter } from '../data/storage';
import { addDays, toDateKey } from '../lib/util';
import type { Attachment, Beacon, Collection, Galaxy, Handshake, OrbitHost, Planet, System, Unchanged, Verse } from './types';

export interface FakeHost extends OrbitHost {
  store: MemoryAdapter;
  /** Every target ORBIT asked the host to open. */
  opened: { kind: string; id: string }[];
  /** How often verse() was asked, and how often it answered "unchanged". */
  calls: { verse: number; unchanged: number };
  /** Changes the verse (and its rev), as the host would after an edit of its own. */
  change(fn: (v: Verse) => void): void;
}

export interface FakeHostOptions {
  now?: number;
  /** Offer a different protocol number (to test refusal). */
  protocol?: number;
  name?: string;
}

const FAMILIES = {
  tool: { label: 'Tools', color: '#f5b544' },
  doc: { label: 'Documents', color: '#4fa3f0' },
  plant: { label: 'Plants', color: '#8cc94f' },
  supplier: { label: 'Suppliers', color: '#e46fae' },
  photo: { label: 'Photos', color: '#c9a574' },
};

export function demoVerse(now = Date.now()): Verse {
  const today = toDateKey(now);
  const day = (n: number) => addDays(today, n);
  const open = (kind: string, id: string) => ({ kind, id });

  const att = (id: string, family: keyof typeof FAMILIES, label: string, extra: Partial<Attachment> = {}): Attachment => ({
    id,
    kind: family,
    family,
    label,
    state: 'live',
    open: open(family, id),
    ...extra,
  });

  const galaxies: Galaxy[] = [
    { id: 'g-garden', name: 'Garden', color: 'lime', chip: 'Outdoor · in season', status: 'in season', cluster: 'c-home', facts: [{ label: 'Plot', value: 'Back garden, 12 m' }], open: open('area', 'g-garden') },
    { id: 'g-move', name: 'House move', color: 'sky', chip: 'Move · booked', status: 'booked', cluster: 'c-home', open: open('area', 'g-move') },
    { id: 'g-workshop', name: 'Workshop', color: 'amber', chip: 'Indoor · slow', cluster: 'c-home', open: open('area', 'g-workshop') },
    { id: 'g-bakery', name: 'Bakery', color: 'coral', chip: 'Shop · open', status: 'open', facts: [{ label: 'Opens', value: 'Tue–Sat' }], open: open('area', 'g-bakery') },
    { id: 'g-flat', name: 'Old flat', color: 'sand', chip: 'Move · finished', status: 'finished', finished: true },
    { id: 'g-loose', name: 'Loose ends', virtual: true },
  ];

  const systems: System[] = [
    { id: 's-beds', galaxy: 'g-garden', name: 'Vegetable beds', code: 'GD-1', status: 'growing', note: 'Soil test results due back in two weeks.', color: 'lime', open: open('plan', 's-beds'), facts: [{ label: 'Beds', value: '4 raised' }] },
    { id: 's-greenhouse', galaxy: 'g-garden', name: 'Greenhouse', code: 'GD-2', color: 'mint', open: open('plan', 's-greenhouse') },
    { id: 's-pond', galaxy: 'g-garden', name: 'Pond', code: 'GD-3', color: 'sky' },
    { id: 's-packing', galaxy: 'g-move', name: 'Packing', code: 'HM-1', color: 'indigo', open: open('plan', 's-packing') },
    { id: 's-utilities', galaxy: 'g-move', name: 'Utilities', code: 'HM-2', color: 'violet' },
    { id: 's-shelves', galaxy: 'g-workshop', name: 'Shelves', code: 'WS-1', color: 'amber' },
    { id: 's-orders', galaxy: 'g-bakery', name: 'Orders', code: 'BK-1', status: 'busy', color: 'coral', open: open('plan', 's-orders'), count: 48 },
    { id: 's-recipes', galaxy: 'g-bakery', name: 'Recipes', code: 'BK-2', color: 'rose', open: open('plan', 's-recipes') },
    { id: 's-keys', galaxy: 'g-flat', name: 'Hand back keys', code: 'OF-1', color: 'sand' },
    { id: 's-nowhere', galaxy: 'g-loose', name: 'Filed nowhere', virtual: true, note: 'Tasks that belong to no plan yet.' },
    { id: 's-odd', galaxy: null, name: 'Odd jobs', color: 'teal' },
  ];

  const task = (id: string, system: string, title: string, extra: Partial<Planet> = {}): Planet => ({
    id,
    system,
    type: 'task',
    title,
    status: 'todo',
    priority: 2,
    due: null,
    createdAt: now - 86_400_000 * 10,
    updatedAt: now - 86_400_000,
    open: open('task', id),
    ...extra,
  });

  const planets: Planet[] = [
    task('t-raised-bed', 's-beds', 'Build the raised bed', {
      priority: 3,
      due: day(6),
      notes: 'Untreated larch boards, 30 cm deep.',
      attachments: [
        att('a-saw', 'tool', 'Mitre saw', { sub: 'Shed, top shelf' }),
        att('a-drill', 'tool', 'Cordless drill'),
        att('a-boards', 'supplier', 'Timber yard', { sub: 'Order 2231' }),
        att('a-plan', 'doc', 'Bed layout sketch', { flag: 'changed' }),
        att('a-old-plan', 'doc', 'Last year’s layout', { state: 'archived' }),
        att('a-photo', 'photo', 'Site photo, March'),
        att('a-lost', 'tool', 'Spirit level', { state: 'gone', sub: 'Lent out' }),
      ],
      more: 3,
    }),
    task('t-soil', 's-beds', 'Send soil off for testing', { priority: 4, due: day(-2), attachments: [att('a-kit', 'tool', 'Soil test kit')] }),
    task('t-compost', 's-beds', 'Turn the compost', { priority: 1 }),
    task('t-seeds', 's-beds', 'Order seed potatoes', { status: 'done', completedAt: now - 86_400_000 * 3 }),
    task('t-mulch', 's-beds', 'Mulch the paths', { dropped: true, status: 'todo', note: 'Not needed this year.' }),
    task('t-trays', 's-greenhouse', 'Sow tomato trays', { priority: 3, due: day(1), attachments: [att('a-tom', 'plant', 'Tomato ‘Gardener’s Delight’'), att('a-tray', 'tool', 'Seed trays')] }),
    task('t-vent', 's-greenhouse', 'Fix the roof vent', { priority: 2 }),
    task('t-liner', 's-pond', 'Patch the pond liner', { priority: 2, due: day(20) }),
    task('t-boxes', 's-packing', 'Pack the books', { priority: 2, due: day(3), attachments: [att('a-boxes', 'supplier', 'Box supplier')] }),
    task('t-van', 's-packing', 'Book the van', {
      priority: 4,
      due: day(-1),
      attachments: [att('a-van', 'supplier', 'Van hire', { sub: 'Quote 88' }), att('a-dates', 'doc', 'Moving dates')],
      more: 4,
    }),
    task('t-labels', 's-packing', 'Label every box by room', { priority: 1 }),
    task('t-meter', 's-utilities', 'Read the meters on the day', { priority: 3, due: day(12) }),
    task('t-broadband', 's-utilities', 'Move the broadband', { priority: 2, status: 'done', completedAt: now - 86_400_000 }),
    task('t-brackets', 's-shelves', 'Buy shelf brackets', { priority: 1 }),
    task('t-keys', 's-keys', 'Return the spare keys', { status: 'done', completedAt: now - 86_400_000 * 40 }),
    task('t-receipt', 's-nowhere', 'Find the boiler receipt', { priority: 2 }),
    task('t-bike', 's-odd', 'Pump up the bike tyres', { priority: 1 }),
    // an item planet: out of scope for this stage, and must be skipped safely
    { id: 'i-oven', system: 's-recipes', type: 'item', title: 'Deck oven', kind: 'equipment', family: 'tool', state: 'live' },
  ];
  for (let i = 1; i <= 46; i++)
    planets.push(task(`t-order-${i}`, 's-orders', `Order ${100 + i}: ${['sourdough', 'rye', 'seeded', 'focaccia', 'brioche'][i % 5]} loaves`, { priority: (1 + (i % 4)) as 1 | 2 | 3 | 4, due: day((i % 9) - 3) }));
  planets.push(task('t-order-done', 's-orders', 'Order 99: croissants', { status: 'done', completedAt: now - 86_400_000 }));

  const collections: Collection[] = [
    {
      system: 's-greenhouse',
      total: 6,
      items: [
        att('b-cane', 'tool', 'Bamboo canes'),
        att('b-twine', 'tool', 'Garden twine'),
        att('b-basil', 'plant', 'Basil'),
        att('b-chilli', 'plant', 'Chilli ‘Apache’', { state: 'archived' }),
        att('b-guide', 'doc', 'Watering guide'),
        att('b-heater', 'tool', 'Frost heater', { state: 'gone' }),
      ],
      open: open('holds', 's-greenhouse'),
    },
    { system: 's-recipes', total: 140, counts: { doc: 92, photo: 48 }, open: open('holds', 's-recipes') },
  ];

  const beacons: Beacon[] = [
    { id: 'm-planting', galaxy: 'g-garden', code: 'M1', title: 'Spring planting', due: day(40), state: 'planned', serves: 4 },
    { id: 'm-seedlings', galaxy: 'g-garden', code: 'M2', title: 'Seedlings out', due: day(5), state: 'soon', serves: 2 },
    { id: 'm-frost', galaxy: 'g-garden', code: 'M3', title: 'Frost check', due: day(-3), state: 'late', serves: 1 },
    { id: 'm-dug', galaxy: 'g-garden', code: 'M4', title: 'Beds dug', due: day(-20), state: 'achieved' },
    { id: 'm-liner', galaxy: 'g-garden', code: 'M5', title: 'New pond liner', due: day(60), state: 'rescoped' },
    { id: 'm-van', system: 's-packing', code: 'D1', title: 'Van booked', due: day(2), state: 'soon', serves: 3, open: open('date', 'm-van') },
    { id: 'm-keys', system: 's-packing', code: 'D2', title: 'Keys handed over', due: day(30), state: 'planned' },
    { id: 'm-market', system: 's-orders', code: 'D3', title: 'Weekend market', due: day(-1), state: 'late', serves: 12 },
    { id: 'm-move', galaxy: 'g-move', code: 'M1', title: 'Moving day', due: day(14), state: 'planned', serves: 9 },
  ];

  return {
    verse: 'main',
    rev: '1',
    families: FAMILIES,
    clusters: [{ id: 'c-home', name: 'Around the house', open: open('group', 'c-home') }],
    galaxies,
    systems,
    planets,
    collections,
    beacons,
  };
}

export function createFakeHost(opts: FakeHostOptions = {}): FakeHost {
  let current = demoVerse(opts.now);
  let rev = 1;
  const name = opts.name ?? 'Demo host';
  const protocol = opts.protocol ?? 1;
  const info: Handshake = {
    protocol,
    host: { name, version: '1.0' },
    caps: { write: false, personal: false, work: false },
    verses: [{ id: 'main', name: 'Everything', plain: 'tasks', legend: 'Size: open work · ring: share done · moons: what a task uses', editable: false }],
    start: 'main',
    labels: { stored: `Kept by ${name}` },
  };
  const host: FakeHost = {
    protocol,
    store: new MemoryAdapter(),
    opened: [],
    calls: { verse: 0, unchanged: 0 },
    async handshake() {
      return structuredClone(info);
    },
    async verse(id: string, since?: string): Promise<Verse | Unchanged> {
      host.calls.verse++;
      if (id !== current.verse) throw new Error(`No verse called “${id}”.`);
      if (since && since === current.rev) {
        host.calls.unchanged++;
        return { verse: current.verse, rev: current.rev, unchanged: true };
      }
      return structuredClone(current);
    },
    open(target) {
      host.opened.push({ kind: target.kind, id: target.id });
    },
    change(fn) {
      fn(current);
      current = { ...current, rev: String(++rev) };
    },
  };
  return host;
}
