import { describe, expect, it } from 'vitest';
import { buildDepth, galaxyScope, TOP } from '../../src/host/depth';
import { adaptVerse } from '../../src/host/adapt';
import { GALAXY_SPACING } from '../../src/data/layout';
import type { Verse } from '../../src/host/types';
import { resolveLanding } from '../../src/host/verses';

/*
 * Depth (PROTOCOL.md): groups that are gone into, groups inside groups, galaxies inside galaxies; and the
 * adapter laying each level out on its own.
 */

const clusters = [
  { id: 'c-a', name: 'Alpha', enter: true },
  { id: 'c-b', name: 'Beta', enter: true, parent: 'c-a' },
  { id: 'c-plain', name: 'Just an outline', parent: 'c-b' },
  { id: 'c-empty', name: 'Nothing in it', enter: true },
];
const galaxies = [
  { id: 'g1', name: 'One', cluster: 'c-a' },
  { id: 'g2', name: 'Two', cluster: 'c-b' },
  { id: 'g3', name: 'Three', cluster: 'c-plain' },
  { id: 'g4', name: 'Four' },
  { id: 'g5', name: 'Five', parent: 'g4' },
  { id: 'g6', name: 'Six', cluster: 'c-gone' },
];

describe('depth', () => {
  const d = buildDepth(galaxies, clusters);

  it('puts every galaxy in one scope: its group, the group above an outline, the galaxy it is inside, or the top', () => {
    expect(d.scopeOf('g1')).toBe('c-a');
    expect(d.scopeOf('g2')).toBe('c-b');
    expect(d.scopeOf('g3')).toBe('c-b');
    expect(d.scopeOf('g4')).toBe(TOP);
    expect(d.scopeOf('g5')).toBe(galaxyScope('g4'));
    expect(d.scopeOf('g6')).toBe(TOP);
    expect(d.deep).toBe(true);
  });

  it('shows a group as a body where it sits, and never an empty one', () => {
    expect(d.groupsIn(TOP).map((c) => c.id)).toEqual(['c-a']);
    expect(d.groupsIn('c-a').map((c) => c.id)).toEqual(['c-b']);
    expect(d.count('c-a')).toEqual({ galaxies: 3, groups: 1 });
    expect(d.count('c-b')).toEqual({ galaxies: 2, groups: 0 });
    expect(d.has('c-empty')).toBe(false);
    expect(d.has('c-plain')).toBe(false);
    expect(d.has(galaxyScope('g4'))).toBe(true);
    expect(d.has(galaxyScope('g1'))).toBe(false);
  });

  it('knows the way back up, and the path down', () => {
    expect(d.parentOf('c-b')).toBe('c-a');
    expect(d.parentOf('c-a')).toBe(TOP);
    expect(d.parentOf(galaxyScope('g4'))).toBe(TOP);
    expect(d.parentOf(TOP)).toBeNull();
    expect(d.path('c-b')).toEqual([
      { scope: 'c-a', name: 'Alpha' },
      { scope: 'c-b', name: 'Beta' },
    ]);
    expect(d.path(galaxyScope('g4'))).toEqual([{ scope: galaxyScope('g4'), name: 'Four' }]);
    expect(d.path(TOP)).toEqual([]);
    expect(d.scopes).toEqual([TOP, 'c-a', 'c-b', galaxyScope('g4')]);
  });

  it('is flat for a verse with outlines only, and does not hang on a damaged tree', () => {
    const flat = buildDepth(galaxies.slice(0, 2), [{ id: 'c-a', name: 'Alpha' }, { id: 'c-b', name: 'Beta', parent: 'c-a' }]);
    expect(flat.deep).toBe(false);
    expect(flat.scopeOf('g1')).toBe(TOP);
    const loop = buildDepth(
      [{ id: 'g1', name: 'One', cluster: 'x' }, { id: 'g2', name: 'Two', parent: 'g2' }],
      [{ id: 'x', name: 'X', parent: 'y' }, { id: 'y', name: 'Y', parent: 'x' }, { id: 'z', name: 'Z', enter: true, parent: 'z' }],
    );
    expect(loop.scopeOf('g1')).toBe(TOP);
    expect(loop.scopeOf('g2')).toBe(TOP);
    expect(loop.deep).toBe(false);
  });
});

describe('the adapter lays each level out on its own', () => {
  const verse: Verse = {
    verse: 'v',
    rev: '1',
    families: {},
    planets: [],
    clusters,
    galaxies: galaxies.map((g) => ({ ...g })),
    systems: [],
  };

  it('gives a group a place among what is shown with it, and its galaxies places of their own inside', () => {
    const ad = adaptVerse(verse, []);
    const at = new Map(ad.groups.map((g) => [g.id, { x: g.x, y: g.y }]));
    const far = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) >= GALAXY_SPACING * 0.8;
    const alpha = ad.extras.clusters.find((c) => c.id === 'c-a')!.at!;
    const beta = ad.extras.clusters.find((c) => c.id === 'c-b')!.at!;
    expect(ad.extras.clusters.find((c) => c.id === 'c-plain')!.at).toBeUndefined();
    expect(ad.extras.clusters.find((c) => c.id === 'c-empty')!.at).toBeUndefined();
    // the top: the group Alpha, and the galaxies Four and Six, clear of each other
    expect(far(alpha, at.get('g4')!)).toBe(true);
    expect(far(alpha, at.get('g6')!)).toBe(true);
    expect(far(at.get('g4')!, at.get('g6')!)).toBe(true);
    // inside Alpha: the group Beta and the galaxy One
    expect(far(beta, at.get('g1')!)).toBe(true);
    // inside Beta: Two and Three; each level starts from the middle again, so levels share places
    expect(far(at.get('g2')!, at.get('g3')!)).toBe(true);
    expect(at.get('g5')).toEqual(alpha);
    expect(ad.groups.find((g) => g.id === 'g5')!.host!.parent).toBe('g4');
  });

  it('keeps a galaxy where the person put it', () => {
    const ad = adaptVerse(verse, [{ id: 'g|g2', x: 9000, y: -400, updatedAt: 0 }]);
    expect(ad.groups.find((g) => g.id === 'g2')).toMatchObject({ x: 9000, y: -400 });
  });

  it('carries a portal that leads to a galaxy', () => {
    const ad = adaptVerse({ ...verse, systems: [{ id: 's1', galaxy: 'g4', name: 'Way in', portal: { verse: 'v', galaxy: 'g5' } }] }, []);
    expect(ad.projects.find((p) => p.id === 's1')!.host!.portal).toEqual({ verse: 'v', label: undefined, galaxy: 'g5' });
  });
});

describe('landing on a record that is a galaxy in one verse and a system in another', () => {
  const content = {
    groups: [{ id: 'project:a' }, { id: 'project:b' }],
    projects: [{ id: 'project:c' }, { id: 'wp:1' }],
    tasks: [],
    items: {},
  } as unknown as Parameters<typeof resolveLanding>[0];

  it('takes a galaxy id to the system of that id, and a system id to the galaxy of that id', () => {
    expect(resolveLanding(content, { galaxy: 'project:c' }).flight).toEqual({ kind: 'system', id: 'project:c' });
    expect(resolveLanding(content, { galaxy: 'project:a', system: 'project:b' }).flight).toEqual({ kind: 'galaxy', id: 'project:b' });
    // the usual order still holds: a system that is there, then the galaxy
    expect(resolveLanding(content, { galaxy: 'project:a', system: 'wp:1' }).flight).toEqual({ kind: 'system', id: 'wp:1' });
    expect(resolveLanding(content, { galaxy: 'project:a', system: 'wp:gone' }).flight).toEqual({ kind: 'galaxy', id: 'project:a' });
    expect(resolveLanding(content, { galaxy: 'nowhere' })).toEqual({ flight: { kind: 'universe', id: null }, missing: true });
  });

  it('counts the galaxies anywhere inside a group, nearest first', () => {
    expect(buildDepth(galaxies, clusters).under('c-a')).toEqual(['g1', 'g2', 'g3']);
    expect(buildDepth(galaxies, clusters).under(TOP)).toEqual(['g4', 'g6', 'g5', 'g1', 'g2', 'g3']);
  });
});
