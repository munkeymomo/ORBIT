/**
 * A host that lives in memory, for ORBIT's own tests and for demos. Its records are invented: a garden, a house
 * move, a workshop and a small bakery. It covers every shape protocol 1 can send: a cluster of galaxies, a
 * finished and a virtual galaxy, deep space, a virtual system, a system with a note, tasks at every priority
 * (overdue, done, dropped), moons in all three states and several families (one planet with more than five,
 * one with `more`), a small belt and a large one, beacons in all five states on a galaxy rim and beside
 * systems, and one busy system with more than forty open tasks.
 *
 * Read-only by default (every capability false): ORBIT can look, move things around and open them in the host.
 * With `editable` (the demo at `?orbit-host=demo`) it offers `write`, `work` and `pick`, per-record caps, and a
 * working `tasks` API, with switches to refuse changes (`refuseNext`, `refuseAlways`, `setLocked`). One task,
 * "Fix the roof vent", always refuses changes to its fields; "Return the spare keys" may not be changed at all.
 * With `personal` as well it keeps ORBIT's own records (caps.personal) and takes ORBIT's systems (`adopt`).
 *
 * Besides its task verse ("main", "Everything") it offers three more arrangements of the same galaxies (`map`,
 * `things`, `notes`, see demoVerses.ts) and answers their actions through `action()`; `verses: 'one'` offers only
 * the task verse.
 */
import { MemoryAdapter } from '../data/storage';
import { addDays, toDateKey } from '../lib/util';
import type { AdoptBatch, AdoptResult, StartAt, Attachment, Beacon, Caps, Collection, Galaxy, Handshake, HostTasks, OrbitHost, Planet, System, Unchanged, Verse } from './types';
import { demoAction, otherVerses, VERSE_INFO } from './demoVerses';

export interface FakeHost extends OrbitHost {
  store: MemoryAdapter;
  /** Every target ORBIT asked the host to open. */
  opened: { kind: string; id: string }[];
  /** How often verse() and handshake() were asked, and how often verse() answered "unchanged". */
  calls: { verse: number; unchanged: number; handshake: number };
  /** Every call ORBIT made to `tasks`, `pick` and `action`, in order (editable only). */
  log: { op: string; args: unknown[] }[];
  /** Changes the verse (and its rev), as the host would after an edit of its own. */
  change(fn: (v: Verse) => void): void;
  /** Changes another verse (and its rev). */
  changeVerse(id: string, fn: (v: Verse) => void): void;
  /** The verse as the host has it now. */
  current(): Verse;
  /** Any verse as the host has it now. */
  verseNow(id: string): Verse | undefined;
  /** The next change ORBIT asks for is refused with this reason. */
  refuseNext(reason: string): void;
  /** Every change to this task is refused with this reason (undefined: stop refusing). */
  refuseAlways(taskId: string, reason?: string): void;
  /** While set, the handshake says `locked` and every change is refused with this text. */
  setLocked(text?: string): void;
  /** Answers to tasks calls wait this long (ms), so a test or a demo can see a change waiting. */
  delay: number;
  /** What the host's own "take these tasks" dialog does when ORBIT calls adopt() (with `personal`). */
  adoptMode: AdoptMode;
}

/** all: takes every task · some: all but the last · cancel: the person cancels · fail: the host throws. */
export type AdoptMode = 'all' | 'some' | 'cancel' | 'fail';

export interface FakeHostOptions {
  now?: number;
  /** Offer a different protocol number (to test refusal). */
  protocol?: number;
  name?: string;
  /** Offer write, work and pick, with per-record caps and a working tasks API. */
  editable?: boolean;
  /** Keep the verse and the store here between page loads (the demo uses sessionStorage). */
  storage?: Storage | null;
  /** Refuse the first change with this reason. */
  refuse?: string;
  /** Start locked with this text. */
  locked?: string;
  /** Editable only: also keep ORBIT's own galaxies, systems and tasks (caps.personal) and offer adopt(). */
  personal?: boolean;
  /** What adopt() does (default 'all'). */
  adopt?: AdoptMode;
  /** `host.at`: where ORBIT goes first. */
  at?: StartAt;
  /** 'one': only the task verse (as before this stage). Default: the task verse and three more (map, things, notes). */
  verses?: 'one' | 'all';
  /** The verse to open first (handshake `start`). */
  start?: string;
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
    link: `l-${id}`,
    open: open(family, id),
    ...extra,
  });

  const galaxies: Galaxy[] = [
    { id: 'g-garden', name: 'Garden', color: 'lime', chip: 'Outdoor · in season', status: 'in season', cluster: 'c-home', facts: [{ label: 'Plot', value: 'Back garden, 12 m' }], open: open('area', 'g-garden') },
    { id: 'g-move', name: 'House move', color: 'sky', chip: 'Move · booked', status: 'booked', cluster: 'c-home', open: open('area', 'g-move') },
    { id: 'g-workshop', name: 'Workshop', color: 'amber', chip: 'Indoor · slow', cluster: 'c-home', open: open('area', 'g-workshop') },
    { id: 'g-bakery', name: 'Bakery', color: 'coral', chip: 'Shop · open', status: 'open', cluster: 'c-trade', facts: [{ label: 'Opens', value: 'Tue–Sat' }], open: open('area', 'g-bakery') },
    { id: 'g-market', name: 'Saturday market stall', color: 'violet', chip: 'Stall · weekly', cluster: 'c-trade', open: open('area', 'g-market') },
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
    { id: 's-passing', galaxy: 'g-loose', name: 'Noted in passing and waiting for a plan of their own', virtual: true },
    { id: 's-refit', galaxy: 'g-workshop', name: 'Spare room refit', code: 'WS-2', status: 'under way', color: 'teal', open: open('plan', 's-refit') },
    { id: 's-stall', galaxy: 'g-market', name: 'Stall kit', code: 'MK-1', color: 'violet', open: open('plan', 's-stall') },
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
    task('t-note', 's-passing', 'Ask next door about the shared fence', { priority: 1 }),
    task('t-gazebo', 's-stall', 'Replace the torn gazebo side panel', { priority: 3, due: day(4) }),
    task('t-float', 's-stall', 'Count the cash float', { priority: 2 }),
    task('t-sign', 's-stall', 'Repaint the price board', { priority: 1 }),
    // an item planet: out of scope for this stage, and must be skipped safely
    { id: 'i-oven', system: 's-recipes', type: 'item', title: 'Deck oven', kind: 'equipment', family: 'tool', state: 'live' },
  ];
  // a system with a dozen tasks with long titles (labels that need room), some late and some with moons
  const refit = [
    'Strip the old wallpaper from the chimney breast',
    'Fill and sand the cracks above the window frame',
    'Choose a paint colour for the north-facing wall',
    'Measure up for the fitted wardrobe doors',
    'Order skirting board and quarter-round beading',
    'Move the radiator valve before the floor goes down',
    'Lay the underlay and the oak-effect flooring',
    'Rehang the door after trimming the bottom edge',
    'Fit a dimmer switch and a second double socket',
    'Seal around the window with decorator’s caulk',
    'Put up the curtain pole and the blackout lining',
    'Find a home for everything that was in the room',
  ];
  refit.forEach((title, i) =>
    planets.push(
      task(`t-refit-${i + 1}`, 's-refit', title, {
        priority: (1 + ((i * 3) % 4)) as 1 | 2 | 3 | 4,
        due: i % 4 === 1 ? day(-1 - i) : i % 3 === 0 ? day(i + 2) : null,
        ...(i % 4 === 1
          ? { attachments: [att(`a-refit-${i}-a`, 'tool', 'Sander'), att(`a-refit-${i}-b`, 'supplier', 'Builders’ merchant'), att(`a-refit-${i}-c`, 'doc', 'Room plan')], more: 2 }
          : {}),
      }),
    ),
  );
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
    {
      system: 's-refit',
      total: 10,
      items: [
        att('b-tile', 'supplier', 'Tile shop'),
        att('b-dust', 'tool', 'Dust sheets'),
        att('b-roller', 'tool', 'Paint roller'),
        att('b-quote', 'doc', 'Electrician’s quote'),
        att('b-swatch', 'photo', 'Paint swatches'),
        att('b-ladder', 'tool', 'Step ladder'),
        att('b-receipt', 'doc', 'Flooring receipt'),
        att('b-before', 'photo', 'Room before'),
        att('b-filler', 'tool', 'Filler knife'),
        att('b-plan2', 'doc', 'Wardrobe drawing'),
      ],
      open: open('holds', 's-refit'),
    },
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
    { id: 'm-paint', system: 's-refit', code: 'R1', title: 'Painting done', due: day(9), state: 'planned', serves: 3 },
    { id: 'm-floor', system: 's-refit', code: 'R2', title: 'Floor down', due: day(16), state: 'planned', serves: 2 },
  ];

  return {
    verse: 'main',
    rev: '1',
    families: FAMILIES,
    clusters: [
      { id: 'c-home', name: 'Around the house', open: open('group', 'c-home') },
      { id: 'c-trade', name: 'Trade and markets', open: open('group', 'c-trade') },
    ],
    galaxies,
    systems,
    planets,
    collections,
    beacons,
  };
}

const TASK_CAPS: Caps = { edit: true, status: true, move: true, delete: true, attach: true, reason: ['delete', 'drop'] };
const STORAGE_KEY = 'orbit-demo-host';

/** Per-record caps for the editable demo (added to a fresh verse). */
export function editableVerse(v: Verse): Verse {
  const noNew = new Set(['s-nowhere', 's-keys']);
  for (const s of v.systems) s.caps = noNew.has(s.id) ? {} : { create: true };
  for (const p of v.planets) if (p.type === 'task') p.caps = p.id === 't-keys' ? {} : { ...TASK_CAPS, reason: [...TASK_CAPS.reason!] };
  return v;
}

export function createFakeHost(opts: FakeHostOptions = {}): FakeHost {
  const editable = !!opts.editable;
  const personal = editable && !!opts.personal;
  const storage = opts.storage ?? null;
  const saved = (() => {
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as { verse: Verse; others?: Verse[]; rev: number; seq: number; store: ConstructorParameters<typeof MemoryAdapter>[0] }) : null;
    } catch {
      return null;
    }
  })();
  let current = saved?.verse ?? (editable ? editableVerse(demoVerse(opts.now)) : demoVerse(opts.now));
  const many = opts.verses !== 'one';
  /** The other verses (map, things, notes), with their own revs. */
  const others = new Map<string, Verse>((saved?.others ?? (many ? otherVerses(current, opts.now) : [])).map((v) => [v.verse, v]));
  let rev = saved?.rev ?? 1;
  let seq = saved?.seq ?? 0;
  let locked = opts.locked || undefined;
  let refuseNext: string | null = opts.refuse || null;
  const refuseFor = new Map<string, string>();
  const name = opts.name ?? 'Demo host';
  const protocol = opts.protocol ?? 1;
  const info: Handshake = {
    protocol,
    host: { name, version: '1.0' },
    caps: {
      ...(editable ? { write: true, personal, work: true, pick: ['tool', 'doc'], ...(personal ? { adopt: true } : {}) } : { write: false, personal: false, work: false }),
      ...(opts.verses !== 'one' ? { actions: ['new-notebook', 'new-note', 'galaxy-summary'] } : {}),
    },
    verses: [{ id: 'main', name: 'Everything', plain: 'Tasks', legend: 'Size: effort · ring: progress · moons: what a task uses · red glow: late', editable }, ...(many ? structuredClone(VERSE_INFO) : [])],
    start: opts.start ?? 'main',
    labels: { stored: `Kept by ${name}` },
  };
  const store = new MemoryAdapter(saved?.store ?? undefined);

  const persist = () => {
    if (!storage) return;
    void store.load().then((snap) => {
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify({ verse: current, others: [...others.values()], rev, seq, store: snap }));
      } catch {
        /* full or blocked: the demo forgets on reload */
      }
    });
  };
  if (storage) {
    // every write to the store is kept for the next page load
    for (const k of ['put', 'bulkPut', 'remove', 'setPrefs', 'setFocus', 'replaceAll'] as const) {
      const orig = (store[k] as (...a: unknown[]) => Promise<void>).bind(store);
      (store as unknown as Record<string, unknown>)[k] = async (...a: unknown[]) => {
        await orig(...a);
        persist();
      };
    }
  }

  const bump = () => {
    current = { ...current, rev: String(++rev) };
    persist();
  };
  const planet = (id: string) => {
    const p = current.planets.find((x) => x.id === id && x.type === 'task');
    if (!p) throw new Error('That task is no longer here.');
    return p;
  };
  const wait = () => (host.delay > 0 ? new Promise((r) => setTimeout(r, host.delay)) : Promise.resolve());
  /** Refusals that apply to every change, in this order. */
  const gate = async (op: string, args: unknown[], id?: string) => {
    host.log.push({ op, args: structuredClone(args) });
    await wait();
    if (locked) throw new Error(locked);
    if (refuseNext) {
      const r = refuseNext;
      refuseNext = null;
      throw new Error(r);
    }
    if (id && refuseFor.has(id)) throw new Error(refuseFor.get(id)!);
  };
  const out = (p: Planet) => structuredClone(p);

  const tasks: HostTasks = {
    async create(fields) {
      await gate('create', [fields]);
      const sys = current.systems.find((s) => s.id === fields.system);
      if (!sys?.caps?.create) throw new Error(`${name} does not take new tasks in that system.`);
      if (!fields.title?.trim()) throw new Error('A task needs a title.');
      const at = Date.now();
      const p: Planet = {
        id: `t-made-${++seq}`,
        system: sys.id,
        type: 'task',
        title: fields.title.trim(),
        notes: fields.notes ?? '',
        status: 'todo',
        priority: fields.priority ?? 2,
        due: fields.due ?? null,
        createdAt: at,
        updatedAt: at,
        caps: { ...TASK_CAPS, reason: [...TASK_CAPS.reason!] },
        open: { kind: 'task', id: `t-made-${seq}` },
      };
      current.planets.push(p);
      bump();
      return out(p);
    },
    async update(id, patch) {
      await gate('update', [id, patch], id);
      const p = planet(id);
      if (!p.caps?.edit) throw new Error(`${name} does not let this task be changed.`);
      if (id === 't-vent') throw new Error('The roof vent is waiting for a survey; it cannot be changed yet.');
      if (patch.system !== undefined && patch.system !== p.system) {
        const to = current.systems.find((s) => s.id === patch.system);
        if (!p.caps.move) throw new Error(`${name} does not let this task move.`);
        if (!to?.caps?.create) throw new Error(`${name} does not take tasks in that system.`);
        p.system = to.id;
      }
      if (patch.title !== undefined) {
        if (!patch.title.trim()) throw new Error('A task needs a title.');
        p.title = patch.title.trim();
      }
      if (patch.notes !== undefined) p.notes = patch.notes;
      if (patch.priority !== undefined) p.priority = patch.priority;
      if (patch.due !== undefined) p.due = patch.due;
      p.updatedAt = Date.now();
      bump();
      return out(p);
    },
    async setStatus(id, status, reason) {
      await gate('setStatus', reason === undefined ? [id, status] : [id, status, reason], id);
      const p = planet(id);
      if (!p.caps?.status) throw new Error(`${name} does not let this task be completed or reopened.`);
      if (status === 'dropped' && p.caps.reason?.includes('drop') && !reason?.trim()) throw new Error('A reason is needed to drop this task.');
      p.status = status === 'todo' ? 'todo' : 'done';
      p.dropped = status === 'dropped';
      p.completedAt = status === 'todo' ? null : Date.now();
      if (status === 'dropped') p.note = `Dropped: ${reason ?? ''}`.trim();
      else delete p.note;
      p.updatedAt = Date.now();
      bump();
      return out(p);
    },
    async remove(id, reason) {
      await gate('remove', [id, reason], id);
      const p = planet(id);
      if (!p.caps?.delete) throw new Error(`${name} does not let this task be deleted.`);
      if (p.caps.reason?.includes('delete') && !reason.trim()) throw new Error('A reason is needed to delete this task.');
      current.planets = current.planets.filter((x) => x.id !== id);
      bump();
    },
    async detach(id, link) {
      await gate('detach', [id, link], id);
      const p = planet(id);
      if (!p.caps?.attach) throw new Error(`${name} does not let this task's links change.`);
      const before = p.attachments?.length ?? 0;
      p.attachments = (p.attachments ?? []).filter((a) => a.link !== link);
      if (p.attachments.length === before) throw new Error('That link is already gone.');
      bump();
    },
  };

  const host: FakeHost = {
    protocol,
    store,
    opened: [],
    calls: { verse: 0, unchanged: 0, handshake: 0 },
    log: [],
    delay: 0,
    adoptMode: opts.adopt ?? 'all',
    ...(opts.at ? { at: opts.at } : {}),
    async handshake() {
      host.calls.handshake++;
      const h = structuredClone(info);
      if (locked) h.locked = locked;
      return h;
    },
    async verse(id: string, since?: string): Promise<Verse | Unchanged> {
      host.calls.verse++;
      const other = others.get(id);
      if (other) {
        if (since && since === other.rev) {
          host.calls.unchanged++;
          return { verse: other.verse, rev: other.rev, unchanged: true };
        }
        return structuredClone(other);
      }
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
      bump();
    },
    changeVerse(id, fn) {
      if (id === current.verse) return host.change(fn);
      const v = others.get(id);
      if (!v) throw new Error(`No verse called “${id}”.`);
      fn(v);
      v.rev = String(Number(v.rev) + 1 || 2);
      persist();
    },
    current: () => current,
    verseNow: (id) => (id === current.verse ? current : others.get(id)),
    refuseNext(reason) {
      refuseNext = reason;
    },
    refuseAlways(taskId, reason) {
      if (reason) refuseFor.set(taskId, reason);
      else refuseFor.delete(taskId);
    },
    setLocked(text) {
      locked = text || undefined;
    },
  };
  if (personal) {
    /* The host's own "take these tasks" dialog: in the demo it files them in a new system in the Workshop. */
    host.adopt = async (batch: AdoptBatch): Promise<AdoptResult | null> => {
      host.log.push({ op: 'adopt', args: [structuredClone(batch)] });
      await wait();
      if (locked) throw new Error(locked);
      if (host.adoptMode === 'cancel') return null;
      if (host.adoptMode === 'fail') throw new Error(`${name} could not take them just now.`);
      const take = host.adoptMode === 'some' ? batch.tasks.slice(0, -1) : batch.tasks;
      const map: Record<string, string> = {};
      if (!take.length) return { map };
      const sid = `s-taken-${++seq}`;
      current.systems.push({ id: sid, galaxy: 'g-workshop', name: batch.name, code: `WS-${seq}`, caps: { create: true }, open: { kind: 'plan', id: sid } });
      const at = Date.now();
      for (const t of take) {
        const id = `t-made-${++seq}`;
        current.planets.push({
          id,
          system: sid,
          type: 'task',
          title: t.title,
          notes: t.notes,
          status: t.status,
          priority: t.priority,
          due: t.due,
          completedAt: t.status === 'done' ? at : null,
          createdAt: at,
          updatedAt: at,
          caps: { ...TASK_CAPS, reason: [...TASK_CAPS.reason!] },
          open: { kind: 'task', id },
        });
        map[t.id] = id;
      }
      bump();
      return { map };
    };
  }
  if (many) {
    /* The host's own dialogs for the actions its verses offer ("New notebook…", "New note…", "Print a summary…"). */
    host.action = async (id, ctx) => {
      host.log.push({ op: 'action', args: [id, structuredClone(ctx)] });
      await wait();
      if (locked) throw new Error(locked);
      if (refuseNext) {
        const r = refuseNext;
        refuseNext = null;
        throw new Error(r);
      }
      const changed = demoAction(others, id, ctx, ++seq);
      if (changed) {
        const notes = others.get('notes')!;
        notes.rev = String(Number(notes.rev) + 1 || 2);
        persist();
      }
      return changed;
    };
  }
  if (editable) {
    host.tasks = tasks;
    host.pick = async (family, ctx) => {
      host.log.push({ op: 'pick', args: [family, structuredClone(ctx)] });
      // the host's own picker: in the demo it "chooses" a new item of the family at once
      const p = ctx.planet ? current.planets.find((x) => x.id === ctx.planet) : undefined;
      if (!p) return false;
      const n = ++seq;
      const label = `${(FAMILIES as Record<string, { label: string }>)[family]?.label ?? family} pick ${n}`;
      (p.attachments ??= []).push({ id: `a-pick-${n}`, link: `l-pick-${n}`, kind: family, family, label, state: 'live' });
      bump();
      return true;
    };
  }
  return host;
}
