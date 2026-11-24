/**
 * Depth: what of a verse is in the sky at one time (PROTOCOL.md, "Depth").
 *
 * A cluster with `enter` is a group that is gone into; a galaxy with `parent` is inside another galaxy. A "scope" is
 * where one is: the top (`TOP`), a group (its cluster id), or inside a galaxy (`galaxyScope(id)`). Every galaxy is
 * shown in exactly one scope. Pure: the adapter lays each scope out with it, and the Universe draws one scope.
 */
import type { Cluster } from './types';

export const TOP = '';
export const galaxyScope = (id: string) => `g:${id}`;
const isGalaxyScope = (scope: string) => scope.startsWith('g:');

export interface DepthGalaxy {
  id: string;
  name: string;
  cluster?: string;
  parent?: string;
}

export interface Depth {
  /** The verse has something to go into. */
  deep: boolean;
  /** The scope a galaxy is shown in. */
  scopeOf(galaxyId: string): string;
  /** Whether this is a scope of the verse (a stale one is not). */
  has(scope: string): boolean;
  /** The scope a scope is inside (null at the top). */
  parentOf(scope: string): string | null;
  /** The groups shown as bodies in a scope (those holding at least one galaxy somewhere inside). */
  groupsIn(scope: string): Cluster[];
  /** Galaxies anywhere inside a group, and the groups directly inside it. */
  count(clusterId: string): { galaxies: number; groups: number };
  /** The galaxies anywhere inside a scope, nearest first. */
  under(scope: string): string[];
  /** From the top down to a scope: each step that was gone into. */
  path(scope: string): { scope: string; name: string }[];
  /** Every scope, the top first, each after the one it is inside. */
  scopes: string[];
}

export function buildDepth(galaxies: DepthGalaxy[], clusters: Cluster[]): Depth {
  const clusterOf = new Map(clusters.map((c) => [c.id, c]));
  const galaxyOf = new Map(galaxies.map((g) => [g.id, g]));
  /** The nearest group at or above a cluster (the top when there is none; a cycle ends at the top). */
  const groupAt = (clusterId: string | undefined): string => {
    const seen = new Set<string>();
    let c = clusterId ? clusterOf.get(clusterId) : undefined;
    while (c && !seen.has(c.id)) {
      if (c.enter) return c.id;
      seen.add(c.id);
      c = c.parent ? clusterOf.get(c.parent) : undefined;
    }
    return TOP;
  };
  const scopeOfGalaxy = (g: DepthGalaxy): string => (g.parent && g.parent !== g.id && galaxyOf.has(g.parent) ? galaxyScope(g.parent) : groupAt(g.cluster));
  const scopeOf = (id: string): string => {
    const g = galaxyOf.get(id);
    return g ? scopeOfGalaxy(g) : TOP;
  };
  const groups = clusters.filter((c) => c.enter);
  const groupParent = (c: Cluster): string => (c.parent && c.parent !== c.id ? groupAt(c.parent) : TOP);
  const inside = new Map<string, string[]>(); // scope -> galaxy ids shown in it
  for (const g of galaxies) {
    const s = scopeOfGalaxy(g);
    inside.set(s, [...(inside.get(s) ?? []), g.id]);
  }
  const subgroups = new Map<string, Cluster[]>(); // scope -> groups directly inside it
  for (const c of groups) {
    const s = groupParent(c);
    if (s === c.id) continue;
    subgroups.set(s, [...(subgroups.get(s) ?? []), c]);
  }
  const totals = new Map<string, number>();
  /** Galaxies in a scope and in everything inside it (groups, and galaxies inside its galaxies). */
  const total = (scope: string, seen = new Set<string>()): number => {
    if (seen.has(scope)) return 0;
    seen.add(scope);
    const known = totals.get(scope);
    if (known !== undefined) return known;
    let n = 0;
    for (const id of inside.get(scope) ?? []) n += 1 + total(galaxyScope(id), seen);
    for (const c of subgroups.get(scope) ?? []) n += total(c.id, seen);
    totals.set(scope, n);
    return n;
  };
  const under = (scope: string, seen = new Set<string>()): string[] => {
    if (seen.has(scope)) return [];
    seen.add(scope);
    const here = inside.get(scope) ?? [];
    return [...here, ...here.flatMap((id) => under(galaxyScope(id), seen)), ...(subgroups.get(scope) ?? []).flatMap((c) => under(c.id, seen))];
  };
  const groupsIn = (scope: string) => (subgroups.get(scope) ?? []).filter((c) => total(c.id) > 0);
  const has = (scope: string): boolean =>
    scope === TOP || (isGalaxyScope(scope) ? (inside.get(scope)?.length ?? 0) > 0 : !!clusterOf.get(scope)?.enter && total(scope) > 0);
  const parentOf = (scope: string): string | null => {
    if (scope === TOP) return null;
    if (isGalaxyScope(scope)) return scopeOf(scope.slice(2));
    const c = clusterOf.get(scope);
    return c ? groupParent(c) : TOP;
  };
  const nameOf = (scope: string) => (isGalaxyScope(scope) ? (galaxyOf.get(scope.slice(2))?.name ?? '') : (clusterOf.get(scope)?.name ?? ''));
  const path = (scope: string) => {
    const out: { scope: string; name: string }[] = [];
    const seen = new Set<string>();
    let s: string | null = scope;
    while (s && s !== TOP && !seen.has(s)) {
      seen.add(s);
      out.unshift({ scope: s, name: nameOf(s) });
      s = parentOf(s);
    }
    return out;
  };
  const scopes: string[] = [];
  const walk = (scope: string) => {
    if (scopes.includes(scope)) return;
    scopes.push(scope);
    for (const c of groupsIn(scope)) walk(c.id);
    for (const id of inside.get(scope) ?? []) if (inside.has(galaxyScope(id))) walk(galaxyScope(id));
  };
  walk(TOP);
  return {
    deep: scopes.length > 1,
    scopeOf,
    has,
    parentOf,
    groupsIn,
    count: (clusterId) => ({ galaxies: total(clusterId), groups: groupsIn(clusterId).length }),
    under: (scope) => under(scope),
    path,
    scopes,
  };
}
