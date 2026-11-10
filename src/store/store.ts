import { createStore, type StoreApi } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type {
  Capture,
  Checkpoint,
  DayItem,
  DaySlot,
  Energy,
  FocusRuntime,
  FocusSession,
  Group,
  HostRef,
  Link,
  Placement,
  Prefs,
  Priority,
  Project,
  SessionEndReason,
  SessionKind,
  Snapshot,
  TableName,
  Task,
  TimerMode,
  ViewName,
} from '../types';
import { emptySnapshot, MemoryAdapter, type StorageAdapter } from '../data/storage';
import { DEFAULT_PREFS } from '../data/normalise';
import * as T from '../lib/timer';
import { uid, toDateKey } from '../lib/util';
import { nextUnusedColor } from '../lib/colors';
import { buildExample } from '../data/example';
import { findFreeSpot, nextGalaxySpot, spiralLayout, SYSTEM_SPACING, type Pt } from '../data/layout';
import type { Handshake, Open, OrbitHost } from '../host/types';
import { isUnchanged } from '../host/types';
import { adaptVerse, DEEP_SPACE, placementKey, type HostExtras } from '../host/adapt';
import { abilities, may, mayWork, refusal, STANDALONE, type HostAbilities } from '../host/caps';
import { createRecordWriter } from '../host/writer';

/* ---------------- UI-only types ---------------- */

export type Selection = { type: 'task' | 'project' | 'group' | 'beacon'; id: string } | null;

/** A request for the Universe to fly somewhere (from search, panels, other views). */
export interface Flight {
  kind: 'universe' | 'galaxy' | 'system';
  /** Galaxy id (or 'deep-space'), or project id for a system. */
  id: string | null;
  nonce: number;
}

export interface Toast {
  id: string;
  text: string;
  tone?: 'info' | 'success' | 'danger';
  action?: { label: string; run: () => void };
  timeout?: number;
}

export interface ConfirmRequest {
  title: string;
  body?: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
}

/** What the park sheet should do: park a task, or edit an existing (auto) checkpoint. */
export type ParkRequest = { taskId: string; checkpointId?: string } | null;

export interface ParkInput {
  doing?: string;
  stoppedAt?: string;
  nextAction?: string;
  notes?: string;
  links?: Link[];
}

export interface StartOptions {
  taskId: string | null;
  mode?: TimerMode;
  minutes?: number;
  kind?: SessionKind;
}

export interface LastFocusEnd {
  taskId: string | null;
  completedCountdown: boolean;
  cycle: number;
  at: number;
}

export interface Effects {
  chime: (kind: 'focus-end' | 'break-end') => void;
  notify: (title: string, body: string) => void;
}

export interface UniverseFilter {
  query: string;
  dueSoon: boolean;
  highPriority: boolean;
  parkedOnly: boolean;
  showDone: boolean;
  groupId: string | null;
  /** Hosted: only tasks with linked items (moons). */
  hasLinked: boolean;
  /** Hosted: highlight every task that uses this attachment (by id). */
  uses: string | null;
  /** Hosted: show galaxies the host marks finished. */
  showFinished: boolean;
}

/**
 * What a host application provides besides the records merged into groups/projects/tasks (see src/host).
 * null when ORBIT runs on its own.
 */
export interface HostSlice extends HostExtras {
  info: Handshake;
  verseId: string;
  /** The rev of the verse on screen ('' before the first one arrives). */
  rev: string;
  /** Set when the host could not be reached or answered with something unusable. */
  error?: string;
}

export interface InitOptions {
  /** Run embedded: records come from this host, and ORBIT's own state goes to its store. */
  host?: { host: OrbitHost; info: Handshake } | null;
  /** A host was found but refused (shown on screen; ORBIT runs on its own, in memory). */
  hostRefusal?: string | null;
}

export interface OrbitState extends Snapshot {
  ready: boolean;
  storageKind: StorageAdapter['kind'];
  storageError: string | null;
  view: ViewName;
  selection: Selection;
  park: ParkRequest;
  resumeFor: string | null;
  captureOpen: boolean;
  searchOpen: boolean;
  helpOpen: boolean;
  confirmReq: ConfirmRequest | null;
  toasts: Toast[];
  expanded: string[];
  filter: UniverseFilter;
  cycle: number;
  lastFocusEnd: LastFocusEnd | null;
  dayDate: string;
  flight: Flight | null;
  host: HostSlice | null;
  hostRefusal: string | null;

  // lifecycle
  init: (adapter: StorageAdapter, storageError?: string | null, opts?: InitOptions) => Promise<void>;

  // host
  /** Ask the host for the verse again; nothing changes on screen when the host answers "unchanged". */
  refreshHost: () => Promise<void>;
  /** Show something on a page of the host's own. */
  openInHost: (target: Open | undefined) => void;
  /** What may be done here (everything when standalone). */
  abilities: () => HostAbilities;

  // navigation & UI
  setView: (v: ViewName) => void;
  select: (s: Selection) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  confirm: (r: ConfirmRequest | null) => void;
  setCaptureOpen: (o: boolean) => void;
  setSearchOpen: (o: boolean) => void;
  setHelpOpen: (o: boolean) => void;
  toggleExpanded: (projectId: string, force?: boolean) => void;
  setExpandedAll: (ids: string[]) => void;
  setFilter: (f: Partial<UniverseFilter>) => void;
  setDayDate: (d: string) => void;
  requestFlight: (kind: Flight['kind'], id: string | null) => void;

  // groups
  createGroup: (name: string, color?: string, at?: Pt) => Group;
  updateGroup: (id: string, patch: Partial<Omit<Group, 'id'>>) => void;
  deleteGroup: (id: string) => void;

  // projects
  createProject: (input: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>> & { name: string }) => Project;
  updateProject: (id: string, patch: Partial<Omit<Project, 'id'>>) => void;
  /** A free position for a new system inside a galaxy (null = deep space). */
  freeSystemSpot: (groupId: string | null, excludeId?: string) => Pt;
  setDeepSpace: (at: Pt) => void;
  /** Lay all galaxies out along the spiral (oldest at the centre). Undo is offered. */
  arrangeGalaxiesSpiral: () => void;
  deleteProject: (id: string) => void;

  // tasks
  createTask: (input: Partial<Omit<Task, 'id' | 'createdAt' | 'updatedAt'>> & { projectId: string; title: string }) => Task;
  updateTask: (id: string, patch: Partial<Omit<Task, 'id'>>) => void;
  deleteTask: (id: string) => void;
  completeTask: (id: string) => void;
  reopenTask: (id: string) => void;

  // focus
  startFocus: (o: StartOptions) => void;
  pauseFocus: () => void;
  resumeFocus: () => void;
  extendFocus: (min: number) => void;
  stopFocus: (reason?: SessionEndReason) => void;
  startBreak: (kind: 'short-break' | 'long-break') => void;
  tick: (now?: number) => void;
  setSessionNotes: (notes: string) => void;
  captureDistraction: (text: string) => void;
  dismissLastFocusEnd: () => void;

  // parking
  openPark: (r: ParkRequest) => void;
  parkTask: (taskId: string, input: ParkInput, opts?: { auto?: boolean }) => Checkpoint;
  updateCheckpoint: (id: string, patch: Partial<Omit<Checkpoint, 'id'>>) => void;
  openResume: (taskId: string | null) => void;
  resumeTask: (taskId: string, timer: 'continue' | 'fresh' | 'none') => void;

  // capture & inbox
  addCapture: (input: { text: string; kind?: Capture['kind']; source?: Capture['source']; contextTaskId?: string | null }) => Capture;
  sortCapture: (id: string, opts: { projectId: string; slot?: DaySlot; title?: string }) => Task | null;
  dismissCapture: (id: string) => void;
  restoreCapture: (id: string) => void;
  deleteCapture: (id: string) => void;

  // day plan
  planTask: (taskId: string, date: string, slot: DaySlot, index?: number) => void;
  moveDayItem: (id: string, slot: DaySlot, index: number) => void;
  unplan: (id: string) => void;
  setDayItemStart: (id: string, start: string | null) => void;

  // prefs & data
  setPrefs: (patch: Partial<Prefs>) => void;
  setNextContext: (patch: { energy?: Energy; minutes?: number }) => void;
  snapshot: () => Snapshot;
  restore: (s: Snapshot) => Promise<void>;
  loadExample: () => Promise<void>;
  removeExample: () => Promise<void>;
  resetAll: () => Promise<void>;
}

export interface StoreDeps {
  now?: () => number;
  effects?: Effects;
}

const noopEffects: Effects = { chime: () => {}, notify: () => {} };
let appEffects: Effects = noopEffects;
/** The app wires real sound and notifications in main.tsx; tests pass their own via deps. */
export function setEffects(e: Effects) {
  appEffects = e;
}

export function createOrbitStore(deps: StoreDeps = {}): StoreApi<OrbitState> {
  const now = deps.now ?? (() => Date.now());
  const fx = () => deps.effects ?? appEffects;
  let adapter: StorageAdapter = new MemoryAdapter();
  /** The attached host, if any. Never stored; its records are rebuilt from verse(). */
  let hostApi: OrbitHost | null = null;
  let lastSaveErrorAt = 0;

  return createStore<OrbitState>()((set, get) => {
    /* ---------- persistence helpers ---------- */

    const onSaveError = (err: unknown) => {
      console.error('[orbit] save failed', err);
      if (now() - lastSaveErrorAt < 8000) return;
      lastSaveErrorAt = now();
      get().toast({
        tone: 'danger',
        text: 'Could not save to this device. Your change is still on screen — export a backup from Settings to be safe.',
        timeout: 9000,
      });
    };
    const save = (p: Promise<unknown>) => {
      p.catch(onSaveError);
    };

    /* ---------- host helpers ---------- */

    const can = (): HostAbilities => (get()?.host ? abilities(get().host!.info) : STANDALONE);
    /** The host reference of a record in memory, if a host owns it. */
    const ownerOf = (table: TableName, id: string): HostRef | undefined => {
      if (table === 'groups') return get().groups.find((g) => g.id === id)?.host;
      if (table === 'projects') return get().projects.find((p) => p.id === id)?.host;
      if (table === 'tasks') return get().tasks.find((t) => t.id === id)?.host;
      return undefined;
    };
    /** A refused change: nothing happens, and a toast says why (once, while it is on screen). */
    const refuse = (text: string) => {
      if (!get().toasts.some((t) => t.text === text)) get().toast({ text });
    };
    const onlyPosition = (patch: object) => Object.keys(patch).every((k) => k === 'x' || k === 'y');

    // Every write below goes through this one writer (src/host/writer.ts): the single place that decides
    // where a record goes, and that keeps host-owned records out of storage.
    const writer = createRecordWriter(() => ({
      adapter,
      hosted: hostApi && get().host ? { abilities: can(), ownerOf, now, onPlacement: (pl: Placement) => set({ placements: [...get().placements.filter((x) => x.id !== pl.id), pl] }) } : null,
    }));
    const put = (table: TableName, rec: { id: string }) => save(writer.put(table, rec));
    const putMany = (table: TableName, recs: { id: string }[]) => save(writer.putMany(table, recs));
    const del = (table: TableName, ids: string[]) => save(writer.remove(table, ids));
    const setFocusRt = (rt: FocusRuntime | null) => {
      set({ focus: rt });
      save(writer.setFocus(rt));
    };

    const stamp = <R extends { updatedAt: number }>(r: R): R => ({ ...r, updatedAt: now() });

    const patchRow = <K extends TableName>(table: K, id: string, patch: object) => {
      const rows = get()[table] as unknown as { id: string; updatedAt: number }[];
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      const next = stamp({ ...rows[idx], ...patch });
      const copy = rows.slice();
      copy[idx] = next;
      set({ [table]: copy } as unknown as Partial<OrbitState>);
      put(table, next);
      return next;
    };

    /** True when some project lives in deep space (no galaxy, or a galaxy that no longer exists). */
    const deepInUse = (exceptId?: string) => {
      const ids = new Set(get().groups.map((g) => g.id));
      return get().projects.some((p) => p.id !== exceptId && (!p.groupId || !ids.has(p.groupId)));
    };
    /** Deep space only takes a place in the universe once something lives there: give it a free spiral slot. */
    const claimDeepSpace = (exceptId?: string, at?: Pt) => {
      if (deepInUse(exceptId)) return;
      const spot = at ?? nextGalaxySpot(get().groups.map((g) => ({ x: g.x, y: g.y })));
      get().setDeepSpace(spot);
    };

    const latestCheckpoint = (taskId: string): Checkpoint | null => {
      let best: Checkpoint | null = null;
      for (const c of get().checkpoints) if (c.taskId === taskId && (!best || c.createdAt > best.createdAt)) best = c;
      return best;
    };

    /** Ends the live session and records it. Returns the ended runtime. */
    const endSession = (reason: SessionEndReason): FocusRuntime | null => {
      const rt = get().focus;
      if (!rt) return null;
      const t = now();
      const activeMs = T.sessionActiveMs(rt, t);
      const sess = get().sessions.find((s) => s.id === rt.sessionId);
      if (sess) {
        patchRow('sessions', sess.id, { endedAt: t, activeMs, endReason: reason });
      }
      if (rt.kind === 'focus') {
        const completedCountdown = rt.finishedAt != null;
        const cycle = completedCountdown ? rt.cycleCount + 1 : rt.cycleCount;
        set({ cycle, lastFocusEnd: { taskId: rt.taskId, completedCountdown, cycle, at: t } });
      } else {
        // A long break resets the cycle.
        set({ cycle: rt.kind === 'long-break' ? 0 : get().cycle, lastFocusEnd: null });
      }
      setFocusRt(null);
      return rt;
    };

    const beginSession = (o: { taskId: string | null; kind: SessionKind; mode: TimerMode; plannedMs: number | null; baseMs?: number; fromCheckpointId?: string | null }) => {
      const t = now();
      const id = uid();
      const sess: FocusSession = {
        id,
        createdAt: t,
        updatedAt: t,
        taskId: o.taskId,
        kind: o.kind,
        mode: o.mode,
        plannedMs: o.mode === 'flow' ? null : o.plannedMs,
        startedAt: t,
        endedAt: null,
        activeMs: 0,
        notes: '',
        distractions: 0,
        endReason: null,
      };
      set({ sessions: [...get().sessions, sess], lastFocusEnd: null });
      put('sessions', sess);
      setFocusRt(
        T.createRuntime({
          sessionId: id,
          taskId: o.taskId,
          kind: o.kind,
          mode: o.mode,
          plannedMs: o.plannedMs,
          now: t,
          baseMs: o.baseMs,
          fromCheckpointId: o.fromCheckpointId ?? null,
          cycleCount: get().cycle,
        }),
      );
    };

    /** If something else is live, park it (task) or end it (break / open focus) so a new one can start. */
    const clearForSwitch = (nextTaskId: string | null) => {
      const rt = get().focus;
      if (!rt) return;
      if (rt.taskId && rt.taskId !== nextTaskId && rt.kind === 'focus') {
        const cp = get().parkTask(rt.taskId, {}, { auto: true });
        const task = get().tasks.find((x) => x.id === rt.taskId);
        get().toast({
          text: `Parked “${task?.title ?? 'task'}” with its timer saved.`,
          action: { label: 'Add a note', run: () => get().openPark({ taskId: cp.taskId, checkpointId: cp.id }) },
          timeout: 7000,
        });
      } else {
        endSession('switched');
      }
    };

    /** Puts a verse on screen: host records are replaced, ORBIT's own are kept, the selection stays if it can. */
    const applyVerse = (v: Parameters<typeof adaptVerse>[0]) => {
      const ad = adaptVerse(v, get().placements);
      const own = <T extends { host?: HostRef }>(rows: T[]) => rows.filter((r) => !r.host);
      const groups = [...own(get().groups), ...ad.groups];
      const projects = [...own(get().projects), ...ad.projects];
      const tasks = [...own(get().tasks), ...ad.tasks];
      const sel = get().selection;
      const still =
        !sel ||
        (sel.type === 'task' ? tasks.some((t) => t.id === sel.id) : sel.type === 'project' ? projects.some((p) => p.id === sel.id) : sel.type === 'group' ? groups.some((g) => g.id === sel.id) : ad.extras.beacons.some((b) => b.id === sel.id));
      set({
        groups,
        projects,
        tasks,
        selection: still ? sel : null,
        // deep space's place in a hosted sky comes from placements; it is not saved as a preference
        prefs: ad.deepSpace ? { ...get().prefs, deepSpace: ad.deepSpace } : get().prefs,
        host: { ...get().host!, ...ad.extras, verseId: ad.verseId, rev: ad.rev, error: undefined },
      });
    };

    const ensureParkedTaskIsTodo = (taskId: string | null) => {
      if (!taskId) return;
      const task = get().tasks.find((x) => x.id === taskId);
      if (task && task.status !== 'todo') patchRow('tasks', taskId, { status: 'todo', parkedAt: null, completedAt: null });
    };

    return {
      ...emptySnapshot(),
      ready: false,
      storageKind: 'memory',
      storageError: null,
      view: 'universe',
      selection: null,
      park: null,
      resumeFor: null,
      captureOpen: false,
      searchOpen: false,
      helpOpen: false,
      confirmReq: null,
      toasts: [],
      expanded: [],
      filter: { query: '', dueSoon: false, highPriority: false, parkedOnly: false, showDone: false, groupId: null, hasLinked: false, uses: null, showFinished: false },
      cycle: 0,
      lastFocusEnd: null,
      dayDate: toDateKey(now()),
      flight: null,
      host: null,
      hostRefusal: null,

      /* ---------- lifecycle ---------- */

      init: async (a, storageError = null, opts = {}) => {
        const hosted = opts.host ?? null;
        adapter = hosted ? hosted.host.store : a;
        hostApi = hosted?.host ?? null;
        let snap: Snapshot;
        try {
          snap = { ...emptySnapshot(), ...(await adapter.load()) };
        } catch (e) {
          console.error(e);
          snap = emptySnapshot();
          storageError = `Could not read saved data: ${e instanceof Error ? e.message : String(e)}`;
        }
        // Preferences may come from an older ORBIT, or from a host's store: fill in anything missing.
        snap.prefs = { ...DEFAULT_PREFS, ...(snap.prefs ?? {}), layers: { ...DEFAULT_PREFS.layers, ...(snap.prefs?.layers ?? {}) } };
        if (!hosted) {
          set({ ...snap, ready: true, storageKind: a.kind, storageError, hostRefusal: opts.hostRefusal ?? null, cycle: snap.focus?.cycleCount ?? 0 });
          get().tick();
          return;
        }
        // Hosted: only what the host keeps for ORBIT comes back from its store (positions and preferences in
        // this stage); host records come from the verse.
        const info = hosted.info;
        const ab = abilities(info);
        const keep = <K extends keyof Snapshot>(k: K, when: boolean) => (when ? snap[k] : emptySnapshot()[k]);
        const verseId = info.start && info.verses.some((v) => v.id === info.start) ? info.start : info.verses[0].id;
        set({
          ...emptySnapshot(),
          groups: keep('groups', ab.personal),
          projects: keep('projects', ab.personal),
          tasks: keep('tasks', ab.personal),
          captures: keep('captures', ab.personal),
          checkpoints: keep('checkpoints', ab.work),
          sessions: keep('sessions', ab.work),
          dayItems: keep('dayItems', ab.work),
          taskWork: keep('taskWork', ab.work),
          focus: ab.work ? snap.focus : null,
          placements: snap.placements,
          prefs: snap.prefs,
          storageKind: adapter.kind,
          storageError,
          hostRefusal: null,
          host: { info, verseId, rev: '', families: {}, attachments: {}, collections: {}, beacons: [], clusters: [] },
        });
        try {
          const v = await hostApi!.verse(verseId);
          if (isUnchanged(v)) throw new Error('it answered “unchanged” to the first request');
          applyVerse(v);
        } catch (e) {
          set({ host: { ...get().host!, error: `Could not load from ${ab.name}: ${e instanceof Error ? e.message : String(e)}` } });
        }
        set({ ready: true });
      },

      /* ---------- host ---------- */

      refreshHost: async () => {
        const h = get().host;
        if (!hostApi || !h) return;
        try {
          const v = await hostApi.verse(h.verseId, h.rev || undefined);
          if (isUnchanged(v)) {
            if (h.error) set({ host: { ...h, error: undefined } });
            return;
          }
          applyVerse(v);
        } catch (e) {
          set({ host: { ...get().host!, error: `Could not refresh from ${can().name}: ${e instanceof Error ? e.message : String(e)}` } });
        }
      },
      openInHost: (target) => {
        if (!hostApi || !target) return;
        try {
          hostApi.open({ kind: target.kind, id: target.id });
        } catch (e) {
          get().toast({ tone: 'danger', text: `${can().name} could not open it: ${e instanceof Error ? e.message : String(e)}` });
        }
      },
      abilities: () => can(),

      /* ---------- navigation & UI ---------- */

      setView: (view) => {
        if (!viewAvailable(can(), view)) return;
        set({ view });
      },
      select: (selection) => set({ selection }),
      toast: (t) => {
        const id = uid();
        set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
      },
      dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
      confirm: (confirmReq) => set({ confirmReq }),
      setCaptureOpen: (captureOpen) => {
        if (captureOpen && !can().personal) return refuse(refusal.personal(can()));
        set({ captureOpen });
      },
      setSearchOpen: (searchOpen) => set({ searchOpen }),
      setHelpOpen: (helpOpen) => set({ helpOpen }),
      toggleExpanded: (id, force) => {
        const has = get().expanded.includes(id);
        const want = force ?? !has;
        if (want === has) return;
        set({ expanded: want ? [...get().expanded, id] : get().expanded.filter((x) => x !== id) });
      },
      setExpandedAll: (expanded) => set({ expanded }),
      setFilter: (f) => set({ filter: { ...get().filter, ...f } }),
      setDayDate: (dayDate) => set({ dayDate }),
      requestFlight: (kind, id) => set({ flight: { kind, id, nonce: (get().flight?.nonce ?? 0) + 1 } }),

      /* ---------- groups ---------- */

      createGroup: (name, color, at) => {
        const t = now();
        if (!can().personal) {
          // Refused: the galaxy it would have made is returned but is not in the store.
          refuse(refusal.personal(can()));
          return { id: uid(), createdAt: t, updatedAt: t, name, color: color ?? 'violet', x: 0, y: 0 };
        }
        const taken: Pt[] = get().groups.map((g) => ({ x: g.x, y: g.y }));
        const groupIds = new Set(get().groups.map((g) => g.id));
        if (get().projects.some((p) => !p.groupId || !groupIds.has(p.groupId))) taken.push(get().prefs.deepSpace);
        const spot = at ?? nextGalaxySpot(taken);
        const g: Group = { id: uid(), createdAt: t, updatedAt: t, name: name.trim() || 'Galaxy', color: color ?? nextUnusedColor(get().groups.map((x) => x.color)), x: spot.x, y: spot.y };
        set({ groups: [...get().groups, g] });
        put('groups', g);
        return g;
      },
      updateGroup: (id, patch) => {
        const ref = ownerOf('groups', id);
        // Where a host galaxy sits is ORBIT's to remember (a placement); anything else is the host's.
        if (ref && !(onlyPosition(patch) || may(can(), ref, 'edit'))) return refuse(refusal.kept(can()));
        patchRow('groups', id, patch);
      },
      deleteGroup: (id) => {
        if (ownerOf('groups', id)) return refuse(refusal.kept(can()));
        const gone = get().groups.find((g) => g.id === id);
        const members = get().projects.filter((p) => p.groupId === id);
        let affected: Project[];
        if (members.length && gone && !deepInUse()) {
          // Deep space was empty: it takes over this galaxy's place, so its projects stay where they were.
          get().setDeepSpace({ x: gone.x, y: gone.y });
          affected = members.map((p) => stamp({ ...p, groupId: null }));
        } else {
          // Its systems drift into deep space, each at a free spot there.
          const groupIds = new Set(get().groups.map((g) => g.id));
          const taken: Pt[] = get()
            .projects.filter((p) => !p.groupId || !groupIds.has(p.groupId))
            .map((p) => ({ x: p.x, y: p.y }));
          affected = members.map((p) => {
            const spot = findFreeSpot(p.x, p.y, taken, SYSTEM_SPACING);
            taken.push(spot);
            return stamp({ ...p, groupId: null, x: spot.x, y: spot.y });
          });
        }
        set({
          groups: get().groups.filter((g) => g.id !== id),
          projects: get().projects.map((p) => affected.find((a) => a.id === p.id) ?? p),
          selection: get().selection?.type === 'group' && get().selection?.id === id ? null : get().selection,
        });
        putMany('projects', affected);
        del('groups', [id]);
      },
      arrangeGalaxiesSpiral: () => {
        const before = get().groups.map((g) => ({ id: g.id, x: g.x, y: g.y }));
        const beforeDeep = get().prefs.deepSpace;
        const ordered = [...get().groups].sort((a, b) => a.createdAt - b.createdAt);
        const lay = spiralLayout(
          ordered.map((g) => g.id),
          deepInUse(),
        );
        const moved = ordered.map((g) => stamp({ ...g, ...lay.galaxies.get(g.id)! }));
        set({ groups: get().groups.map((g) => moved.find((m) => m.id === g.id) ?? g) });
        putMany('groups', moved);
        if (lay.deepSpace) get().setDeepSpace(lay.deepSpace);
        get().requestFlight('universe', null);
        get().toast({
          text: 'Galaxies arranged in a spiral, oldest at the centre.',
          action: {
            label: 'Undo',
            run: () => {
              const back = get()
                .groups.map((g) => {
                  const b = before.find((x) => x.id === g.id);
                  return b ? stamp({ ...g, x: b.x, y: b.y }) : null;
                })
                .filter((g): g is Group => !!g);
              set({ groups: get().groups.map((g) => back.find((b) => b.id === g.id) ?? g) });
              putMany('groups', back);
              get().setDeepSpace(beforeDeep);
              get().requestFlight('universe', null);
            },
          },
          timeout: 9000,
        });
      },

      /* ---------- projects ---------- */

      createProject: (input) => {
        const t = now();
        const intoHost = input.groupId ? ownerOf('groups', input.groupId) : undefined;
        if (!can().personal || intoHost) {
          // Refused: the system it would have made is returned but is not in the store.
          refuse(intoHost && can().personal ? refusal.kept(can()) : refusal.personal(can()));
          return { id: uid(), createdAt: t, updatedAt: t, name: input.name, color: 'violet', icon: 'orbit', description: '', groupId: null, x: 0, y: 0, archived: false };
        }
        if (!input.groupId) claimDeepSpace();
        const p: Project = {
          id: uid(),
          createdAt: t,
          updatedAt: t,
          name: input.name.trim() || 'Untitled project',
          color: input.color ?? nextUnusedColor(get().projects.map((x) => x.color)),
          icon: input.icon ?? 'orbit',
          description: input.description ?? '',
          groupId: input.groupId ?? null,
          x: input.x ?? 0,
          y: input.y ?? 0,
          archived: false,
          example: input.example,
        };
        set({ projects: [...get().projects, p] });
        put('projects', p);
        return p;
      },
      updateProject: (id, patch) => {
        const cur = get().projects.find((p) => p.id === id);
        if (cur?.host) {
          // A host system may be dragged to a new place in its own galaxy; moving it to another galaxy, or
          // changing anything else about it, is the host's.
          if ('groupId' in patch && patch.groupId !== cur.groupId && !may(can(), cur.host, 'move')) return refuse(refusal.move(can()));
          const rest: Partial<Project> = { ...patch };
          if (rest.groupId === cur.groupId) delete rest.groupId;
          if (!onlyPosition(rest) && !may(can(), cur.host, 'edit')) return refuse(refusal.kept(can()));
        }
        if (cur && 'groupId' in patch && patch.groupId !== cur.groupId && !patch.groupId) claimDeepSpace(id);
        if (cur && 'groupId' in patch && patch.groupId !== cur.groupId && patch.x === undefined && patch.y === undefined) {
          // Moving to another galaxy: find it a free orbit there.
          const spot = get().freeSystemSpot(patch.groupId ?? null, id);
          patchRow('projects', id, { ...patch, x: spot.x, y: spot.y });
          return;
        }
        patchRow('projects', id, patch);
      },
      freeSystemSpot: (groupId, excludeId) => {
        const groupIds = new Set(get().groups.map((g) => g.id));
        const inGalaxy = (p: Project) => (groupId ? p.groupId === groupId : !p.groupId || !groupIds.has(p.groupId));
        const taken = get()
          .projects.filter((p) => p.id !== excludeId && inGalaxy(p))
          .map((p) => ({ x: p.x, y: p.y }));
        return findFreeSpot(0, 0, taken, SYSTEM_SPACING);
      },
      setDeepSpace: (at) => {
        const deepSpace = { x: Math.round(at.x), y: Math.round(at.y) };
        if (!get().host) return get().setPrefs({ deepSpace });
        // Hosted: deep space is placed like a host galaxy (and the preference is not the source of truth).
        const pl: Placement = { id: placementKey.galaxy(DEEP_SPACE), ...deepSpace, updatedAt: now() };
        set({ prefs: { ...get().prefs, deepSpace }, placements: [...get().placements.filter((p) => p.id !== pl.id), pl] });
        put('placements', pl);
      },
      deleteProject: (id) => {
        if (ownerOf('projects', id)) return refuse(refusal.kept(can()));
        const taskIds = get()
          .tasks.filter((t) => t.projectId === id)
          .map((t) => t.id);
        const tset = new Set(taskIds);
        if (get().focus?.taskId && tset.has(get().focus!.taskId!)) endSession('stopped');
        const cps = get().checkpoints.filter((c) => tset.has(c.taskId)).map((c) => c.id);
        const items = get().dayItems.filter((d) => tset.has(d.taskId)).map((d) => d.id);
        set({
          projects: get().projects.filter((p) => p.id !== id),
          tasks: get().tasks.filter((t) => !tset.has(t.id)),
          checkpoints: get().checkpoints.filter((c) => !tset.has(c.taskId)),
          dayItems: get().dayItems.filter((d) => !tset.has(d.taskId)),
          selection: get().selection?.id === id || (get().selection && tset.has(get().selection!.id)) ? null : get().selection,
          expanded: get().expanded.filter((x) => x !== id),
        });
        del('tasks', taskIds);
        del('checkpoints', cps);
        del('dayItems', items);
        del('projects', [id]);
      },

      /* ---------- tasks ---------- */

      createTask: (input) => {
        const t = now();
        const into = get().projects.find((p) => p.id === input.projectId);
        const refused = into?.host ? !may(can(), into.host, 'create') : !can().personal;
        const task: Task = {
          id: uid(),
          createdAt: t,
          updatedAt: t,
          projectId: input.projectId,
          title: input.title.trim() || 'Untitled task',
          notes: input.notes ?? '',
          status: 'todo',
          priority: (input.priority ?? 2) as Priority,
          due: input.due ?? null,
          estimateMin: input.estimateMin ?? null,
          energy: input.energy ?? 'medium',
          progress: input.progress ?? 0,
          subtasks: input.subtasks ?? [],
          dependsOn: input.dependsOn ?? [],
          links: input.links ?? [],
          completedAt: null,
          parkedAt: null,
          example: input.example,
        };
        if (refused) {
          // Refused: the task it would have made is returned but is not in the store.
          refuse(into?.host ? refusal.kept(can()) : refusal.personal(can()));
          return task;
        }
        set({ tasks: [...get().tasks, task] });
        put('tasks', task);
        return task;
      },
      updateTask: (id, patch) => {
        const ref = ownerOf('tasks', id);
        if (ref && (!may(can(), ref, 'edit'))) return refuse(refusal.kept(can()));
        patchRow('tasks', id, patch);
      },
      deleteTask: (id) => {
        const ref = ownerOf('tasks', id);
        if (ref && (!may(can(), ref, 'delete'))) return refuse(refusal.kept(can()));
        if (get().focus?.taskId === id) endSession('stopped');
        const cps = get().checkpoints.filter((c) => c.taskId === id).map((c) => c.id);
        const items = get().dayItems.filter((d) => d.taskId === id).map((d) => d.id);
        const dependents = get()
          .tasks.filter((t) => t.dependsOn.includes(id))
          .map((t) => stamp({ ...t, dependsOn: t.dependsOn.filter((d) => d !== id) }));
        set({
          tasks: get()
            .tasks.filter((t) => t.id !== id)
            .map((t) => dependents.find((d) => d.id === t.id) ?? t),
          checkpoints: get().checkpoints.filter((c) => c.taskId !== id),
          dayItems: get().dayItems.filter((d) => d.taskId !== id),
          selection: get().selection?.id === id ? null : get().selection,
        });
        putMany('tasks', dependents);
        del('checkpoints', cps);
        del('dayItems', items);
        del('tasks', [id]);
      },
      completeTask: (id) => {
        const task = get().tasks.find((t) => t.id === id);
        if (!task) return;
        if (task.host && (!may(can(), task.host, 'status'))) return refuse(refusal.kept(can()));
        if (get().focus?.taskId === id) endSession('completed');
        patchRow('tasks', id, { status: 'done', completedAt: now(), parkedAt: null, progress: 100 });
        get().toast({
          tone: 'success',
          text: `Completed “${task.title}”.`,
          action: { label: 'Undo', run: () => get().reopenTask(id) },
        });
      },
      reopenTask: (id) => {
        const ref = ownerOf('tasks', id);
        if (ref && (!may(can(), ref, 'status'))) return refuse(refusal.kept(can()));
        patchRow('tasks', id, { status: 'todo', completedAt: null });
      },

      /* ---------- focus ---------- */

      startFocus: (o) => {
        if (o.taskId && !mayWork(can(), ownerOf('tasks', o.taskId))) return refuse(refusal.work(can()));
        const prefs = get().prefs;
        const rt = get().focus;
        const kind = o.kind ?? 'focus';
        if (rt && rt.taskId === o.taskId && rt.kind === kind && o.taskId) {
          // Already focusing on this task: just make sure it is running.
          if (rt.runningSince == null) get().resumeFocus();
          return;
        }
        clearForSwitch(o.taskId);
        ensureParkedTaskIsTodo(o.taskId);
        const mode = o.mode ?? 'countdown';
        beginSession({ taskId: o.taskId, kind, mode, plannedMs: mode === 'flow' ? null : T.minutes(o.minutes ?? prefs.focusMin) });
      },
      pauseFocus: () => {
        const rt = get().focus;
        if (rt) setFocusRt(T.pause(rt, now()));
      },
      resumeFocus: () => {
        const rt = get().focus;
        if (rt) setFocusRt(T.resume(rt, now()));
      },
      extendFocus: (min) => {
        const rt = get().focus;
        if (rt) setFocusRt(T.extend(rt, T.minutes(min), now()));
      },
      stopFocus: (reason = 'stopped') => void endSession(reason),
      startBreak: (kind) => {
        const prefs = get().prefs;
        const rt = get().focus;
        if (rt) clearForSwitch(null);
        beginSession({ taskId: null, kind, mode: 'countdown', plannedMs: T.minutes(kind === 'long-break' ? prefs.longBreakMin : prefs.shortBreakMin) });
      },
      tick: (at) => {
        const rt = get().focus;
        if (!rt) return;
        const t = at ?? now();
        const next = T.markFinishedIfDue(rt, t);
        if (!next) return;
        setFocusRt(next);
        // Only announce if we noticed within a minute of the finish (not on a reload hours later).
        if (t - (next.finishedAt ?? t) < 60_000) {
          const prefs = get().prefs;
          const task = rt.taskId ? get().tasks.find((x) => x.id === rt.taskId) : null;
          const isBreak = rt.kind !== 'focus';
          if (prefs.sound) fx().chime(isBreak ? 'break-end' : 'focus-end');
          if (prefs.notifications)
            fx().notify(
              isBreak ? 'Break is over' : 'Focus time is up',
              isBreak ? 'Ready when you are.' : `${task ? `“${task.title}” — ` : ''}keep going, take a break, or park it.`,
            );
        }
      },
      setSessionNotes: (notes) => {
        const rt = get().focus;
        if (rt) patchRow('sessions', rt.sessionId, { notes });
      },
      captureDistraction: (text) => {
        const rt = get().focus;
        get().addCapture({ text, kind: 'thought', source: 'focus', contextTaskId: rt?.taskId ?? null });
        if (rt) {
          const s = get().sessions.find((x) => x.id === rt.sessionId);
          if (s) patchRow('sessions', s.id, { distractions: s.distractions + 1 });
        }
      },
      dismissLastFocusEnd: () => set({ lastFocusEnd: null }),

      /* ---------- parking ---------- */

      openPark: (park) => {
        if (park && !mayWork(can(), ownerOf('tasks', park.taskId))) return refuse(refusal.work(can()));
        set({ park });
      },
      parkTask: (taskId, input, opts) => {
        const t = now();
        if (!mayWork(can(), ownerOf('tasks', taskId))) {
          // Refused: the checkpoint it would have made is returned but is not in the store.
          refuse(refusal.work(can()));
          return { id: uid(), createdAt: t, updatedAt: t, taskId, doing: '', stoppedAt: '', nextAction: '', notes: '', links: [], timer: null, resumedAt: null, auto: !!opts?.auto };
        }
        const rt = get().focus;
        let timer: Checkpoint['timer'] = null;
        if (rt && rt.taskId === taskId) {
          timer = T.snapshot(rt, t);
          endSession('parked');
        }
        const cp: Checkpoint = {
          id: uid(),
          createdAt: t,
          updatedAt: t,
          taskId,
          doing: input.doing?.trim() ?? '',
          stoppedAt: input.stoppedAt?.trim() ?? '',
          nextAction: input.nextAction?.trim() ?? '',
          notes: input.notes?.trim() ?? '',
          links: input.links ?? [],
          timer,
          resumedAt: null,
          auto: !!opts?.auto,
        };
        set({ checkpoints: [...get().checkpoints, cp], park: null });
        put('checkpoints', cp);
        patchRow('tasks', taskId, { status: 'parked', parkedAt: t });
        return cp;
      },
      updateCheckpoint: (id, patch) => void patchRow('checkpoints', id, { ...patch, auto: false }),
      openResume: (resumeFor) => {
        if (resumeFor && !mayWork(can(), ownerOf('tasks', resumeFor))) return refuse(refusal.work(can()));
        set({ resumeFor });
      },
      resumeTask: (taskId, timer) => {
        if (!mayWork(can(), ownerOf('tasks', taskId))) return refuse(refusal.work(can()));
        const cp = latestCheckpoint(taskId);
        const rt = get().focus;
        if (rt && rt.taskId !== taskId) clearForSwitch(taskId);
        else if (rt && rt.taskId === taskId) endSession('switched');
        if (cp && cp.resumedAt == null) patchRow('checkpoints', cp.id, { resumedAt: now() });
        ensureParkedTaskIsTodo(taskId);
        set({ resumeFor: null });
        if (timer === 'none') return;
        if (timer === 'continue' && cp?.timer && cp.timer.kind === 'focus') {
          const a = T.resumeArgsFromSnapshot(cp.timer);
          beginSession({ taskId, kind: 'focus', mode: a.mode, plannedMs: a.plannedMs, baseMs: a.baseMs, fromCheckpointId: cp.id });
        } else {
          beginSession({ taskId, kind: 'focus', mode: 'countdown', plannedMs: T.minutes(get().prefs.focusMin), fromCheckpointId: cp?.id ?? null });
        }
      },

      /* ---------- capture & inbox ---------- */

      addCapture: (input) => {
        const t = now();
        if (!can().personal) {
          // Refused: the capture it would have made is returned but is not in the store.
          refuse(refusal.personal(can()));
          return { id: uid(), createdAt: t, updatedAt: t, text: input.text, kind: input.kind ?? 'task', source: input.source ?? 'quick', status: 'inbox', contextTaskId: null, sortedTaskId: null };
        }
        const c: Capture = {
          id: uid(),
          createdAt: t,
          updatedAt: t,
          text: input.text.trim(),
          kind: input.kind ?? 'task',
          source: input.source ?? 'quick',
          status: 'inbox',
          contextTaskId: input.contextTaskId ?? null,
          sortedTaskId: null,
        };
        set({ captures: [...get().captures, c] });
        put('captures', c);
        return c;
      },
      sortCapture: (id, opts) => {
        const c = get().captures.find((x) => x.id === id);
        if (!c) return null;
        const into = ownerOf('projects', opts.projectId);
        if (into && (!may(can(), into, 'create'))) {
          refuse(refusal.kept(can()));
          return null;
        }
        const task = get().createTask({ projectId: opts.projectId, title: opts.title ?? c.text });
        patchRow('captures', id, { status: 'sorted', sortedTaskId: task.id });
        if (opts.slot) get().planTask(task.id, toDateKey(now()), opts.slot);
        return task;
      },
      dismissCapture: (id) => void patchRow('captures', id, { status: 'dismissed' }),
      restoreCapture: (id) => void patchRow('captures', id, { status: 'inbox' }),
      deleteCapture: (id) => {
        set({ captures: get().captures.filter((c) => c.id !== id) });
        del('captures', [id]);
      },

      /* ---------- day plan ---------- */

      planTask: (taskId, date, slot, index) => {
        if (!mayWork(can(), ownerOf('tasks', taskId))) return refuse(refusal.work(can()));
        const existing = get().dayItems.find((d) => d.taskId === taskId && d.date === date);
        if (existing) {
          const inSlot = get().dayItems.filter((d) => d.date === date && d.slot === slot && d.id !== existing.id);
          get().moveDayItem(existing.id, slot, index ?? inSlot.length);
          return;
        }
        const t = now();
        const item: DayItem = { id: uid(), createdAt: t, updatedAt: t, date, taskId, slot, order: 0, start: null };
        set({ dayItems: [...get().dayItems, item] });
        const inSlot = get()
          .dayItems.filter((d) => d.date === date && d.slot === slot && d.id !== item.id)
          .sort((a, b) => a.order - b.order);
        const at = Math.max(0, Math.min(index ?? inSlot.length, inSlot.length));
        inSlot.splice(at, 0, item);
        const reordered = inSlot.map((d, i) => (d.order === i && d.id !== item.id ? d : stamp({ ...d, order: i })));
        set({ dayItems: get().dayItems.map((d) => reordered.find((r) => r.id === d.id) ?? d) });
        putMany('dayItems', reordered);
      },
      moveDayItem: (id, slot, index) => {
        const item = get().dayItems.find((d) => d.id === id);
        if (!item) return;
        const others = get()
          .dayItems.filter((d) => d.date === item.date && d.slot === slot && d.id !== id)
          .sort((a, b) => a.order - b.order);
        const at = Math.max(0, Math.min(index, others.length));
        others.splice(at, 0, { ...item, slot });
        const changed: DayItem[] = [];
        const updated = others.map((d, i) => {
          if (d.id === id || d.order !== i) {
            const n = stamp({ ...d, order: i, slot });
            changed.push(n);
            return n;
          }
          return d;
        });
        // Re-number the slot the item left so orders stay compact.
        if (item.slot !== slot) {
          get()
            .dayItems.filter((d) => d.date === item.date && d.slot === item.slot && d.id !== id)
            .sort((a, b) => a.order - b.order)
            .forEach((d, i) => {
              if (d.order !== i) changed.push(stamp({ ...d, order: i }));
            });
        }
        set({ dayItems: get().dayItems.map((d) => changed.find((c) => c.id === d.id) ?? updated.find((u) => u.id === d.id) ?? d) });
        putMany('dayItems', changed);
      },
      unplan: (id) => {
        set({ dayItems: get().dayItems.filter((d) => d.id !== id) });
        del('dayItems', [id]);
      },
      setDayItemStart: (id, start) => void patchRow('dayItems', id, { start }),

      /* ---------- prefs & data ---------- */

      setPrefs: (patch) => {
        const prefs = { ...get().prefs, ...patch, updatedAt: now() };
        set({ prefs });
        save(adapter.setPrefs(prefs));
      },
      setNextContext: ({ energy, minutes }) => {
        get().setPrefs({ ...(energy ? { nextEnergy: energy } : {}), ...(minutes ? { nextMinutes: minutes } : {}) });
      },
      snapshot: () => {
        const s = get();
        // Host records are never ORBIT's to back up or keep.
        const own = <T extends { host?: HostRef }>(rows: T[]) => rows.filter((r) => !r.host);
        return {
          projects: own(s.projects),
          groups: own(s.groups),
          tasks: own(s.tasks),
          checkpoints: s.checkpoints,
          sessions: s.sessions,
          captures: s.captures,
          dayItems: s.dayItems,
          placements: s.placements,
          taskWork: s.taskWork,
          prefs: s.prefs,
          focus: s.focus,
        };
      },
      restore: async (snap) => {
        // With a host attached, replacing everything would replace what the host keeps for ORBIT: not here.
        if (get().host) throw new Error(refusal.data(can()));
        await adapter.replaceAll(snap); // throws on failure; caller reports it and nothing changes
        set({ ...snap, selection: null, park: null, resumeFor: null, expanded: [], cycle: snap.focus?.cycleCount ?? 0, lastFocusEnd: null });
      },
      loadExample: async () => {
        if (get().host) return refuse(refusal.data(can()));
        const groupIds = new Set(get().groups.map((g) => g.id));
        const taken: Pt[] = get().groups.map((g) => ({ x: g.x, y: g.y }));
        if (get().projects.some((p) => !p.groupId || !groupIds.has(p.groupId))) taken.push(get().prefs.deepSpace);
        const ex = buildExample(now(), taken);
        const s = get().snapshot();
        const merged: Snapshot = {
          ...s,
          groups: [...s.groups, ...ex.groups],
          projects: [...s.projects, ...ex.projects],
          tasks: [...s.tasks, ...ex.tasks],
          checkpoints: [...s.checkpoints, ...ex.checkpoints],
          sessions: [...s.sessions, ...ex.sessions],
          captures: [...s.captures, ...ex.captures],
          dayItems: [...s.dayItems, ...ex.dayItems],
        };
        try {
          await get().restore(merged);
          get().toast({ text: 'Example workspace loaded. Everything in it is marked “Example” and can be removed in Settings.' });
        } catch (e) {
          onSaveError(e);
        }
      },
      removeExample: async () => {
        if (get().host) return refuse(refusal.data(can()));
        const s = get().snapshot();
        const exTaskIds = new Set(s.tasks.filter((t) => t.example).map((t) => t.id));
        // Example projects that now hold the user's own tasks are kept as ordinary projects.
        const keepProjects = new Set(s.tasks.filter((t) => !t.example).map((t) => t.projectId));
        const kept = s.projects.filter((p) => p.example && keepProjects.has(p.id));
        const keepGroups = new Set(kept.map((p) => p.groupId).filter(Boolean) as string[]);
        const t = now();
        const focus = s.focus && s.focus.taskId && exTaskIds.has(s.focus.taskId) ? null : s.focus;
        const cleaned: Snapshot = {
          ...s,
          groups: s.groups.filter((x) => !x.example || keepGroups.has(x.id)).map((x) => (x.example ? { ...x, example: undefined, updatedAt: t } : x)),
          projects: s.projects.filter((x) => !x.example || keepProjects.has(x.id)).map((x) => (x.example ? { ...x, example: undefined, updatedAt: t } : x)),
          tasks: s.tasks.filter((x) => !x.example),
          checkpoints: s.checkpoints.filter((x) => !x.example && !exTaskIds.has(x.taskId)),
          sessions: s.sessions.filter((x) => !x.example),
          captures: s.captures.filter((x) => !x.example),
          dayItems: s.dayItems.filter((x) => !x.example && !exTaskIds.has(x.taskId)),
          focus,
        };
        try {
          await get().restore(cleaned);
          get().toast({
            text: kept.length
              ? `Example data removed. Kept ${kept.map((p) => `“${p.name}”`).join(', ')} because it holds your own tasks.`
              : 'Example data removed.',
            timeout: kept.length ? 8000 : 5000,
          });
        } catch (e) {
          onSaveError(e);
        }
      },
      resetAll: async () => {
        if (get().host) return refuse(refusal.data(can()));
        try {
          await get().restore({ ...emptySnapshot(), prefs: { ...DEFAULT_PREFS, theme: get().prefs.theme } });
          get().toast({ text: 'All ORBIT data on this device was erased.' });
        } catch (e) {
          onSaveError(e);
        }
      },
    };
  });
}

/** Views that make sense with what the host provides (all of them when standalone). */
export function viewAvailable(a: HostAbilities, v: ViewName): boolean {
  if (v === 'today') return a.work;
  if (v === 'inbox') return a.personal;
  return true;
}

/* ---------------- app singleton + hook ---------------- */

export const orbitStore = createOrbitStore();
export function useOrbit<U>(selector: (s: OrbitState) => U): U {
  return useStore(orbitStore, selector);
}
/** Actions are stable, so components can grab them without subscribing. */
useOrbit.getActions = (): OrbitState => orbitStore.getState();
export const orbit = () => orbitStore.getState();
