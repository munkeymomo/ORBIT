/**
 * Several verses: the same host records arranged differently. Pure helpers the store uses (and tests call):
 * which verses are offered, which one holds the tasks ORBIT works on, and where to land after switching.
 */
import type { Group, Project, Task } from '../types';
import type { Handshake, VerseInfo } from './types';
import type { ItemPlanet } from './adapt';

/** The verses offered to the person: those not hidden (all of them when every one is hidden, as before). */
export function offeredVerses(info: Handshake): VerseInfo[] {
  const verses = Array.isArray(info.verses) ? info.verses.filter((v) => v && typeof v.id === 'string' && v.id) : [];
  const shown = verses.filter((v) => v.shown !== false);
  return shown.length ? shown : verses;
}

/** The verse ORBIT opens first: the handshake's `start` when it is offered and not hidden, else the first shown. */
export function startVerse(info: Handshake): string {
  const offered = offeredVerses(info);
  return (offered.find((v) => v.id === info.start) ?? offered[0])?.id ?? info.verses[0]?.id ?? '';
}

/**
 * The verse whose tasks ORBIT works on (the dock, focus, Today, Next, the inbox, Insights, task search): the first
 * offered verse with `editable: true`, else the verse ORBIT opens first. Its tasks stay loaded and refreshed
 * whichever verse is on screen; task planets of any other verse are not shown.
 */
export function workVerseOf(info: Handshake): string {
  return offeredVerses(info).find((v) => v.editable)?.id ?? startVerse(info);
}

/** Where to go in a verse just switched to (a wormhole's target, or the galaxy the person was in). */
export interface Landing {
  galaxy?: string;
  system?: string;
  /** A planet (task or item) or an attachment id. */
  object?: string;
}

/** What a verse holds, enough to resolve a landing. */
export interface VerseContent {
  groups: Pick<Group, 'id'>[];
  projects: Pick<Project, 'id' | 'groupId'>[];
  tasks: Pick<Task, 'id' | 'projectId'>[];
  items: Record<string, Pick<ItemPlanet, 'id' | 'system' | 'moons'>[]>;
}

export interface Resolved {
  flight: { kind: 'universe' | 'galaxy' | 'system'; id: string | null };
  select?: { type: 'task' | 'item'; id: string };
  /** The most precise thing asked for was not there (so the person is told). */
  missing: boolean;
}

/**
 * The most precise target the verse has: an object (a task or item: select it and fly to its system; an attachment:
 * fly to the system of the first planet that has it), then a system, then a galaxy, then the whole verse.
 */
export function resolveLanding(c: VerseContent, land: Landing | undefined): Resolved {
  if (!land) return { flight: { kind: 'universe', id: null }, missing: false };
  const asked = land.object ? 'object' : land.system ? 'system' : land.galaxy ? 'galaxy' : null;
  if (land.object) {
    const t = c.tasks.find((x) => x.id === land.object);
    if (t) return { flight: { kind: 'system', id: t.projectId }, select: { type: 'task', id: t.id }, missing: false };
    for (const list of Object.values(c.items)) {
      const it = list.find((x) => x.id === land.object);
      if (it) return { flight: { kind: 'system', id: it.system }, select: { type: 'item', id: it.id }, missing: false };
    }
    for (const list of Object.values(c.items)) {
      const holder = list.find((x) => x.moons.items.some((m) => m.id === land.object));
      if (holder) return { flight: { kind: 'system', id: holder.system }, select: { type: 'item', id: holder.id }, missing: false };
    }
  }
  if (land.system && c.projects.some((p) => p.id === land.system)) return { flight: { kind: 'system', id: land.system }, missing: asked !== 'system' };
  if (land.galaxy && c.groups.some((g) => g.id === land.galaxy)) return { flight: { kind: 'galaxy', id: land.galaxy }, missing: asked !== 'galaxy' };
  return { flight: { kind: 'universe', id: null }, missing: asked !== null };
}

/** Told just before the verse on screen changes, while the old sky is still drawn (for the crossfade). */
const listeners = new Set<() => void>();
export const verseSwitch = {
  on(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
  emit() {
    for (const fn of listeners) fn();
  },
};
