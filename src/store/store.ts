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
  Link,
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

/* ---------------- UI-only types ---------------- */

export type Selection = { type: 'task' | 'project' | 'group'; id: string } | null;

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

  // lifecycle
  init: (adapter: StorageAdapter, storageError?: string | null) => Promise<void>;

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
    const put = (table: TableName, rec: { id: string }) => save(adapter.put(table, rec));
    const putMany = (table: TableName, recs: { id: string }[]) => save(adapter.bulkPut(table, recs));
    const del = (table: TableName, ids: string[]) => save(adapter.remove(table, ids));
    const setFocusRt = (rt: FocusRuntime | null) => {
      set({ focus: rt });
      save(adapter.setFocus(rt));
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
      filter: { query: '', dueSoon: false, highPriority: false, parkedOnly: false, showDone: false, groupId: null },
      cycle: 0,
      lastFocusEnd: null,
      dayDate: toDateKey(now()),
      flight: null,

      /* ---------- lifecycle ---------- */

      init: async (a, storageError = null) => {
        adapter = a;
        let snap: Snapshot;
        try {
          snap = await a.load();
        } catch (e) {
          console.error(e);
          snap = emptySnapshot();
          storageError = `Could not read saved data: ${e instanceof Error ? e.message : String(e)}`;
        }
        set({ ...snap, ready: true, storageKind: a.kind, storageError, cycle: snap.focus?.cycleCount ?? 0 });
        get().tick();
      },

      /* ---------- navigation & UI ---------- */

      setView: (view) => set({ view }),
      select: (selection) => set({ selection }),
      toast: (t) => {
        const id = uid();
        set({ toasts: [...get().toasts.slice(-3), { ...t, id }] });
      },
      dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
      confirm: (confirmReq) => set({ confirmReq }),
      setCaptureOpen: (captureOpen) => set({ captureOpen }),
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
        const taken: Pt[] = get().groups.map((g) => ({ x: g.x, y: g.y }));
        const groupIds = new Set(get().groups.map((g) => g.id));
        if (get().projects.some((p) => !p.groupId || !groupIds.has(p.groupId))) taken.push(get().prefs.deepSpace);
        const spot = at ?? nextGalaxySpot(taken);
        const g: Group = { id: uid(), createdAt: t, updatedAt: t, name: name.trim() || 'Galaxy', color: color ?? nextUnusedColor(get().groups.map((x) => x.color)), x: spot.x, y: spot.y };
        set({ groups: [...get().groups, g] });
        put('groups', g);
        return g;
      },
      updateGroup: (id, patch) => void patchRow('groups', id, patch),
      deleteGroup: (id) => {
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
        if (!input.groupId) claimDeepSpace();
        const t = now();
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
      setDeepSpace: (at) => get().setPrefs({ deepSpace: { x: Math.round(at.x), y: Math.round(at.y) } }),
      deleteProject: (id) => {
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
        set({ tasks: [...get().tasks, task] });
        put('tasks', task);
        return task;
      },
      updateTask: (id, patch) => void patchRow('tasks', id, patch),
      deleteTask: (id) => {
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
        if (get().focus?.taskId === id) endSession('completed');
        patchRow('tasks', id, { status: 'done', completedAt: now(), parkedAt: null, progress: 100 });
        get().toast({
          tone: 'success',
          text: `Completed “${task.title}”.`,
          action: { label: 'Undo', run: () => get().reopenTask(id) },
        });
      },
      reopenTask: (id) => void patchRow('tasks', id, { status: 'todo', completedAt: null }),

      /* ---------- focus ---------- */

      startFocus: (o) => {
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

      openPark: (park) => set({ park }),
      parkTask: (taskId, input, opts) => {
        const t = now();
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
      openResume: (resumeFor) => set({ resumeFor }),
      resumeTask: (taskId, timer) => {
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
        return {
          projects: s.projects,
          groups: s.groups,
          tasks: s.tasks,
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
        await adapter.replaceAll(snap); // throws on failure; caller reports it and nothing changes
        set({ ...snap, selection: null, park: null, resumeFor: null, expanded: [], cycle: snap.focus?.cycleCount ?? 0, lastFocusEnd: null });
      },
      loadExample: async () => {
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

/* ---------------- app singleton + hook ---------------- */

export const orbitStore = createOrbitStore();
export function useOrbit<U>(selector: (s: OrbitState) => U): U {
  return useStore(orbitStore, selector);
}
/** Actions are stable, so components can grab them without subscribing. */
useOrbit.getActions = (): OrbitState => orbitStore.getState();
export const orbit = () => orbitStore.getState();
