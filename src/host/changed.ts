/**
 * "Something changed", seen from far away. A moon (an attachment) can carry `flag: 'changed'`: it changed since it
 * was attached. ORBIT adds no protocol field for what follows; it derives it from the moons that were sent
 * (`more`, the ones the host counted but did not send, never count):
 *
 *   - a planet (a task or an item) with at least one changed moon is MARKED;
 *   - a system holds the marked planets of its open tasks and its own (not ghost) items, and the number of changed
 *     moons in them;
 *   - a galaxy sums its systems.
 *
 * A done or dropped task is not marked (it is out of the sky unless asked for), and a ghost item is not marked
 * (it lives elsewhere; its home system counts it). The work verse's Today and Next are not affected: "changed" is
 * not a task state.
 */
import type { Task } from '../types';
import type { Attachment } from './types';
import type { ItemPlanet, MoonSet } from './adapt';

/** The moons of a planet that changed since they were attached (among those sent). */
export function changedMoons(set?: MoonSet): Attachment[] {
  return set ? set.items.filter((m) => m.flag === 'changed') : [];
}

/** A marked planet and its changed moons. */
export interface ChangedPlanet {
  id: string;
  title: string;
  type: 'task' | 'item';
  system: string;
  moons: Attachment[];
}

/** A system's marked planets (tasks first, then items, each in the order the model draws them) and its changed moons. */
export interface ChangedIn {
  planets: ChangedPlanet[];
  moons: number;
}

export const NO_CHANGED: ChangedIn = { planets: [], moons: 0 };

export function changedInSystem(systemId: string, tasks: Task[], attachments: Record<string, MoonSet>, items: ItemPlanet[]): ChangedIn {
  const planets: ChangedPlanet[] = [];
  for (const t of tasks) {
    if (t.status === 'done') continue;
    const moons = changedMoons(attachments[t.id]);
    if (moons.length) planets.push({ id: t.id, title: t.title, type: 'task', system: systemId, moons });
  }
  for (const it of items) {
    if (it.ghost) continue;
    const moons = changedMoons(it.moons);
    if (moons.length) planets.push({ id: it.id, title: it.title, type: 'item', system: systemId, moons });
  }
  return planets.length ? { planets, moons: planets.reduce((n, p) => n + p.moons.length, 0) } : NO_CHANGED;
}

/** "3 changed". */
export const changedText = (n: number) => `${n} changed`;
