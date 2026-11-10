import { describe, expect, it, vi } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import schemaText from '../../src/host/host-protocol-v1.schema.json?raw';
import { createFakeHost, type FakeHost } from '../../src/host/fakeHost';
import { createOrbitStore, personalOnly, viewAvailable } from '../../src/store/store';
import { emptySnapshot, MemoryAdapter } from '../../src/data/storage';
import { createBackup, parseBackupText, SCHEMA_VERSION } from '../../src/lib/backup';
import { rankNext } from '../../src/lib/scoring';
import { completedByDay, latestCheckpoints } from '../../src/store/selectors';
import type { Snapshot, TableName } from '../../src/types';

/*
 * ORBIT's own records kept by a host (caps.personal): personal galaxies, systems and tasks beside the host's,
 * one Today and Next across both, hosted backups and restores, and handing a system to the host (adopt).
 */

const NOW = Date.UTC(2026, 10, 10, 9, 0, 0);
const TODAY = '2026-11-10';
const HOST_IDS = /^(g-|s-|t-|i-|m-)/;

function spy(host: FakeHost) {
  const writes: { table: string; ids: string[] }[] = [];
  const s = host.store;
  for (const k of ['put', 'bulkPut', 'remove'] as const) {
    const orig = s[k].bind(s) as (t: TableName, x: never) => Promise<void>;
    (s as unknown as Record<string, unknown>)[k] = (t: TableName, x: unknown) => {
      const rows = Array.isArray(x) ? x : [x];
      writes.push({ table: k === 'remove' ? `-${t}` : t, ids: rows.map((r) => (typeof r === 'string' ? r : (r as { id: string }).id)) });
      return orig(t, x as never);
    };
  }
  const replaced: Snapshot[] = [];
  const replaceAll = s.replaceAll.bind(s);
  s.replaceAll = (snap) => (replaced.push(structuredClone(snap)), replaceAll(snap));
  return { writes, replaced };
}

async function personal(opts: { host?: FakeHost; store?: Snapshot } = {}) {
  const host = opts.host ?? createFakeHost({ now: NOW, editable: true, personal: true });
  if (opts.store) await host.store.replaceAll(opts.store);
  const info = await host.handshake();
  const store = createOrbitStore({ now: () => NOW });
  await store.getState().init(new MemoryAdapter(), null, { host: { host, info } });
  const s = () => store.getState();
  await s().hostSettled();
  const { writes, replaced } = spy(host);
  host.log.length = 0;
  const settle = async () => {
    await s().hostSettled();
    for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
  };
  const toasts = () => s().toasts.map((t) => t.text).join('\n');
  return { host, store, s, writes, replaced, settle, toasts, saved: () => host.store.load() };
}

/** A personal galaxy, system and two tasks (one parked with a checkpoint, one planned today). */
async function withOwn(h: Awaited<ReturnType<typeof personal>>) {
  const g = h.s().createGroup('Reading');
  const p = h.s().createProject({ name: 'Novels', groupId: g.id });
  const a = h.s().createTask({ projectId: p.id, title: 'Finish the long one', priority: 3, due: TODAY, notes: 'Chapter 12', estimateMin: 45, energy: 'low' });
  const b = h.s().createTask({ projectId: p.id, title: 'Pick the next one', dependsOn: [a.id] });
  h.s().updateTask(a.id, { subtasks: [{ id: 'st', title: 'Chapter 12', done: false }], links: [{ id: 'l', url: 'https://example.org', label: 'Notes' }], progress: 40 });
  h.s().parkTask(a.id, { nextAction: 'Read from page 210' });
  h.s().planTask(b.id, TODAY, 'evening');
  await h.settle();
  return { g, p, a: h.s().tasks.find((t) => t.id === a.id)!, b: h.s().tasks.find((t) => t.id === b.id)! };
}

describe('personal records kept by the host', () => {
  it('the handshake with personal and adopt validates against the schema', async () => {
    const schema = JSON.parse(schemaText);
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    ajv.addSchema(schema);
    const v = ajv.getSchema(`${schema.$id}#/$defs/handshake`)!;
    const info = await createFakeHost({ editable: true, personal: true }).handshake();
    expect(info.caps).toMatchObject({ personal: true, adopt: true, work: true, write: true });
    expect(v(info) ? [] : v.errors).toEqual([]);
  });

  it('ORBIT’s own galaxies, systems and tasks go to host.store; the host’s still never do', async () => {
    const h = await personal();
    const own = await withOwn(h);
    // some host-task changes along the way: they go to host.tasks and taskWork, never to the personal tables
    h.s().updateTask('t-compost', { title: 'Turn the compost twice', energy: 'high' });
    h.s().updateProject('s-beds', { x: 50, y: 60 });
    await h.settle();
    const saved = await h.saved();
    expect(saved.groups.map((g) => g.id)).toEqual([own.g.id]);
    expect(saved.projects.map((p) => p.id)).toEqual([own.p.id]);
    expect(saved.tasks.map((t) => t.id).sort()).toEqual([own.a.id, own.b.id].sort());
    expect(saved.tasks.find((t) => t.id === own.a.id)).toMatchObject({ status: 'parked', estimateMin: 45, progress: 40 });
    expect(saved.checkpoints.map((c) => c.taskId)).toEqual([own.a.id]);
    expect(saved.dayItems.map((d) => d.taskId)).toEqual([own.b.id]);
    for (const w of h.writes.filter((w) => /^-?(groups|projects|tasks)$/.test(w.table))) for (const id of w.ids) expect(id).not.toMatch(HOST_IDS);
    expect(saved.taskWork.map((w) => w.id)).toEqual(['t-compost']);
    expect(saved.placements.map((p) => p.id)).toContain('main|s-beds');
    expect(h.host.log.map((l) => l.op)).toEqual(['update']);
    // nothing of ORBIT's own carries a host mark, and every row comes back on the next start
    expect(saved.tasks.every((t) => !t.host) && saved.projects.every((p) => !p.host) && saved.groups.every((g) => !g.host)).toBe(true);
    const again = await personal({ host: h.host });
    expect(again.s().groups.find((g) => g.id === own.g.id)).toMatchObject({ name: 'Reading' });
    expect(again.s().tasks.find((t) => t.id === own.a.id)).toMatchObject({ status: 'parked' });
    expect(again.s().groups.find((g) => g.id === 'g-garden')?.host).toBeDefined();
  });

  it('host galaxies are placed around ORBIT’s own, and deep space holds both kinds', async () => {
    const h = await personal();
    const mine = h.s().createProject({ name: 'Loose reading', groupId: null, x: 0, y: 0 });
    await h.settle();
    const placements = (await h.saved()).placements.map((p) => p.id);
    // deep space was already used by the host's "Odd jobs": ORBIT's own system sits beside it
    expect(h.s().projects.filter((p) => !p.groupId).map((p) => p.id).sort()).toEqual([mine.id, 's-odd'].sort());
    const again = await personal({ host: h.host });
    const deep = again.s().projects.filter((p) => !p.groupId);
    expect(deep.map((p) => p.id).sort()).toEqual([mine.id, 's-odd'].sort());
    const [x, y] = deep;
    expect(Math.hypot(x.x - y.x, x.y - y.y)).toBeGreaterThan(100);
    expect(placements).not.toContain(`main|${mine.id}`);
    // a personal galaxy never sits on a host galaxy
    const g = again.s().createGroup('Mine');
    for (const other of again.s().groups.filter((o) => o.id !== g.id)) expect(Math.hypot(other.x - g.x, other.y - g.y)).toBeGreaterThan(1000);
  });

  it('a galaxy is personal or the host’s: crossing over is refused with a hint', async () => {
    const h = await personal();
    const own = await withOwn(h);
    h.writes.length = 0;
    const before = JSON.stringify({ p: h.s().projects, t: h.s().tasks });

    h.s().updateProject(own.p.id, { groupId: 'g-garden' });
    expect(h.toasts()).toMatch(/Galaxies kept by Demo host hold only its systems/);
    h.s().updateProject('s-beds', { groupId: own.g.id });
    expect(h.toasts()).toMatch(/This system is kept by Demo host and stays in its galaxies/);
    h.s().updateTask(own.a.id, { projectId: 's-beds' });
    expect(h.toasts()).toMatch(/Tasks of ORBIT’s own stay in ORBIT’s systems\. To hand a whole system of your own to Demo host, use “Move to Demo host…”/);
    h.s().updateTask('t-compost', { projectId: own.p.id });
    expect(h.toasts()).toMatch(/Tasks kept by Demo host stay in its systems/);
    const made = h.s().createProject({ name: 'Into theirs', groupId: 'g-garden' });
    expect(h.s().projects.some((p) => p.id === made.id)).toBe(false);
    await h.settle();
    expect(JSON.stringify({ p: h.s().projects, t: h.s().tasks })).toBe(before);
    expect(h.writes).toEqual([]);
    expect(h.host.log).toEqual([]);
    // the same refusal is not stacked twice while it is on screen
    const n = h.s().toasts.length;
    h.s().updateTask(own.a.id, { projectId: 's-beds' });
    expect(h.s().toasts.length).toBe(n);
    // moving between ORBIT's own galaxies (and deep space) still works
    const g2 = h.s().createGroup('Other');
    h.s().updateProject(own.p.id, { groupId: g2.id });
    expect(h.s().projects.find((p) => p.id === own.p.id)?.groupId).toBe(g2.id);
    h.s().updateProject(own.p.id, { groupId: null });
    expect(h.s().projects.find((p) => p.id === own.p.id)?.groupId).toBeNull();
  });

  it('one Today and one What-next across ORBIT’s own and the host’s tasks; Insights counts both', async () => {
    const h = await personal();
    const own = await withOwn(h);
    h.s().planTask('t-trays', TODAY, 'evening');
    expect(viewAvailable(h.s().abilities(), 'today')).toBe(true);
    const evening = h.s().dayItems.filter((d) => d.date === TODAY && d.slot === 'evening').sort((a, b) => a.order - b.order);
    expect(evening.map((d) => d.taskId)).toEqual([own.b.id, 't-trays']);
    const planned = new Map(h.s().dayItems.map((d) => [d.taskId, d]));
    const ranked = rankNext(h.s().tasks, { todayKey: TODAY, availableMin: 60, energy: 'medium', checkpoints: latestCheckpoints(h.s().checkpoints), planned, activeTaskId: null });
    const ids = ranked.suggestions.map((x) => x.task.id);
    expect(ids).toContain('t-trays');
    expect(ids).toContain(own.a.id);
    // b depends on a: blocked, whoever keeps it
    expect(ranked.blocked.map((x) => x.task.id)).toContain(own.b.id);
    h.s().completeTask('t-compost');
    h.s().completeTask(own.b.id);
    await h.settle();
    const day = completedByDay(h.s().tasks, [TODAY], h.s().projects)[0];
    expect(day.total).toBeGreaterThanOrEqual(2);
    expect(day.byProject.map((x) => x.projectId)).toEqual(expect.arrayContaining([own.p.id, 's-beds']));
  });

  it('the example workspace is never loaded into a host’s store', async () => {
    const h = await personal();
    await h.s().loadExample();
    await h.settle();
    expect(h.s().tasks.some((t) => t.example)).toBe(false);
    expect(h.replaced).toEqual([]);
    expect(h.toasts()).toMatch(/example workspace is not offered here/);
  });
});

describe('hosted backup, restore and erase', () => {
  it('a backup holds ORBIT’s own records and working state, never the host’s records', async () => {
    const h = await personal();
    const own = await withOwn(h);
    h.s().parkTask('t-compost', { nextAction: 'Fork it over' });
    h.s().planTask('t-trays', TODAY, 'morning');
    h.s().updateGroup('g-garden', { x: 9000, y: 9000 });
    h.s().addCapture({ text: 'Ask about the shed' });
    await h.settle();
    const file = JSON.parse(JSON.stringify(createBackup(h.s().snapshot(), NOW)));
    expect(file.schemaVersion).toBe(5);
    expect(file.groups.map((g: { id: string }) => g.id)).toEqual([own.g.id]);
    expect(file.projects.map((p: { id: string }) => p.id)).toEqual([own.p.id]);
    expect(file.tasks.map((t: { id: string }) => t.id).sort()).toEqual([own.a.id, own.b.id].sort());
    expect(JSON.stringify([file.groups, file.projects, file.tasks])).not.toMatch(/"host"|g-garden|s-beds|t-compost/);
    // working state, including what is kept for host tasks
    expect(file.taskWork.map((w: { id: string }) => w.id)).toEqual(['t-compost']);
    expect(file.checkpoints.map((c: { taskId: string }) => c.taskId).sort()).toEqual([own.a.id, 't-compost'].sort());
    expect(file.dayItems.map((d: { taskId: string }) => d.taskId).sort()).toEqual([own.b.id, 't-trays'].sort());
    expect(file.placements.map((p: { id: string }) => p.id)).toContain('g|g-garden');
    expect(file.captures).toHaveLength(1);
  });

  it('restores a schema-5 hosted backup: replaceAll once, personal only; working state for host tasks that exist is kept', async () => {
    const h = await personal();
    const own = await withOwn(h);
    h.s().parkTask('t-compost', { nextAction: 'Fork it over' });
    h.s().planTask('t-trays', TODAY, 'morning');
    await h.settle();
    const text = JSON.stringify(createBackup(h.s().snapshot(), NOW));
    // things change after the backup, including on the host's side
    h.s().deleteTask(own.b.id);
    h.s().createGroup('Made later');
    h.host.change((v) => {
      v.planets = v.planets.filter((p) => p.id !== 't-trays');
    });
    await h.s().refreshHost();
    await h.settle();
    const r = parseBackupText(text, { hostTaskIds: h.s().hostTaskIds() });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/day-plan entries pointed to missing tasks/);
    h.replaced.length = 0;
    h.host.log.length = 0;
    await h.s().restore(r.data!);
    await h.settle();
    expect(h.replaced).toHaveLength(1);
    const got = h.replaced[0];
    expect(got.groups.map((g) => g.id)).toEqual([own.g.id]);
    expect(got.tasks.map((t) => t.id).sort()).toEqual([own.a.id, own.b.id].sort());
    expect(JSON.stringify([got.groups, got.projects, got.tasks])).not.toMatch(/"host"/);
    expect(got.taskWork.map((w) => w.id)).toEqual(['t-compost']);
    expect(got.dayItems.map((d) => d.taskId)).toEqual([own.b.id]); // t-trays is gone from the host
    expect(h.host.log).toEqual([]); // nothing asked of host.tasks
    // on screen: the backup's own records, the host's as the host has them, working state laid over again
    expect(h.s().groups.some((g) => g.name === 'Made later')).toBe(false);
    expect(h.s().tasks.find((t) => t.id === own.b.id)).toBeDefined();
    expect(h.s().tasks.find((t) => t.id === 't-compost')).toMatchObject({ status: 'parked' });
    expect(h.s().groups.filter((g) => g.host).length).toBeGreaterThan(3);
  });

  it('restores a schema-4 backup from standalone ORBIT 1.0.0 as all-personal', async () => {
    // standalone ORBIT exports, then the file is made into what 1.0.0 wrote (schema 4: no placements, no taskWork)
    const solo = createOrbitStore({ now: () => NOW });
    await solo.getState().init(new MemoryAdapter());
    const g = solo.getState().createGroup('Home');
    const p = solo.getState().createProject({ name: 'Kitchen', groupId: g.id });
    const t = solo.getState().createTask({ projectId: p.id, title: 'Fix the drawer' });
    solo.getState().parkTask(t.id, { nextAction: 'Buy runners' });
    solo.getState().planTask(t.id, TODAY, 'morning');
    const v4: Record<string, unknown> = { ...createBackup(solo.getState().snapshot(), NOW), schemaVersion: 4 };
    delete v4.placements;
    delete v4.taskWork;
    expect(SCHEMA_VERSION).toBe(5);

    const h = await personal();
    await withOwn(h);
    const r = parseBackupText(JSON.stringify(v4), { hostTaskIds: h.s().hostTaskIds() });
    expect(r.ok).toBe(true);
    await h.s().restore(r.data!);
    await h.settle();
    expect(h.replaced).toHaveLength(1);
    const got = h.replaced[0];
    expect(got.groups.map((x) => x.id)).toEqual([g.id]);
    expect(got.projects.map((x) => x.id)).toEqual([p.id]);
    expect(got.tasks.map((x) => x.id)).toEqual([t.id]);
    expect(got.placements).toEqual([]);
    expect(got.taskWork).toEqual([]);
    // the previous personal records were replaced; the host's are all still here
    expect(h.s().groups.filter((x) => !x.host).map((x) => x.name)).toEqual(['Home']);
    expect(h.s().tasks.find((x) => x.id === t.id)).toMatchObject({ status: 'parked' });
    expect(h.s().dayItems.map((d) => d.taskId)).toEqual([t.id]);
    expect(h.s().tasks.some((x) => x.id === 't-compost' && x.host)).toBe(true);
    // the host's working state was replaced too (the backup had none)
    expect(h.s().taskWork).toEqual([]);
  });

  it('personalOnly drops host marks, host ids and rows that point at nothing', () => {
    const snap: Snapshot = {
      ...emptySnapshot(),
      groups: [{ id: 'mine', name: 'Mine', color: 'lime', x: 0, y: 0, createdAt: 1, updatedAt: 1 }, { id: 'g-garden', name: 'Theirs', color: 'lime', x: 0, y: 0, createdAt: 1, updatedAt: 1 }],
      tasks: [{ id: 'a', projectId: 'p', title: 'A', notes: '', status: 'todo', priority: 2, due: null, estimateMin: null, energy: 'medium', progress: 0, subtasks: [], dependsOn: ['host-1', 'gone'], links: [], completedAt: null, parkedAt: null, createdAt: 1, updatedAt: 1, host: { id: 'x', kind: 'task', verse: 'v', caps: {} } }],
      dayItems: [
        { id: 'd1', taskId: 'host-1', date: TODAY, slot: 'morning', order: 0, start: null, createdAt: 1, updatedAt: 1 },
        { id: 'd2', taskId: 'gone', date: TODAY, slot: 'morning', order: 1, start: null, createdAt: 1, updatedAt: 1 },
      ],
      taskWork: [{ id: 'host-1', updatedAt: 1 }, { id: 'gone', updatedAt: 1 }],
      focus: { sessionId: 's', taskId: 'gone' } as Snapshot['focus'],
    };
    const out = personalOnly(snap, new Set(['host-1']), new Set(['g-garden']));
    expect(out.groups.map((g) => g.id)).toEqual(['mine']);
    expect(out.tasks).toEqual([]); // it carried a host mark
    expect(out.dayItems.map((d) => d.id)).toEqual(['d1']);
    expect(out.taskWork.map((w) => w.id)).toEqual(['host-1']);
    expect(out.focus).toBeNull();
  });

  it('erase replaces ORBIT’s own part with nothing (keeping the theme) and leaves the host’s records', async () => {
    const h = await personal();
    await withOwn(h);
    h.s().setPrefs({ theme: 'light' });
    h.s().parkTask('t-compost', { nextAction: 'x' });
    await h.settle();
    await h.s().resetAll();
    await h.settle();
    expect(h.replaced).toHaveLength(1);
    const got = h.replaced[0];
    expect([got.groups, got.projects, got.tasks, got.checkpoints, got.dayItems, got.taskWork, got.placements].every((x) => x.length === 0)).toBe(true);
    expect(got.prefs.theme).toBe('light');
    expect(h.s().groups.every((g) => g.host)).toBe(true);
    expect(h.s().tasks.find((t) => t.id === 't-compost')).toMatchObject({ status: 'todo' });
    expect(h.toasts()).toMatch(/Records kept by Demo host are untouched/);
  });

  it('without personal records, restore and erase stay refused', async () => {
    const h = await personal({ host: createFakeHost({ now: NOW, editable: true }) });
    await expect(h.s().restore(emptySnapshot())).rejects.toThrow(/Backups, examples and erasing are not available/);
    await h.s().resetAll();
    expect(h.replaced).toEqual([]);
  });
});

describe('Move to <host>… (adopt)', () => {
  async function ready(mode: FakeHost['adoptMode'] = 'all') {
    const h = await personal();
    h.host.adoptMode = mode;
    const own = await withOwn(h);
    // more that points at the tasks: a focus session on b, a capture sorted into a, a host task depending on a
    h.s().startFocus({ taskId: own.b.id });
    h.s().addCapture({ text: 'Find a bookmark', contextTaskId: own.a.id });
    h.s().updateTask('t-compost', { dependsOn: [own.a.id] });
    await h.settle();
    h.writes.length = 0;
    h.host.log.length = 0;
    return { h, own };
  }

  it('is offered only when the host says adopt (with personal and work)', async () => {
    const h = await personal({ host: createFakeHost({ now: NOW, editable: true }) });
    expect(h.s().abilities().adopt).toBe(false);
    const p = await personal();
    expect(p.s().abilities().adopt).toBe(true);
  });

  it('all taken: working state moves to the new ids, every reference follows, the system goes', async () => {
    const { h, own } = await ready('all');
    const n = await h.s().adoptProject(own.p.id);
    await h.settle();
    expect(n).toBe(2);
    const call = h.host.log.find((l) => l.op === 'adopt')!;
    expect(call.args[0]).toEqual({
      name: 'Novels',
      tasks: [
        { id: own.a.id, title: 'Finish the long one', notes: 'Chapter 12', due: TODAY, priority: 3, status: 'todo' },
        { id: own.b.id, title: 'Pick the next one', notes: '', due: null, priority: 2, status: 'todo' },
      ],
    });
    const map = Object.fromEntries(h.host.current().planets.filter((p) => p.system.startsWith('s-taken-')).map((p) => [p.title === 'Finish the long one' ? own.a.id : own.b.id, p.id]));
    const A = map[own.a.id];
    const B = map[own.b.id];
    // the personal copies and the empty system are gone, here and in the store
    const saved = await h.saved();
    expect(saved.tasks).toEqual([]);
    expect(saved.projects).toEqual([]);
    expect(h.s().projects.some((p) => p.id === own.p.id)).toBe(false);
    // the host's tasks are on screen with ORBIT's working state on them
    const a = h.s().tasks.find((t) => t.id === A)!;
    expect(a.host).toBeDefined();
    expect(a).toMatchObject({ status: 'parked', estimateMin: 45, energy: 'low', progress: 40, title: 'Finish the long one' });
    expect(a.subtasks.map((s) => s.id)).toEqual(['st']);
    expect(a.links.map((l) => l.id)).toEqual(['l']);
    expect(h.s().tasks.find((t) => t.id === B)!.dependsOn).toEqual([A]);
    expect(saved.taskWork.find((w) => w.id === A)).toMatchObject({ parked: true, estimateMin: 45, energy: 'low' });
    expect(saved.taskWork.find((w) => w.id === B)).toMatchObject({ dependsOn: [A] });
    // every table that pointed at the old ids now points at the new ones
    expect(saved.checkpoints.map((c) => c.taskId)).toEqual([A]);
    expect(saved.dayItems.map((d) => d.taskId)).toEqual([B]);
    expect(saved.sessions.filter((x) => x.taskId).map((x) => x.taskId)).toEqual([B]);
    expect(saved.captures[0].contextTaskId).toBe(A);
    expect(h.s().focus?.taskId).toBe(B);
    expect(saved.focus?.taskId).toBe(B);
    expect(h.s().tasks.find((t) => t.id === 't-compost')!.dependsOn).toEqual([A]);
    expect(saved.taskWork.find((w) => w.id === 't-compost')!.dependsOn).toEqual([A]);
    // nothing of ORBIT's own was ever written under a host id, and no personal row points at the old ids
    expect(JSON.stringify(saved)).not.toContain(own.a.id);
    expect(JSON.stringify(saved)).not.toContain(own.b.id);
    expect(h.toasts()).toMatch(/“Novels” is now kept by Demo host \(2 tasks\)/);
  });

  it('cancelled in the host’s dialog: nothing changes', async () => {
    const { h, own } = await ready('cancel');
    const before = JSON.stringify(await h.saved());
    expect(await h.s().adoptProject(own.p.id)).toBe(0);
    await h.settle();
    expect(JSON.stringify(await h.saved())).toBe(before);
    expect(h.s().tasks.filter((t) => t.projectId === own.p.id)).toHaveLength(2);
    expect(h.writes).toEqual([]);
  });

  it('the host throws: nothing is lost', async () => {
    const { h, own } = await ready('fail');
    const before = JSON.stringify(await h.saved());
    expect(await h.s().adoptProject(own.p.id)).toBe(0);
    await h.settle();
    expect(JSON.stringify(await h.saved())).toBe(before);
    expect(h.s().projects.some((p) => p.id === own.p.id)).toBe(true);
    expect(h.toasts()).toMatch(/Demo host could not take them just now/);
  });

  it('partly taken: only the tasks in the map move; the system stays with the rest', async () => {
    const { h, own } = await ready('some'); // takes all but the last (b)
    expect(await h.s().adoptProject(own.p.id)).toBe(1);
    await h.settle();
    const A = h.host.current().planets.find((p) => p.title === 'Finish the long one')!.id;
    const saved = await h.saved();
    expect(saved.projects.map((p) => p.id)).toEqual([own.p.id]);
    expect(saved.tasks.map((t) => t.id)).toEqual([own.b.id]);
    // b stays ORBIT's own, depending on the task the host took; its day plan and focus are untouched
    expect(saved.tasks[0].dependsOn).toEqual([A]);
    expect(saved.dayItems.map((d) => d.taskId)).toEqual([own.b.id]);
    expect(h.s().focus?.taskId).toBe(own.b.id);
    expect(saved.checkpoints.map((c) => c.taskId)).toEqual([A]);
    expect(h.toasts()).toMatch(/Demo host took 1 of 2 tasks; 1 stays in “Novels”/);
  });

  it('a map with ids it was not offered, or none at all, changes nothing', async () => {
    const { h, own } = await ready('all');
    h.host.adopt = async () => ({ map: { 'not-offered': 'x', [own.a.id]: '' } });
    const before = JSON.stringify(await h.saved());
    expect(await h.s().adoptProject(own.p.id)).toBe(0);
    await h.settle();
    expect(JSON.stringify(await h.saved())).toBe(before);
    expect(h.toasts()).toMatch(/took none of the tasks/);
  });
});

describe('hosted loads are normalised', () => {
  const broken = (): Snapshot => {
    const b = { ...emptySnapshot() } as unknown as Record<string, unknown>;
    b.groups = [{ id: 'pg1', name: 'Bare galaxy' }, { name: 'no id' }, null];
    b.projects = [{ id: 'pp1', groupId: 'pg1', name: 'Bare system' }, { id: 7 }];
    b.tasks = [
      { id: 'pt1', projectId: 'pp1', title: 'Bare task' },
      { id: 'pt2', projectId: 'nowhere', title: 'Orphan' },
      { projectId: 'pp1', title: 'No id' },
    ];
    b.checkpoints = [{ id: 'pc1', taskId: 'pt1' }, { id: 'pc2' , taskId: 'pt1', links: 'x' }];
    b.sessions = [{ id: 'ps1' }, 'junk'];
    b.captures = [{ id: 'pk1', text: 'idea' }];
    b.dayItems = [{ id: 'pd1', taskId: 'pt1', date: TODAY }, { id: 'pd2', taskId: 'pt1', date: 'not a date' }];
    b.placements = [{ id: 'g|g-1', x: 'a' }];
    b.taskWork = [{ id: 't-1', dependsOn: 'x', subtasks: [1, { id: 's', title: 'ok', done: false }] }, { parked: true }];
    return b as unknown as Snapshot;
  };

  it('fills defaults, drops unusable rows with one warning, never crashes', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = await personal({ store: broken() });
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
    const t = h.s().tasks.find((x) => x.id === 'pt1')!;
    expect(t.dependsOn).toEqual([]);
    expect(t.subtasks).toEqual([]);
    expect(t.links).toEqual([]);
    expect(h.s().tasks.some((x) => x.id === 'pt2')).toBe(false);
    expect(h.s().tasks.filter((x) => !x.host)).toHaveLength(1);
    const g = h.s().groups.find((x) => x.id === 'pg1')!;
    expect([g.x, g.y]).toEqual([0, 0]);
    const p = h.s().projects.find((x) => x.id === 'pp1')!;
    expect(typeof p.color).toBe('string');
    expect(typeof p.x).toBe('number');
    expect(h.s().checkpoints.map((c) => c.id).sort()).toEqual(['pc1', 'pc2']);
    expect(h.s().checkpoints.every((c) => Array.isArray(c.links))).toBe(true);
    expect(h.s().sessions.map((x) => x.id)).toEqual(['ps1']);
    expect(h.s().dayItems.map((x) => x.id)).toEqual(['pd1']);
    expect(h.s().placements[0].x).toBe(0);
    const w = h.s().taskWork;
    expect(w).toHaveLength(1);
    expect(w[0].dependsOn).toBeUndefined();
    expect(w[0].subtasks).toHaveLength(1);
  });

  it('normalises on a hosted restore as well', async () => {
    const h = await personal();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await h.s().restore(broken());
    warn.mockRestore();
    expect(h.s().tasks.find((x) => x.id === 'pt1')!.dependsOn).toEqual([]);
    expect(h.s().tasks.some((x) => x.id === 'pt2')).toBe(false);
    const saved = await h.saved();
    expect(saved.groups.every((g) => typeof g.x === 'number')).toBe(true);
  });
});

describe('yours versus the host\'s', () => {
  it('only a hosted, non-host, non-deep-space galaxy is "yours"', async () => {
    const { isYours } = await import('../../src/host/caps');
    expect(isYours(true, {})).toBe(true);
    expect(isYours(true, { host: { id: 'g-1' } })).toBe(false);
    expect(isYours(true, { virtual: true })).toBe(false);
    expect(isYours(false, {})).toBe(false); // standalone: no cue at all
  });
});
