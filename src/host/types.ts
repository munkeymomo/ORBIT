/**
 * Host protocol 1, as TypeScript. Mirrors host-protocol-v1.schema.json (the contract) and PROTOCOL.md.
 * Kinds and families are the host's own strings; ORBIT gives them no meaning beyond a label and a colour.
 */
import type { StorageAdapter } from '../data/storage';
import type { Priority } from '../types';

export const HOST_PROTOCOL = 1 as const;

export type Day = string;

/** What may be changed on one record. Anything missing is false. */
export interface Caps {
  edit?: boolean;
  status?: boolean;
  move?: boolean;
  delete?: boolean;
  /** On a system: planets may be added to it. */
  create?: boolean;
  /** On a task: attachments may be added or taken off. */
  attach?: boolean;
  /** Changes the host only accepts with a reason. */
  reason?: ('delete' | 'drop')[];
}

/** Something the host can show on a page of its own. Opaque to ORBIT; handed back to host.open(). */
export interface Open {
  kind: string;
  id: string;
  label?: string;
}

/** The same record (or galaxy) in another verse: a wormhole. */
export interface Also {
  verse: string;
  galaxy?: string;
  system?: string;
  object?: string;
  note?: string;
}

export interface Family {
  label: string;
  /** #rrggbb */
  color: string;
}

export interface Fact {
  label: string;
  value: string;
}

export interface VerseInfo {
  id: string;
  name: string;
  /** The plain word shown under the name. */
  plain: string;
  /** One line: what size, colour, ring and moons mean here. */
  legend: string;
  editable: boolean;
  /** False when the person has hidden this verse. */
  shown?: boolean;
}

/** What the host allows as a whole. */
export interface HostCaps {
  /** Host-owned tasks can be changed. */
  write?: boolean;
  /** The host keeps ORBIT's own galaxies, projects and tasks. */
  personal?: boolean;
  /** The host keeps working state (parking, sessions, the day plan) for its tasks. */
  work?: boolean;
  /** Families host.pick() answers. */
  pick?: string[];
  /** Ids host.action() answers. */
  actions?: string[];
  /** host.adopt() takes ORBIT's own systems ("Move to <host>…"). */
  adopt?: boolean;
}

export interface Handshake {
  protocol: number;
  host: { name: string; version?: string };
  orbit_build?: { version?: string; commit?: string; sha256?: string };
  caps: HostCaps;
  verses: VerseInfo[];
  /** The verse to open first. */
  start?: string;
  /** The host's own words for a few fixed strings. */
  labels?: { open?: string; stored?: string };
  /** Set while the host refuses changes to its records; the text says why. */
  locked?: string;
}

export interface Unchanged {
  verse: string;
  rev: string;
  unchanged: true;
}

export interface Galaxy {
  id: string;
  name: string;
  color?: string;
  /** Shown on the galaxy's chip. */
  status?: string;
  /** The chip's text, e.g. a kind and a status. */
  chip?: string;
  /** Hidden unless finished galaxies are shown. */
  finished?: boolean;
  cluster?: string;
  /** Not a record of the host's: a holder for loose systems. */
  virtual?: boolean;
  facts?: Fact[];
  caps?: Caps;
  open?: Open;
  also?: Also[];
}

/** A faint label around galaxies that belong together. */
export interface Cluster {
  id: string;
  name: string;
  open?: Open;
}

export interface System {
  id: string;
  /** null = deep space. */
  galaxy: string | null;
  name: string;
  code?: string;
  status?: string;
  note?: string;
  color?: string;
  /** A holder the host made up (e.g. for tasks filed nowhere). */
  virtual?: boolean;
  /** This system leads to another verse. */
  portal?: { verse: string; label?: string };
  /** How many things it stands for, when the planets are only some of them. */
  count?: number;
  facts?: Fact[];
  caps?: Caps;
  open?: Open;
  also?: Also[];
}

export type AttachmentState = 'live' | 'archived' | 'gone';

/** A moon: something a planet uses or holds. */
export interface Attachment {
  id: string;
  /** The host's id for the tie itself, handed back when it is taken off. */
  link?: string;
  kind: string;
  family: string;
  label: string;
  sub?: string;
  state: AttachmentState;
  /** Drawn in red: it changed since it was attached. */
  flag?: 'changed';
  open?: Open;
  also?: Also[];
}

export interface Planet {
  id: string;
  system: string;
  type: 'task' | 'item';
  title: string;
  notes?: string;
  /** Tasks only. */
  status?: 'todo' | 'done';
  /** Done without being done: shown struck through. */
  dropped?: boolean;
  priority?: Priority;
  due?: Day | null;
  completedAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
  /** A short remark from the host shown with the planet. */
  note?: string;
  /** Items: the host's kind. */
  kind?: string;
  /** Items: decides the colour. */
  family?: string;
  sub?: string;
  state?: AttachmentState;
  size?: number;
  ring?: number;
  facts?: Fact[];
  /** Shown outside its home galaxy; its only action is the way home. */
  ghost?: boolean;
  attachments?: Attachment[];
  /** Attachments the host counted but did not send. */
  more?: number;
  caps?: Caps;
  open?: Open;
  also?: Also[];
}

/** A belt: what a system holds that no planet uses. Items when few, counts when many. */
export interface Collection {
  system: string;
  total: number;
  items?: Attachment[];
  /** Counts by family. */
  counts?: Record<string, number>;
  open?: Open;
}

export type BeaconState = 'planned' | 'soon' | 'late' | 'achieved' | 'rescoped';

/** A date that matters: drawn on a galaxy's rim or beside a system. */
export interface Beacon {
  id: string;
  galaxy?: string;
  system?: string;
  code?: string;
  title: string;
  due?: Day | null;
  state: BeaconState;
  /** Open tasks that serve it. */
  serves?: number;
  open?: Open;
}

/** A relation between two planets of one verse (never 'blocked by'). Not drawn yet. */
export interface Arrow {
  from: string;
  to: string;
  label?: string;
}

export interface Verse {
  verse: string;
  /** Changes whenever anything in the verse may have changed. */
  rev: string;
  families: Record<string, Family>;
  clusters?: Cluster[];
  galaxies: Galaxy[];
  systems: System[];
  planets: Planet[];
  collections?: Collection[];
  beacons?: Beacon[];
  arrows?: Arrow[];
}

/** The fields of a task a host may let ORBIT change. */
export interface TaskFields {
  title: string;
  notes: string;
  priority: Priority;
  due: Day | null;
}

/**
 * Changes to host-owned tasks (PROTOCOL.md, "Changing host tasks"). Each resolves with the task as the host now
 * has it, or rejects with an Error whose message is the reason shown to the person.
 */
export interface HostTasks {
  /** A new task in a system whose caps allow `create`. ORBIT sends `priority` always, `notes` and `due` when set. */
  create(fields: Partial<TaskFields> & { title: string; system: string }): Promise<Planet>;
  /** Only the fields that changed. `system` when the task moves to another system (caps `move`). */
  update(id: string, patch: Partial<TaskFields> & { system?: string }): Promise<Planet>;
  /** `reason` is sent when the person gave one (always for `dropped` when the task's caps.reason has `drop`). */
  setStatus(id: string, status: 'todo' | 'done' | 'dropped', reason?: string): Promise<Planet>;
  /** `reason` is '' when the task's caps.reason does not have `delete`. */
  remove(id: string, reason: string): Promise<void>;
  /** Takes an attachment off: `link` is the attachment's `link`. */
  detach(id: string, link: string): Promise<void>;
}

/** One of ORBIT's own tasks, as it is offered to the host by `adopt()`. */
export interface AdoptTask {
  /** ORBIT's id for it (the key of the map the host answers with). */
  id: string;
  title: string;
  notes: string;
  due: Day | null;
  priority: Priority;
  /** ORBIT's parked is `todo`. */
  status: 'todo' | 'done';
}

/** One of ORBIT's own systems, with its tasks, offered to the host ("Move to <host>…"). */
export interface AdoptBatch {
  /** The system's name. */
  name: string;
  tasks: AdoptTask[];
}

/** What the host took: ORBIT's task id → the host's planet id. Tasks missing from the map stay with ORBIT. */
export interface AdoptResult {
  map: Record<string, string>;
}

/** `host.at`: where ORBIT goes first. The most precise id ORBIT has wins (planet, then system, then galaxy). */
export interface StartAt {
  galaxy?: string;
  system?: string;
  planet?: string;
}

/** What a host puts on `window.orbitHost` (see PROTOCOL.md). */
export interface OrbitHost {
  protocol: number;
  handshake(): Promise<Handshake>;
  /** One verse. With `since` (a `rev` ORBIT already has) the host may answer `{verse, rev, unchanged: true}`. */
  verse(id: string, since?: string): Promise<Verse | Unchanged>;
  /** Show something on a page of the host's own. */
  open(target: { kind: string; id: string }): void;
  /** Where ORBIT keeps what is its own (positions, preferences, working state and personal records). */
  store: StorageAdapter;
  /** Changes to host-owned tasks. A refusal rejects with an Error whose message is the reason shown. */
  tasks?: HostTasks;
  /** The host shows a picker of its own and attaches what was chosen. Resolves when done (true = changed). */
  pick?(family: string, ctx: { planet?: string; system?: string; galaxy?: string }): Promise<boolean>;
  /** Anything else the host does in a dialog of its own. */
  action?(id: string, ctx: Record<string, string>): Promise<boolean>;
  /**
   * Where to fly when ORBIT starts, read once after the first verse has loaded: into this galaxy or system, or
   * select this planet and fly to its system. Ids ORBIT does not have are ignored. Not part of the JSON documents.
   */
  at?: StartAt;
  /**
   * Take one of ORBIT's own systems and its tasks (offered when `handshake.caps.adopt`). The host shows a dialog
   * of its own (where to put them, what moves) and creates the tasks. Resolves `null` when the person cancels,
   * otherwise with the tasks it took (all, some or none).
   */
  adopt?(batch: AdoptBatch): Promise<AdoptResult | null>;
}

export function isUnchanged(v: Verse | Unchanged): v is Unchanged {
  return (v as Unchanged).unchanged === true;
}
