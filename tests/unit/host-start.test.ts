import { describe, expect, it } from 'vitest';
import { createFakeHost, type FakeHost } from '../../src/host/fakeHost';
import { createOrbitStore, startVerse } from '../../src/store/store';
import { MemoryAdapter } from '../../src/data/storage';
import type { Handshake, StartAt } from '../../src/host/types';

/* Small protocol additions: host.at, hidden verses, and saying once when the host's store or tasks refuse. */

const NOW = Date.UTC(2026, 10, 10, 9, 0, 0);

async function start(host: FakeHost) {
  const info = await host.handshake();
  const store = createOrbitStore({ now: () => NOW });
  await store.getState().init(new MemoryAdapter(), null, { host: { host, info } });
  await store.getState().hostSettled();
  return store;
}

describe('host.at: where ORBIT goes first', () => {
  const at = async (a: StartAt | undefined) => {
    const s = (await start(createFakeHost({ now: NOW, editable: true, at: a }))).getState();
    return { flight: s.flight && { kind: s.flight.kind, id: s.flight.id }, selection: s.selection };
  };
  it('a planet: selected, and ORBIT flies to its system', async () => {
    expect(await at({ planet: 't-compost' })).toEqual({ flight: { kind: 'system', id: 's-beds' }, selection: { type: 'task', id: 't-compost' } });
  });
  it('a system, or a galaxy', async () => {
    expect(await at({ system: 's-packing' })).toEqual({ flight: { kind: 'system', id: 's-packing' }, selection: null });
    expect(await at({ galaxy: 'g-bakery' })).toEqual({ flight: { kind: 'galaxy', id: 'g-bakery' }, selection: null });
  });
  it('the most precise id it has wins; unknown ids are ignored', async () => {
    expect(await at({ galaxy: 'g-bakery', system: 's-orders', planet: 'nope' })).toEqual({ flight: { kind: 'system', id: 's-orders' }, selection: null });
    expect(await at({ galaxy: 'nope', system: 'nope', planet: 'nope' })).toEqual({ flight: null, selection: null });
    expect(await at(undefined)).toEqual({ flight: null, selection: null });
    // an item planet is not a task ORBIT has: ignored
    expect(await at({ planet: 'i-oven' })).toEqual({ flight: null, selection: null });
  });
});

describe('hidden verses', () => {
  const info = (verses: Handshake['verses'], start?: string): Handshake => ({ protocol: 1, host: { name: 'H' }, caps: {}, verses, start });
  const v = (id: string, shown?: boolean) => ({ id, name: id, plain: 'tasks', legend: '', editable: false, ...(shown === undefined ? {} : { shown }) });
  it('a start verse that is not shown falls back to the first shown one', () => {
    expect(startVerse(info([v('a'), v('b')], 'b'))).toBe('b');
    expect(startVerse(info([v('a', false), v('b'), v('c', false)], 'c'))).toBe('b');
    expect(startVerse(info([v('a', false), v('b', true)]))).toBe('b');
    expect(startVerse(info([v('a', false)], 'a'))).toBe('a'); // none shown: the first one
    expect(startVerse(info([v('a'), v('b')], 'zz'))).toBe('a');
  });
  it('the store asks the host for the verse it chose', async () => {
    const host = createFakeHost({ now: NOW, editable: true });
    const asked: string[] = [];
    const hs = host.handshake.bind(host);
    host.handshake = async () => ({ ...(await hs()), verses: [v('hidden', false), v('main')], start: 'hidden' });
    const verse = host.verse.bind(host);
    host.verse = (id, since) => (asked.push(id), verse(id, since));
    const s = (await start(host)).getState();
    expect(asked[0]).toBe('main');
    expect(s.host?.verseId).toBe('main');
  });
});

describe('saying once when the host refuses', () => {
  it('a store write that rejects is reported once, in the host’s words, while it lasts', async () => {
    const host = createFakeHost({ now: NOW, editable: true, personal: true });
    const store = await start(host);
    const s = () => store.getState();
    host.store.failWrites = true;
    const p = s().createProject({ name: 'Mine' });
    s().createTask({ projectId: p.id, title: 'One' });
    s().createTask({ projectId: p.id, title: 'Two' });
    s().updateGroup('g-garden', { x: 1, y: 2 });
    s().planTask('t-compost', '2026-11-10', 'morning');
    await new Promise((r) => setTimeout(r, 10));
    const said = s().toasts.filter((t) => /Could not save/.test(t.text));
    expect(said).toHaveLength(1);
    expect(said[0].text).toMatch(/^Could not save with Demo host\. Your change is still on screen/);
    // still on screen
    expect(s().tasks.filter((t) => t.projectId === p.id)).toHaveLength(2);
  });

  it('the same refusal from host.tasks is not stacked', async () => {
    const host = createFakeHost({ now: NOW, editable: true });
    const store = await start(host);
    const s = () => store.getState();
    host.refuseAlways('t-compost', 'Frozen for the audit.');
    s().updateTask('t-compost', { title: 'A' });
    s().updateTask('t-compost', { priority: 4 });
    s().completeTask('t-compost');
    await s().hostSettled();
    expect(s().toasts.filter((t) => t.text === 'Frozen for the audit.')).toHaveLength(1);
  });
});
