import type { Also, Caps, Fact, Open } from './host/types';

export type ID = string;

/** 1 = low, 2 = normal, 3 = high, 4 = critical */
export type Priority = 1 | 2 | 3 | 4;
export type Energy = 'low' | 'medium' | 'high';
/** "Active" is derived from the focus runtime and never stored. */
export type TaskStatus = 'todo' | 'parked' | 'done';
export type DaySlot = 'morning' | 'afternoon' | 'evening' | 'later';
export type TimerMode = 'countdown' | 'flow';
export type SessionKind = 'focus' | 'short-break' | 'long-break';
export type SessionEndReason = 'stopped' | 'parked' | 'completed' | 'switched' | 'finished';

export interface Base {
  id: ID;
  createdAt: number;
  updatedAt: number;
  /** True for records created by "Load example workspace" so they can be removed in one go. */
  example?: boolean;
}

export interface Link {
  id: ID;
  url: string;
  label: string;
}

export interface Subtask {
  id: ID;
  title: string;
  done: boolean;
}

/**
 * Marks a record that a host application owns (see src/host/PROTOCOL.md). Only ever in memory: such
 * records are rebuilt from the host's verse and are never written to storage.
 */
export interface HostRef {
  /** The host's id for the record (the record's own id is the same). */
  id: string;
  kind: 'galaxy' | 'system' | 'task';
  /** The verse it came from. */
  verse: string;
  /** What may be changed on it. Anything missing is false. */
  caps: Caps;
  code?: string;
  status?: string;
  chip?: string;
  note?: string;
  /** A holder the host made up, not a record of its own. */
  virtual?: boolean;
  /** A galaxy that is finished: hidden unless finished galaxies are shown. */
  finished?: boolean;
  /** A task done without being done: shown struck through. */
  dropped?: boolean;
  cluster?: string;
  /** How many things a system stands for, when its planets are only some of them. */
  count?: number;
  facts?: Fact[];
  open?: Open;
  also?: Also[];
}

/** A galaxy in the Universe. Its systems (projects) are positioned relative to (x, y). */
export interface Group extends Base {
  name: string;
  color: string;
  x: number;
  y: number;
  host?: HostRef;
}

export interface Project extends Base {
  name: string;
  color: string;
  icon: string;
  description: string;
  /** Galaxy; null = deep space. */
  groupId: ID | null;
  /** Position relative to its galaxy's centre (or to deep space). */
  x: number;
  y: number;
  archived: boolean;
  host?: HostRef;
}

export interface Task extends Base {
  projectId: ID;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: Priority;
  /** YYYY-MM-DD */
  due: string | null;
  estimateMin: number | null;
  energy: Energy;
  /** Manual progress 0–100; ignored when subtasks exist. */
  progress: number;
  subtasks: Subtask[];
  dependsOn: ID[];
  links: Link[];
  completedAt: number | null;
  parkedAt: number | null;
  host?: HostRef;
}

/**
 * Where a host galaxy or system sits. Keyed `g|<galaxy id>` for a galaxy (shared by every verse) and
 * `<verse id>|<system id>` for a system (relative to its galaxy). Standalone ORBIT does not use it.
 */
export interface Placement {
  id: string;
  x: number;
  y: number;
  updatedAt: number;
}

/** ORBIT's own working state for a task a host owns (id = the host's task id). Nothing writes it yet. */
export interface TaskWork {
  id: ID;
  parked?: boolean;
  parkedAt?: number | null;
  energy?: Energy;
  estimateMin?: number | null;
  progress?: number;
  subtasks?: Subtask[];
  dependsOn?: ID[];
  links?: Link[];
  updatedAt: number;
}

export interface TimerSnapshot {
  kind: SessionKind;
  mode: TimerMode;
  plannedMs: number | null;
  elapsedMs: number;
}

export interface Checkpoint extends Base {
  taskId: ID;
  doing: string;
  stoppedAt: string;
  nextAction: string;
  notes: string;
  links: Link[];
  timer: TimerSnapshot | null;
  resumedAt: number | null;
  /** True when created by a one-tap switch rather than the park sheet. */
  auto: boolean;
}

export interface FocusSession extends Base {
  taskId: ID | null;
  kind: SessionKind;
  mode: TimerMode;
  plannedMs: number | null;
  startedAt: number;
  endedAt: number | null;
  /** Time actually spent running in this session (excludes pauses and carried-over time). */
  activeMs: number;
  notes: string;
  distractions: number;
  endReason: SessionEndReason | null;
}

export interface Capture extends Base {
  text: string;
  kind: 'thought' | 'task';
  source: 'quick' | 'focus' | 'voice';
  status: 'inbox' | 'sorted' | 'dismissed';
  contextTaskId: ID | null;
  sortedTaskId: ID | null;
}

export interface DayItem extends Base {
  /** YYYY-MM-DD */
  date: string;
  taskId: ID;
  slot: DaySlot;
  order: number;
  /** HH:MM, optional time block */
  start: string | null;
}

export interface Prefs {
  theme: 'dark' | 'light' | 'system';
  motion: 'system' | 'reduce' | 'full';
  sound: boolean;
  notifications: boolean;
  focusMin: number;
  shortBreakMin: number;
  longBreakMin: number;
  longBreakEvery: number;
  nextEnergy: Energy;
  nextMinutes: number;
  /** Centre of "deep space", where projects without a galaxy live. */
  deepSpace: { x: number; y: number };
  /** What the Universe draws besides tasks when a host provides it. */
  layers: { moons: boolean; belts: boolean; beacons: boolean };
  updatedAt: number;
}

/** The single live focus session. Exactly one key exists, so only one session can be active. */
export interface FocusRuntime {
  sessionId: ID;
  taskId: ID | null;
  kind: SessionKind;
  mode: TimerMode;
  plannedMs: number | null;
  /** Time carried over from a checkpoint (shown on the clock, not counted again in this session). */
  baseMs: number;
  /** Running time accumulated before the current run segment. */
  accumulatedMs: number;
  /** Epoch ms when the current run segment started; null when paused. */
  runningSince: number | null;
  /** Epoch ms when a countdown crossed zero (overtime begins); null until then. */
  finishedAt: number | null;
  /** Checkpoint this session resumed from, if any. */
  fromCheckpointId: ID | null;
  /** Count of completed focus sessions in the current cycle, used to suggest long breaks. */
  cycleCount: number;
}

export interface Tombstone {
  id: ID;
  table: TableName;
  deletedAt: number;
}

export type TableName =
  | 'projects'
  | 'groups'
  | 'tasks'
  | 'checkpoints'
  | 'sessions'
  | 'captures'
  | 'dayItems'
  | 'placements'
  | 'taskWork';

export interface Snapshot {
  projects: Project[];
  groups: Group[];
  tasks: Task[];
  checkpoints: Checkpoint[];
  sessions: FocusSession[];
  captures: Capture[];
  dayItems: DayItem[];
  placements: Placement[];
  taskWork: TaskWork[];
  prefs: Prefs;
  focus: FocusRuntime | null;
}

export type ViewName = 'universe' | 'today' | 'focus' | 'inbox' | 'next' | 'insights' | 'settings';
