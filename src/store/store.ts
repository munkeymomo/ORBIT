import { createStore, type StoreApi } from 'zustand/vanilla';
import { errorMessage } from '../lib/errors';
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
  TaskWork,
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
import type { Handshake, Open, OrbitHost, Planet } from '../host/types';
import { HOST_PROTOCOL, isUnchanged } from '../host/types';
import { adaptVerse, DEEP_SPACE, placementKey, planetToTask, type HostExtras } from '../host/adapt';
import { abilities, may, mayWork, needsReason, refusal, STANDALONE, type HostAbilities } from '../host/caps';
import { createRecordWriter, type HostedWriting, type WriteOptions } from '../host/writer';
import { HOST_FIELDS, overlayWork, WORK_FIELDS, workOf } from '../host/work';
import type { AdoptBatch, StartAt } from '../host/types';

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
  /** Ask for a few words with the confirmation (e.g. a reason the host wants). */
  reason?: { label: string; placeholder?: string; required?: boolean };
  /** Offer "Download a backup first" inside the dialog. */
  backup?: boolean;
  onConfirm: (reason?: string) => void;
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
  /** Ask the host for its handshake and the verse again; nothing changes on screen when it answers "unchanged". */
  refreshHost: () => Promise<void>;
  /** Resolves when no change is waiting for the host (tests, and before a refresh). */
  hostSettled: () => Promise<void>;
  /** Take a linked item off a host task (its attachment id). */
  detachLinked: (taskId: string, attachmentId: string) => void;
  /** The host shows its own picker for this family and attaches what was chosen; then ORBIT refreshes. */
  pickLinked: (family: string, ctx: { planet?: string; system?: string; galaxy?: string }) => Promise<void>;
  /** Anything else the host does in a dialog of its own (an id from handshake.caps.actions). */
  hostAction: (id: string, ctx: Record<string, string>) => Promise<boolean>;
  /** Show something on a page of the host's own. */
  openInHost: (target: Open | undefined) => void;
  /** What may be done here (everything when standalone). */
  abilities: () => HostAbilities;
  /**
   * "Move to <host>…": hand one of ORBIT's own systems and its tasks to the host (host.adopt). The host shows its
   * own dialog. Resolves with how many tasks it took (0 when the person cancelled, or on a refusal, said in a toast).
   */
  adoptProject: (projectId: string) => Promise<number>;
  /** Ids of the host's tasks on screen (restoring a backup keeps working state that points at them). */
  hostTaskIds: () => Set<string>;

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
  /** `reason`: for a host task whose caps.reason has `delete`. */
  deleteTask: (id: string, reason?: string) => void;
  completeTask: (id: string) => void;
  reopenTask: (id: string) => void;
  /** Host tasks only: done without being done. `reason` when the task's caps.reason has `drop`. */
  dropTask: (id: string, reason?: string) => void;

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
      // said once: not again within a few seconds, nor while the same words are still on screen
      if (now() - lastSaveErrorAt < 8000) return;
      const a = get()?.host ? can() : null;
      const text = a
        ? `Could not save with ${a.name}. Your change is still on screen, but may be lost when ORBIT is next opened.${a.personal ? ' Download a backup from Settings to be safe.' : ''}`
        : 'Could not save to this device. Your change is still on screen — export a backup from Settings to be safe.';
      if (get().toasts.some((t) => t.text === text)) return;
      lastSaveErrorAt = now();
      get().toast({ tone: 'danger', text, timeout: 9000 });
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
    /** A toast about a host's answer, shown once while the same words are on screen. */
    const sayOnce = (text: string) => {
      if (get().toasts.some((t) => t.text === text)) return;
      get().toast({ tone: 'danger', text, timeout: 8000 });
    };
    const refuse = (text: string, open?: Open) => {
      if (get().toasts.some((t) => t.text === text)) return;
      get().toast(open && hostApi ? { text, action: { label: can().openLabel, run: () => get().openInHost(open) }, timeout: 8000 } : { text });
    };
    const onlyPosition = (patch: object) => Object.keys(patch).every((k) => k === 'x' || k === 'y');
    /** Tasks being removed by the host (taken off screen at once, put back if the host refuses). */
    const removing = new Map<string, { task: Task; index: number }>();
    const verseOf = () => get().host?.verseId ?? '';

    /* What the writer needs to put a host's answer on screen (src/host/writer.ts). */
    const hostedWriting = (): HostedWriting => ({
      abilities: can(),
      ownerOf,
      now,
      onPlacement: (pl: Placement) => set({ placements: [...get().placements.filter((x) => x.id !== pl.id), pl] }),
      tasks: hostApi?.tasks,
      onWork: (id: string, row: TaskWork | null) => set({ taskWork: [...get().taskWork.filter((w) => w.id !== id), ...(row ? [row] : [])] }),
      current: (id) => get().tasks.find((t) => t.id === id),
      revise: (id, patch) => set({ tasks: get().tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
      refused: (reason) => sayOnce(reason),
      adopt: (id, planet, settled) => {
        const cur = get().tasks.find((t) => t.id === id);
        if (!cur?.host) return;
        set({ tasks: get().tasks.map((t) => (t.id === id ? merged(cur, planet, settled) : t)) });
        setMoons(id, planet);
      },
      created: (tempId, planet, settled) => {
        const cur = get().tasks.find((t) => t.id === tempId);
        const id = planet.id;
        const base = cur ?? planetToTask(verseOf(), planet);
        const next = { ...merged({ ...base, id }, planet, settled), id };
        set({ tasks: cur ? get().tasks.map((t) => (t.id === tempId ? next : t)) : get().tasks });
        // deleted while the host was creating it: the removal that follows is about the host's id
        const r = removing.get(tempId);
        if (r) {
          removing.delete(tempId);
          removing.set(id, { ...r, task: { ...r.task, id, host: next.host } });
        }
        setMoons(id, planet);
        repoint(tempId, id);
      },
      createRefused: (tempId, reason) => {
        set({ tasks: get().tasks.filter((t) => t.id !== tempId) });
        forget(tempId);
        const sorted = get().captures.filter((c) => c.sortedTaskId === tempId);
        for (const c of sorted) patchRow('captures', c.id, { status: 'inbox', sortedTaskId: null });
        sayOnce(reason);
      },
      removed: (id) => {
        removing.delete(id);
        set({ tasks: get().tasks.filter((t) => t.id !== id) });
        forget(id);
      },
      removeRefused: (id, reason) => {
        const r = removing.get(id);
        removing.delete(id);
        if (r && !get().tasks.some((t) => t.id === id)) {
          const tasks = get().tasks.slice();
          tasks.splice(Math.min(r.index, tasks.length), 0, r.task);
          set({ tasks });
        }
        sayOnce(reason);
      },
    });

    /** A task with what the host returned merged in: the host's fields when nothing newer is waiting. */
    const merged = (cur: Task, planet: Planet, settled: boolean): Task => {
      const fresh = planetToTask(cur.host?.verse ?? verseOf(), planet);
      if (!settled) return { ...cur, host: fresh.host };
      const done = fresh.status === 'done';
      const known = get().projects.some((p) => p.id === fresh.projectId);
      return {
        ...cur,
        title: fresh.title,
        notes: fresh.notes,
        priority: fresh.priority,
        due: fresh.due,
        projectId: known ? fresh.projectId : cur.projectId,
        status: done ? 'done' : cur.status === 'parked' ? 'parked' : 'todo',
        completedAt: done ? (cur.completedAt ?? fresh.completedAt) : null,
        parkedAt: done ? null : cur.parkedAt,
        progress: done ? 100 : cur.progress,
        updatedAt: Math.max(cur.updatedAt, fresh.updatedAt),
        host: fresh.host,
      };
    };
    const setMoons = (id: string, planet: Planet) => {
      const h = get().host;
      if (!h || (!planet.attachments && planet.more === undefined)) return;
      const attachments = { ...h.attachments };
      if (planet.attachments?.length || planet.more) attachments[id] = { items: planet.attachments ?? [], more: planet.more ?? 0 };
      else delete attachments[id];
      set({ host: { ...h, attachments } });
    };
    /** A task the host created replaces the one shown under a temporary id: everything that pointed at it moves. */
    const repoint = (from: string, to: string) => {
      const move = <R extends { id: string; taskId: string | null }>(table: 'checkpoints' | 'sessions' | 'dayItems') => {
        const rows = get()[table] as unknown as R[];
        const moved = rows.filter((r) => r.taskId === from).map((r) => ({ ...r, taskId: to }));
        if (!moved.length) return;
        set({ [table]: rows.map((r) => moved.find((m) => m.id === r.id) ?? r) } as unknown as Partial<OrbitState>);
        putMany(table, moved);
      };
      move('checkpoints');
      move('sessions');
      move('dayItems');
      for (const c of get().captures.filter((c) => c.sortedTaskId === from || c.contextTaskId === from))
        patchRow('captures', c.id, { sortedTaskId: c.sortedTaskId === from ? to : c.sortedTaskId, contextTaskId: c.contextTaskId === from ? to : c.contextTaskId });
      for (const t of get().tasks.filter((t) => t.dependsOn.includes(from))) patchRow('tasks', t.id, { dependsOn: t.dependsOn.map((d) => (d === from ? to : d)) });
      const rt = get().focus;
      if (rt?.taskId === from) setFocusRt({ ...rt, taskId: to });
      const st = get();
      set({
        selection: st.selection?.type === 'task' && st.selection.id === from ? { type: 'task', id: to } : st.selection,
        park: st.park?.taskId === from ? { ...st.park, taskId: to } : st.park,
        resumeFor: st.resumeFor === from ? to : st.resumeFor,
        lastFocusEnd: st.lastFocusEnd?.taskId === from ? { ...st.lastFocusEnd, taskId: to } : st.lastFocusEnd,
      });
    };
    /** What ORBIT kept for a task that is gone (checkpoints, day items, the focus on it, dependencies). */
    const forget = (id: string) => {
      if (get().focus?.taskId === id) endSession('stopped');
      const cps = get().checkpoints.filter((c) => c.taskId === id).map((c) => c.id);
      const items = get().dayItems.filter((d) => d.taskId === id).map((d) => d.id);
      set({
        checkpoints: get().checkpoints.filter((c) => c.taskId !== id),
        dayItems: get().dayItems.filter((d) => d.taskId !== id),
        selection: get().selection?.id === id ? null : get().selection,
        park: get().park?.taskId === id ? null : get().park,
        resumeFor: get().resumeFor === id ? null : get().resumeFor,
      });
      for (const t of get().tasks.filter((t) => t.dependsOn.includes(id))) patchRow('tasks', t.id, { dependsOn: t.dependsOn.filter((d) => d !== id) });
      del('checkpoints', cps);
      del('dayItems', items);
    };

    // Every write below goes through this one writer (src/host/writer.ts): the single place that decides
    // where a record goes, and that keeps host-owned records out of storage.
    const writer = createRecordWriter(() => ({ adapter, hosted: hostApi && get().host ? hostedWriting() : null }));
    const put = (table: TableName, rec: { id: string }, opts?: WriteOptions) => save(writer.put(table, rec, opts));
    const putMany = (table: TableName, recs: { id: string }[]) => save(writer.putMany(table, recs));
    const del = (table: TableName, ids: string[], opts?: WriteOptions) => save(writer.remove(table, ids, opts));
    const setFocusRt = (rt: FocusRuntime | null) => {
      set({ focus: rt });
      save(writer.setFocus(rt));
    };

    const stamp = <R extends { updatedAt: number }>(r: R): R => ({ ...r, updatedAt: now() });

    const patchRow = <K extends TableName>(table: K, id: string, patch: object, opts?: WriteOptions) => {
      const rows = get()[table] as unknown as { id: string; updatedAt: number }[];
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return null;
      const next = stamp({ ...rows[idx], ...patch });
      const copy = rows.slice();
      copy[idx] = next;
      set({ [table]: copy } as unknown as Partial<OrbitState>);
      put(table, next, opts);
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
      const own = <T extends { host?: HostRef }>(rows: T[]) => rows.filter((r) => !r.host);
      // the host's galaxies are placed around ORBIT's own, and deep space may hold ORBIT's own systems too
      const ownGroups = own(get().groups);
      const ownGroupIds = new Set(ownGroups.map((g) => g.id));
      const ownDeep = own(get().projects).filter((p) => !p.groupId || !ownGroupIds.has(p.groupId));
      const ad = adaptVerse(v, get().placements, { taken: ownGroups.map((g) => ({ x: g.x, y: g.y })), deepUsed: ownDeep.length > 0, deepTaken: ownDeep.map((p) => ({ x: p.x, y: p.y })) });
      const groups = [...own(get().groups), ...ad.groups];
      const projects = [...own(get().projects), ...ad.projects];
      // ORBIT's working state goes onto the host's tasks; a task with a change still waiting for the host stays
      // as it is on screen, and one being removed stays off it. Tasks being created (temporary ids) stay too.
      const work = new Map(get().taskWork.map((w) => [w.id, w]));
      const onScreen = new Map(get().tasks.filter((t) => t.host).map((t) => [t.id, t]));
      const stale: TaskWork[] = [];
      const hostTasks = ad.tasks
        .filter((t) => !removing.has(t.id))
        .map((t) => {
          const shown = onScreen.get(t.id);
          if (shown && writer.busy(t.id)) return shown;
          const o = overlayWork(t, work.get(t.id));
          if (o.stale) stale.push({ ...work.get(t.id)!, parked: false, parkedAt: null, updatedAt: now() });
          return o.task;
        });
      const creating = get().tasks.filter((t) => t.host?.pending);
      const tasks = [...own(get().tasks), ...hostTasks, ...creating];
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
      writer.seed(hostTasks);
      // the host says done: a parked flag left from before is cleared
      if (stale.length) {
        set({ taskWork: get().taskWork.map((w) => stale.find((x) => x.id === w.id) ?? w) });
        putMany('taskWork', stale);
      }
    };

    /** `host.at`: where to go first, once the first verse is on screen. Unknown ids are ignored. */
    const goStartAt = () => {
      let at: StartAt | undefined;
      try {
        at = hostApi?.at;
      } catch {
        return;
      }
      if (!at || typeof at !== 'object') return;
      const id = (x: unknown) => (typeof x === 'string' && x ? x : null);
      const task = id(at.planet) ? get().tasks.find((t) => t.id === at!.planet) : undefined;
      if (task) {
        set({ selection: { type: 'task', id: task.id } });
        return get().requestFlight('system', task.projectId);
      }
      if (id(at.system) && get().projects.some((p) => p.id === at!.system)) return get().requestFlight('system', at.system!);
      if (id(at.galaxy) && get().groups.some((g) => g.id === at!.galaxy)) get().requestFlight('galaxy', at.galaxy!);
    };

    /** After a hosted restore or erase: ORBIT's own part comes from `snap`, the host's from a fresh verse. */
    const reloadHosted = async (snap: Snapshot) => {
      const hostRows = <T extends { host?: HostRef }>(rows: T[]) => rows.filter((r) => r.host);
      const ab = can();
      set({
        groups: [...snap.groups, ...hostRows(get().groups)],
        projects: [...snap.projects, ...hostRows(get().projects)],
        // the host's tasks lose the working state laid over them until the verse below brings it back
        tasks: [...snap.tasks, ...hostRows(get().tasks)],
        checkpoints: snap.checkpoints,
        sessions: snap.sessions,
        captures: snap.captures,
        dayItems: snap.dayItems,
        placements: snap.placements,
        taskWork: ab.work ? snap.taskWork : [],
        prefs: { ...DEFAULT_PREFS, ...snap.prefs, layers: { ...DEFAULT_PREFS.layers, ...(snap.prefs?.layers ?? {}) } },
        focus: snap.focus,
        selection: null,
        park: null,
        resumeFor: null,
        expanded: [],
        cycle: snap.focus?.cycleCount ?? 0,
        lastFocusEnd: null,
      });
      const h = get().host;
      if (!hostApi || !h) return;
      try {
        const v = await hostApi.verse(h.verseId); // in full: positions and working state may all have changed
        if (isUnchanged(v)) throw new Error('it answered “unchanged” to a full request');
        applyVerse(v);
      } catch (e) {
        set({ host: { ...get().host!, error: `Could not load from ${ab.name}: ${errorMessage(e)}` } });
      }
    };

    const ensureParkedTaskIsTodo = (taskId: string | null) => {
      if (!taskId) return;
      const task = get().tasks.find((x) => x.id === taskId);
      if (!task || task.status === 'todo') return;
      // reopening a host's done task is the host's to allow
      if (task.host && task.status === 'done' && !may(can(), task.host, 'status')) return;
      patchRow('tasks', taskId, { status: 'todo', parkedAt: null, completedAt: null, ...(task.host ? { host: { ...task.host, dropped: false } } : {}) });
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
          storageError = `Could not read saved data: ${errorMessage(e)}`;
        }
        // Preferences may come from an older ORBIT, or from a host's store: fill in anything missing.
        snap.prefs = { ...DEFAULT_PREFS, ...(snap.prefs ?? {}), layers: { ...DEFAULT_PREFS.layers, ...(snap.prefs?.layers ?? {}) } };
        if (!hosted) {
          set({ ...snap, ready: true, storageKind: a.kind, storageError, hostRefusal: opts.hostRefusal ?? null, cycle: snap.focus?.cycleCount ?? 0 });
          get().tick();
          return;
        }
        // Hosted: only what the host keeps for ORBIT comes back from its store (positions and preferences, and
        // working state when it keeps work); host records come from the verse, with working state laid over.
        const info = hosted.info;
        const ab = abilities(info);
        const keep = <K extends keyof Snapshot>(k: K, when: boolean) => (when ? snap[k] : emptySnapshot()[k]);
        const verseId = startVerse(info);
        set({
          ...emptySnapshot(),
          groups: keep('groups', ab.personal),
          projects: keep('projects', ab.personal),
          tasks: keep('tasks', ab.personal),
          captures: keep('captures', ab.capture),
          checkpoints: keep('checkpoints', ab.plans),
          sessions: keep('sessions', ab.plans),
          dayItems: keep('dayItems', ab.plans),
          taskWork: keep('taskWork', ab.work),
          focus: ab.plans ? snap.focus : null,
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
          goStartAt();
        } catch (e) {
          set({ host: { ...get().host!, error: `Could not load from ${ab.name}: ${errorMessage(e)}` } });
        }
        set({ ready: true });
      },

      /* ---------- host ---------- */

      refreshHost: async () => {
        if (!hostApi || !get().host) return;
        // changes still waiting for the host are answered first, so the verse that comes back includes them
        await writer.idle();
        try {
          // the handshake can change while ORBIT runs (e.g. the host locks its records): read it again
          const info = await hostApi.handshake();
          if (!info || info.protocol !== HOST_PROTOCOL || !Array.isArray(info.verses) || !info.verses.length) throw new Error('its handshake is no longer usable');
          set({ host: { ...get().host!, info } });
        } catch (e) {
          set({ host: { ...get().host!, error: `Could not refresh from ${can().name}: ${errorMessage(e)}` } });
          return;
        }
        const h = get().host!;
        try {
          const v = await hostApi.verse(h.verseId, h.rev || undefined);
          if (isUnchanged(v)) {
            if (h.error) set({ host: { ...h, error: undefined } });
            return;
          }
          applyVerse(v);
        } catch (e) {
          set({ host: { ...get().host!, error: `Could not refresh from ${can().name}: ${errorMessage(e)}` } });
        }
      },
      openInHost: (target) => {
        if (!hostApi || !target) return;
        try {
          hostApi.open({ kind: target.kind, id: target.id });
        } catch (e) {
          get().toast({ tone: 'danger', text: `${can().name} could not open it: ${errorMessage(e)}` });
        }
      },
      abilities: () => can(),
      hostSettled: () => writer.idle(),
      detachLinked: (taskId, attachmentId) => {
        const task = get().tasks.find((t) => t.id === taskId);
        if (!task?.host) return;
        if (!may(can(), task.host, 'attach')) return refuse(refusal.kept(can()), task.host.open);
        const moons = get().host?.attachments[taskId];
        const a = moons?.items.find((x) => x.id === attachmentId);
        if (!moons || !a?.link) return;
        // off the screen at once; back if the host refuses
        const without = (h: HostSlice) => ({ ...h.attachments, [taskId]: { ...moons, items: (h.attachments[taskId]?.items ?? []).filter((x) => x.id !== attachmentId) } });
        set({ host: { ...get().host!, attachments: without(get().host!) } });
        void writer.detach(taskId, a.link).then(async (ok) => {
          if (ok) return get().refreshHost();
          const h = get().host;
          if (!h) return;
          const cur = h.attachments[taskId] ?? { items: [], more: moons.more };
          if (!cur.items.some((x) => x.id === a.id)) {
            const items = cur.items.slice();
            items.splice(Math.min(moons.items.indexOf(a), items.length), 0, a);
            set({ host: { ...h, attachments: { ...h.attachments, [taskId]: { ...cur, items } } } });
          }
        });
      },
      pickLinked: async (family, pickCtx) => {
        if (!hostApi?.pick) return;
        const task = pickCtx.planet ? get().tasks.find((t) => t.id === pickCtx.planet) : undefined;
        if (task?.host && !may(can(), task.host, 'attach')) return refuse(refusal.kept(can()), task.host.open);
        try {
          const changed = await hostApi.pick(family, pickCtx);
          if (changed) await get().refreshHost();
        } catch (e) {
          get().toast({ tone: 'danger', text: `${can().name}: ${errorMessage(e)}`, timeout: 8000 });
        }
      },
      hostAction: async (id, actionCtx) => {
        if (!hostApi?.action) return false;
        try {
          const changed = await hostApi.action(id, actionCtx);
          if (changed) await get().refreshHost();
          return !!changed;
        } catch (e) {
          get().toast({ tone: 'danger', text: `${can().name}: ${errorMessage(e)}`, timeout: 8000 });
          return false;
        }
      },

      hostTaskIds: () => new Set(get().tasks.filter((t) => t.host && !t.host.pending).map((t) => t.id)),
      adoptProject: async (projectId) => {
        const a = can();
        const project = get().projects.find((p) => p.id === projectId);
        if (!project || project.host) return 0;
        if (!a.adopt || !hostApi?.adopt) {
          refuse(refusal.adopt(a));
          return 0;
        }
        if (a.locked) {
          refuse(a.locked);
          return 0;
        }
        const own = get().tasks.filter((t) => t.projectId === projectId && !t.host);
        const batch: AdoptBatch = {
          name: project.name,
          tasks: own.map((t) => ({ id: t.id, title: t.title, notes: t.notes ?? '', due: t.due ?? null, priority: t.priority, status: t.status === 'done' ? 'done' : 'todo' })),
        };
        let answer: Awaited<ReturnType<NonNullable<OrbitHost['adopt']>>>;
        try {
          answer = await hostApi.adopt(batch);
        } catch (e) {
          // nothing has changed here: every task stays ORBIT's own
          get().toast({ tone: 'danger', text: `${a.name}: ${errorMessage(e)}`, timeout: 8000 });
          return 0;
        }
        if (!answer) return 0; // the person cancelled in the host's dialog
        const offered = new Set(own.map((t) => t.id));
        const map = new Map<string, string>();
        for (const [from, to] of Object.entries(answer.map ?? {})) if (offered.has(from) && typeof to === 'string' && to.trim() && !map.has(from)) map.set(from, to);
        if (!map.size) {
          get().toast({ text: `${a.name} took none of the tasks; they stay here.` });
          return 0;
        }
        // 1. what ORBIT keeps for each task the host took: a working-state row under the host's id
        const t0 = now();
        const rows: TaskWork[] = own
          .filter((t) => map.has(t.id))
          .map((t) => ({ ...workOf({ ...t, dependsOn: t.dependsOn.map((d) => map.get(d) ?? d) }, t0), id: map.get(t.id)! }));
        set({ taskWork: [...get().taskWork.filter((w) => !rows.some((r) => r.id === w.id)), ...rows] });
        putMany('taskWork', rows);
        // 2. ORBIT's own copies go (first, so nothing below writes them again)…
        const gone = new Set(map.keys());
        const left = get().tasks.filter((t) => t.projectId === projectId && !t.host && !gone.has(t.id));
        set({ tasks: get().tasks.filter((t) => !gone.has(t.id)) });
        del('tasks', [...gone]);
        // 3. …and checkpoints, sessions, day items, captures, focus and other tasks' dependencies follow each task
        for (const [from, to] of map) repoint(from, to);
        // 4. the system goes too when nothing is left in it
        if (!left.length) {
          set({
            projects: get().projects.filter((p) => p.id !== projectId),
            selection: get().selection?.type === 'project' && get().selection?.id === projectId ? null : get().selection,
            expanded: get().expanded.filter((x) => x !== projectId),
          });
          del('projects', [projectId]);
        }
        await get().refreshHost();
        get().toast({
          tone: 'success',
          text: left.length
            ? `${a.name} took ${map.size} of ${own.length} tasks; ${left.length} stay${left.length === 1 ? 's' : ''} in “${project.name}”.`
            : `“${project.name}” is now kept by ${a.name} (${map.size} task${map.size === 1 ? '' : 's'}).`,
        });
        return map.size;
      },

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
        if (captureOpen && !can().capture) return refuse(refusal.personal(can()));
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
        if (ref && !onlyPosition(patch)) return refuse(refusal.kept(can()), ref.open);
        patchRow('groups', id, patch);
      },
      deleteGroup: (id) => {
        const ref = ownerOf('groups', id);
        // never deleted from ORBIT, and its systems' tasks are never touched
        if (ref) return refuse(refusal.remove(can()), ref.open);
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
          refuse(intoHost && can().personal ? refusal.galaxy(can(), true) : refusal.personal(can()), intoHost?.open);
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
          if ('groupId' in patch && patch.groupId !== cur.groupId) {
            const into = patch.groupId ? get().groups.find((g) => g.id === patch.groupId) : undefined;
            return refuse(into && !into.host ? refusal.galaxy(can(), false) : refusal.move(can()), cur.host.open);
          }
          const rest: Partial<Project> = { ...patch };
          delete rest.groupId;
          if (!onlyPosition(rest)) return refuse(refusal.kept(can()), cur.host.open);
        } else if (cur && patch.groupId && ownerOf('groups', patch.groupId)) {
          // one of ORBIT's own systems dragged into a host's galaxy
          return refuse(refusal.galaxy(can(), true));
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
        const ref = ownerOf('projects', id);
        // never deleted from ORBIT, and its tasks are never touched
        if (ref) return refuse(refusal.remove(can()), ref.open);
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
          refuse(into?.host ? refusal.kept(can()) : refusal.personal(can()), into?.host?.open);
          return task;
        }
        if (into?.host) {
          // Shown at once under a temporary id; the writer asks the host to create it and swaps in the host's id.
          task.id = `tmp-${uid()}`;
          // Until the host answers, it may be changed like any task it accepts (changes wait for the answer);
          // the host's own caps for it arrive with the answer.
          task.host = { id: task.id, kind: 'task', verse: into.host.verse, caps: { edit: true, status: true, delete: true }, pending: true };
        }
        set({ tasks: [...get().tasks, task] });
        put('tasks', task);
        return task;
      },
      updateTask: (id, patch) => {
        const cur = get().tasks.find((t) => t.id === id);
        const ref = cur?.host;
        const moving = !!cur && 'projectId' in patch && patch.projectId !== cur.projectId;
        const target = moving ? get().projects.find((p) => p.id === patch.projectId) : undefined;
        if (!ref) {
          if (moving && target?.host) return refuse(refusal.task(can(), true));
          patchRow('tasks', id, patch);
          return;
        }
        const keys = Object.keys(patch).filter((k) => k !== 'projectId' || moving);
        const has = (list: readonly string[]) => keys.some((k) => list.includes(k));
        if (has(HOST_FIELDS) && !may(can(), ref, 'edit')) return refuse(refusal.kept(can()), ref.open);
        if (moving) {
          if (!target?.host) return refuse(refusal.task(can(), false));
          if (!may(can(), ref, 'move')) return refuse(refusal.kept(can()), ref.open);
          if (!may(can(), target.host, 'create')) return refuse(refusal.target(can()));
        }
        if ('status' in patch && patch.status !== cur.status && (patch.status === 'parked' || cur.status === 'parked' ? !can().work : !may(can(), ref, 'status')))
          return refuse(refusal.kept(can()), ref.open);
        if (has(WORK_FIELDS) && !can().work) return refuse(refusal.work(can()));
        patchRow('tasks', id, patch);
      },
      deleteTask: (id, reason) => {
        const task = get().tasks.find((t) => t.id === id);
        const ref = task?.host;
        if (task && ref) {
          if (!may(can(), ref, 'delete')) return refuse(refusal.remove(can()), ref.open);
          if (needsReason(ref, 'delete') && !reason?.trim()) return refuse(refusal.reason(can(), 'delete'));
          // Off the screen at once. What ORBIT kept for it is cleaned up only once the host has removed it
          // (writer → removed); if the host refuses, the task comes back (removeRefused).
          removing.set(id, { task, index: get().tasks.indexOf(task) });
          set({ tasks: get().tasks.filter((t) => t.id !== id), selection: get().selection?.id === id ? null : get().selection });
          del('tasks', [id], { reason: reason?.trim() ?? '' });
          return;
        }
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
        if (task.host && !may(can(), task.host, 'status')) return refuse(refusal.kept(can()), task.host.open);
        if (get().focus?.taskId === id) endSession('completed');
        patchRow('tasks', id, { status: 'done', completedAt: now(), parkedAt: null, progress: 100, ...(task.host ? { host: { ...task.host, dropped: false } } : {}) });
        get().toast({
          tone: 'success',
          text: `Completed “${task.title}”.`,
          action: { label: 'Undo', run: () => get().reopenTask(id) },
        });
      },
      reopenTask: (id) => {
        const ref = ownerOf('tasks', id);
        if (ref && !may(can(), ref, 'status')) return refuse(refusal.kept(can()), ref.open);
        patchRow('tasks', id, { status: 'todo', completedAt: null, ...(ref ? { host: { ...ref, dropped: false } } : {}) });
      },
      dropTask: (id, reason) => {
        const task = get().tasks.find((t) => t.id === id);
        if (!task?.host) return;
        if (!may(can(), task.host, 'status')) return refuse(refusal.kept(can()), task.host.open);
        if (needsReason(task.host, 'drop') && !reason?.trim()) return refuse(refusal.reason(can(), 'drop'));
        if (get().focus?.taskId === id) endSession('stopped');
        patchRow('tasks', id, { status: 'done', completedAt: now(), parkedAt: null, host: { ...task.host, dropped: true } }, { reason: reason?.trim() || undefined });
        get().toast({ text: `Dropped “${task.title}”.`, action: { label: 'Undo', run: () => get().reopenTask(id) } });
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
        if (!can().capture) {
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
        if (!get().tasks.some((t) => t.id === task.id)) return null; // refused (and said why)
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
        save(writer.setPrefs(prefs));
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
        if (get().host) {
          // Only ORBIT's own records and working state are replaced (with the host, which keeps them); the host's
          // records are never part of it. Without personal records there is nothing of ORBIT's to restore.
          if (!can().personal) throw new Error(refusal.data(can()));
          const clean = personalOnly(snap, get().hostTaskIds(), new Set([...get().groups, ...get().projects].filter((r) => r.host).map((r) => r.id)));
          await adapter.replaceAll(clean); // atomic on the host's side; throws on failure and nothing changes
          await reloadHosted(clean);
          return;
        }
        await adapter.replaceAll(snap); // throws on failure; caller reports it and nothing changes
        set({ ...snap, selection: null, park: null, resumeFor: null, expanded: [], cycle: snap.focus?.cycleCount ?? 0, lastFocusEnd: null });
      },
      loadExample: async () => {
        // never into a host's store: it would put made-up records among someone's real ones
        if (get().host) return refuse(refusal.example(can()));
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
        if (get().host) return refuse(refusal.example(can()));
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
        if (get().host && !can().personal) return refuse(refusal.data(can()));
        try {
          await get().restore({ ...emptySnapshot(), prefs: { ...DEFAULT_PREFS, theme: get().prefs.theme } });
          get().toast({ text: get().host ? `ORBIT’s own records and working state were erased. Records kept by ${can().name} are untouched.` : 'All ORBIT data on this device was erased.' });
        } catch (e) {
          onSaveError(e);
        }
      },
    };
  });
}

/**
 * What a restore hands a host's store: ORBIT's own records (never a host's: any `host` mark, and any record whose
 * id is a host galaxy or system, is left out) and working state. Rows that point at a task that is neither
 * restored here nor one of the host's tasks now (`hostTaskIds`) are dropped; `taskWork` is only for host tasks.
 */
export function personalOnly(snap: Snapshot, hostTaskIds: Set<string>, hostIds: Set<string> = new Set()): Snapshot {
  const bare = <T extends { id: string; host?: HostRef }>(rows: T[]) =>
    (rows ?? [])
      .filter((r) => !r.host && !hostIds.has(r.id) && !hostTaskIds.has(r.id))
      .map((r) => {
        const { host: _drop, ...rest } = r;
        void _drop;
        return rest as T;
      });
  const tasks = bare(snap.tasks);
  const ids = new Set([...tasks.map((t) => t.id), ...hostTaskIds]);
  const known = (id: string | null | undefined) => !!id && ids.has(id);
  return {
    groups: bare(snap.groups),
    projects: bare(snap.projects),
    tasks: tasks.map((t) => ({ ...t, dependsOn: (t.dependsOn ?? []).filter(known) })),
    checkpoints: (snap.checkpoints ?? []).filter((c) => known(c.taskId)),
    sessions: snap.sessions ?? [],
    captures: snap.captures ?? [],
    dayItems: (snap.dayItems ?? []).filter((d) => known(d.taskId)),
    placements: snap.placements ?? [],
    taskWork: (snap.taskWork ?? []).filter((w) => hostTaskIds.has(w.id)),
    prefs: snap.prefs,
    focus: snap.focus && snap.focus.taskId && !known(snap.focus.taskId) ? null : (snap.focus ?? null),
  };
}

/** The verse ORBIT opens first: the handshake's `start` when it is offered and not hidden, else the first shown. */
export function startVerse(info: Handshake): string {
  const shown = info.verses.filter((v) => v.shown !== false);
  const offered = shown.length ? shown : info.verses;
  return info.start && offered.some((v) => v.id === info.start) ? info.start : offered[0].id;
}

/** Views that make sense with what the host provides (all of them when standalone). */
export function viewAvailable(a: HostAbilities, v: ViewName): boolean {
  if (v === 'today') return a.plans;
  if (v === 'inbox') return a.capture;
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
