/**
 * What the verse on screen holds (hosted with several verses): the work verse's records live in `groups`,
 * `projects`, `tasks` and the host slice; another verse's in `host.sky`. Panels and the Universe read through these,
 * everything that works on tasks keeps reading `tasks` (always the work verse's).
 */
import type { Group, Project } from '../types';
import type { HostExtras, ItemPlanet } from '../host/adapt';
import type { OrbitState } from './store';

export const shownGroups = (s: OrbitState): Group[] => s.host?.sky?.groups ?? s.groups;
export const shownProjects = (s: OrbitState): Project[] => s.host?.sky?.projects ?? s.projects;
/** Families, belts, dates, clusters, items and arrows of the verse on screen (null standalone). */
export const shownExtras = (s: OrbitState): HostExtras | null => (s.host ? (s.host.sky ?? s.host) : null);

export function findItem(s: OrbitState, id: string): ItemPlanet | undefined {
  const items = shownExtras(s)?.items;
  if (!items) return undefined;
  for (const list of Object.values(items)) {
    const it = list.find((x) => x.id === id);
    if (it) return it;
  }
  return undefined;
}
