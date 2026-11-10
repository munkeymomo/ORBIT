import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import schemaText from '../../src/host/host-protocol-v1.schema.json?raw';
import { createFakeHost, type FakeHost } from '../../src/host/fakeHost';
import { abilities, BUILD_SUPPORTS } from '../../src/host/caps';
import { hostStatusOf, overlayWork } from '../../src/host/work';
import { planetToTask } from '../../src/host/adapt';
import { createOrbitStore } from '../../src/store/store';
import { MemoryAdapter } from '../../src/data/storage';
import type { TableName, TaskWork } from '../../src/types';

/*
 * Editing host-owned tasks, and the working state ORBIT keeps for them with the host (src/host/writer.ts).
 * Every test runs against the editable fake host.
 */

const NOW = Date.UTC(2026, 10, 10, 9, 0, 0);
const TODAY = '2026-11-10';

/** Every write to the host's store, by table, with the record ids. */
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
  const prefs = s.setPrefs.bind(s);
  s.setPrefs = (p) => (writes.push({ table: 'prefs', ids: [] }), prefs(p));
  const focus = s.setFocus.bind(s);
  s.setFocus = (f) => (writes.push({ table: 'focus', ids: f ? [f.sessionId] : [] }), focus(f));
  return writes;
}

async function editable(opts: { host?: FakeHost } = {}) {
  const host = opts.host ?? createFakeHost({ now: NOW, editable: true });
  const info = await host.handshake();
  const store = createOrbitStore({ now: () => NOW });
  await store.getState().init(new MemoryAdapter(), null, { host: { host, info } });
  const s = () => store.getState();
  await s().hostSettled();
  const writes = spy(host);
  host.log.length = 0;
  const task = (id: string) => s().tasks.find((t) => t.id === id);
  const saved = async () => host.store.load();
  const toasts = () => s().toasts.map((t) => t.text);
  const settle = async () => {
    await s().hostSettled();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { host, store, s, writes, task, saved, toasts, settle };
}

/** A host whose answers wait until released, to see what is on screen meanwhile. */
function gated(host: FakeHost) {
  const waiting: (() => void)[] = [];
  const api = host.tasks!;
  for (const k of Object.keys(api) as (keyof typeof api)[]) {
    const orig = api[k].bind(api) as (...a: unknown[]) => Promise<unknown>;
    (api as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => new Promise((r) => waiting.push(() => r(undefined))).then(() => orig(...a));
  }
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    release: async () => {
      await tick();
      waiting.shift()?.();
      await tick();
    },
    /** How many calls are waiting for an answer (after the calls already queued have been made). */
    count: async () => {
      await tick();
      return waiting.length;
    },
  };
}

const hostTables = (writes: { table: string }[]) => writes.filter((w) => ['tasks', 'groups', 'projects', '-tasks', '-groups', '-projects'].includes(w.table));

/* ---------------- contract ---------------- */

describe('the editable fake host', () => {
  const schema = JSON.parse(schemaText);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  ajv.addSchema(schema);
  const check = (def: string, doc: unknown) => {
    const v = ajv.getSchema(`${schema.$id}#/$defs/${def}`)!;
    return v(doc) ? [] : v.errors;
  };

  it('validates against the JSON Schema (handshake locked or not, verse, and a planet it returns)', async () => {
    const host = createFakeHost({ now: NOW, editable: true });
    expect(check('handshake', await host.handshake())).toEqual([]);
    expect(check('verse', await host.verse('main'))).toEqual([]);
    host.setLocked('Stocktaking until noon.');
    expect(check('handshake', await host.handshake())).toEqual([]);
    host.setLocked();
    expect(check('planet', await host.tasks!.update('t-compost', { title: 'Turn it' }))).toEqual([]);
  });

  it('this build supports write and work, not yet personal', async () => {
    expect(BUILD_SUPPORTS).toEqual({ write: true, personal: false, work: true });
    const a = abilities(await createFakeHost({ editable: true }).handshake());
    expect([a.write, a.work, a.personal, a.capture]).toEqual([true, true, false, true]);
  });
});

describe('working state: split and overlay', () => {
  it('ORBIT todo and parked are both the host’s todo', () => {
    const t = planetToTask('main', { id: 'x', system: 's', type: 'task', title: 'X', status: 'todo' });
    expect(hostStatusOf(t)).toBe('todo');
    expect(hostStatusOf({ ...t, status: 'parked' })).toBe('todo');
    expect(hostStatusOf({ ...t, status: 'done' })).toBe('done');
    expect(hostStatusOf({ ...t, status: 'done', host: { ...t.host!, dropped: true } })).toBe('dropped');
  });

  it('parked applies only while the host says todo; when the host says done the flag is stale', () => {
    const w: TaskWork = { id: 'x', parked: true, parkedAt: 5, energy: 'low', estimateMin: 30, progress: 40, updatedAt: 1 };
    const todo = planetToTask('main', { id: 'x', system: 's', type: 'task', title: 'X', status: 'todo' });
    expect(overlayWork(todo, w)).toMatchObject({ task: { status: 'parked', parkedAt: 5, energy: 'low', estimateMin: 30, progress: 40 }, stale: false });
    const done = planetToTask('main', { id: 'x', system: 's', type: 'task', title: 'X', status: 'done' });
    expect(overlayWork(done, w)).toMatchObject({ task: { status: 'done', progress: 100 }, stale: true });
  });

  it('host fields go to host.tasks, working-state fields to taskWork, and nothing to the host’s own tables', async () => {
    const h = await editable();
    h.s().updateTask('t-compost', { title: 'Turn the compost well', priority: 3, energy: 'high', estimateMin: 20 });
    await h.settle();
    expect(h.host.log).toEqual([{ op: 'update', args: ['t-compost', { title: 'Turn the compost well', priority: 3 }] }]);
    expect(h.writes.map((w) => w.table)).toEqual(['taskWork']);
    const row = (await h.saved()).taskWork.find((w) => w.id === 't-compost')!;
    expect(row).toMatchObject({ energy: 'high', estimateMin: 20, parked: false });
    expect(row).not.toHaveProperty('title');
    expect(h.host.current().planets.find((p) => p.id === 't-compost')).toMatchObject({ title: 'Turn the compost well', priority: 3 });
  });

  it('only the fields that changed are sent; an unchanged write sends nothing', async () => {
    const h = await editable();
    h.s().updateTask('t-raised-bed', { notes: 'Larch, 30 cm.' });
    await h.settle();
    h.s().updateTask('t-raised-bed', { notes: 'Larch, 30 cm.', title: 'Build the raised bed' });
    await h.settle();
    h.s().updateTask('t-raised-bed', { due: null });
    await h.settle();
    expect(h.host.log.map((l) => l.args)).toEqual([
      ['t-raised-bed', { notes: 'Larch, 30 cm.' }],
      ['t-raised-bed', { due: null }],
    ]);
  });

  it('subtasks, dependencies, links and progress stay in taskWork', async () => {
    const h = await editable();
    h.s().updateTask('t-vent', { subtasks: [{ id: 'a', title: 'Ladder', done: false }], dependsOn: ['t-trays'], links: [{ id: 'l', url: 'https://example.org', label: '' }], progress: 30 });
    await h.settle();
    expect(h.host.log).toEqual([]);
    expect((await h.saved()).taskWork).toEqual([expect.objectContaining({ id: 't-vent', progress: 30, dependsOn: ['t-trays'], subtasks: [expect.objectContaining({ title: 'Ladder' })] })]);
    expect(h.toasts()).toEqual([]);
  });

  it('the host’s returned task is authoritative for its own fields', async () => {
    const h = await editable();
    h.s().updateTask('t-compost', { title: '   Spaced   ' });
    await h.settle();
    expect(h.task('t-compost')!.title).toBe('Spaced'); // the fake host trims
  });
});

/* ---------------- refusals ---------------- */

describe('a refused change is undone on screen, with the host’s reason', () => {
  it('update', async () => {
    const h = await editable();
    h.host.refuseNext('Titles are frozen this week.');
    h.s().updateTask('t-compost', { title: 'Nope', priority: 4 });
    expect(h.task('t-compost')!.title).toBe('Nope'); // optimistic
    await h.settle();
    expect(h.task('t-compost')).toMatchObject({ title: 'Turn the compost', priority: 1 });
    expect(h.toasts()).toContain('Titles are frozen this week.');
    expect(h.s().toasts.at(-1)!.tone).toBe('danger');
  });

  it('a task that always refuses (field edits), while working state still saves', async () => {
    const h = await editable();
    h.s().updateTask('t-vent', { title: 'Fix it now', energy: 'low' });
    await h.settle();
    expect(h.task('t-vent')).toMatchObject({ title: 'Fix the roof vent', energy: 'low' });
    expect(h.toasts().join()).toMatch(/waiting for a survey/);
    expect((await h.saved()).taskWork.find((w) => w.id === 't-vent')!.energy).toBe('low');
  });

  it('status (complete), including what came with it', async () => {
    const h = await editable();
    h.s().parkTask('t-compost', { nextAction: 'Fork the heap' });
    await h.settle();
    h.host.refuseNext('Not before the inspection.');
    h.s().completeTask('t-compost');
    expect(h.task('t-compost')!.status).toBe('done');
    await h.settle();
    expect(h.task('t-compost')).toMatchObject({ status: 'parked', completedAt: null, progress: 0 });
    expect(h.toasts()).toContain('Not before the inspection.');
    expect((await h.saved()).taskWork.find((w) => w.id === 't-compost')).toMatchObject({ parked: true });
  });

  it('a network-ish failure is treated like a refusal', async () => {
    const h = await editable();
    h.host.tasks!.setStatus = () => Promise.reject(new Error('Failed to fetch'));
    h.s().completeTask('t-compost');
    await h.settle();
    expect(h.task('t-compost')!.status).toBe('todo');
    expect(h.toasts()).toContain('Failed to fetch');
  });

  it('create: the temporary task goes away and a sorted capture goes back to the inbox', async () => {
    const h = await editable();
    const c = h.s().addCapture({ text: 'Net the pond' });
    h.host.refuseNext('No new tasks today.');
    const t = h.s().sortCapture(c.id, { projectId: 's-pond' })!;
    expect(t.id).toMatch(/^tmp-/);
    expect(h.task(t.id)).toBeTruthy();
    await h.settle();
    expect(h.task(t.id)).toBeUndefined();
    expect(h.s().captures.find((x) => x.id === c.id)).toMatchObject({ status: 'inbox', sortedTaskId: null });
    expect(h.toasts()).toContain('No new tasks today.');
  });

  it('delete: the task comes back, and nothing ORBIT kept for it was cleaned up', async () => {
    const h = await editable();
    h.s().planTask('t-compost', TODAY, 'morning');
    h.s().parkTask('t-compost', { nextAction: 'x' });
    await h.settle();
    h.host.refuseNext('Kept for the audit.');
    h.s().deleteTask('t-compost', 'Not needed');
    expect(h.task('t-compost')).toBeUndefined();
    await h.settle();
    expect(h.task('t-compost')).toMatchObject({ status: 'parked' });
    expect(h.s().dayItems).toHaveLength(1);
    expect(h.s().checkpoints).toHaveLength(1);
    expect(h.toasts()).toContain('Kept for the audit.');
    const saved = await h.saved();
    expect(saved.dayItems).toHaveLength(1);
    expect(saved.taskWork.map((w) => w.id)).toContain('t-compost');
  });

  it('a refusal while a second change to the same field is queued keeps the newer value, which is then sent', async () => {
    const h = await editable();
    const g = gated(h.host);
    h.host.refuseNext('Busy.');
    h.s().updateTask('t-compost', { title: 'First' });
    h.s().updateTask('t-compost', { title: 'Second', notes: 'n' });
    expect(await g.count()).toBe(1); // one at a time
    await g.release(); // "First" refused
    expect(h.task('t-compost')!.title).toBe('Second'); // the newer value stands
    await g.release();
    await h.settle();
    expect(h.host.log.map((l) => l.args)).toEqual([
      ['t-compost', { title: 'First' }],
      ['t-compost', { title: 'Second', notes: 'n' }],
    ]);
    expect(h.task('t-compost')).toMatchObject({ title: 'Second', notes: 'n' });
    expect(h.toasts()).toEqual(['Busy.']);
  });

  it('a refused second change goes back to what the host last said, not to the refused first value', async () => {
    const h = await editable();
    h.host.refuseAlways('t-compost', 'No.');
    h.s().updateTask('t-compost', { title: 'First' });
    h.s().updateTask('t-compost', { title: 'Second' });
    await h.settle();
    expect(h.task('t-compost')!.title).toBe('Turn the compost');
  });

  it('a refusal of one field leaves another field’s queued change alone', async () => {
    const h = await editable();
    const g = gated(h.host);
    h.host.refuseNext('No titles.');
    h.s().updateTask('t-compost', { title: 'Refused' });
    h.s().updateTask('t-compost', { priority: 4 });
    await g.release();
    expect(h.task('t-compost')).toMatchObject({ title: 'Turn the compost', priority: 4 });
    await g.release();
    await h.settle();
    expect(h.host.log.at(-1)!.args).toEqual(['t-compost', { priority: 4 }]);
  });
});

/* ---------------- create, move, status ---------------- */

describe('creating, moving and status', () => {
  it('create: shown at once under a temporary id, then replaced by the host’s task; references repointed', async () => {
    const h = await editable();
    const g = gated(h.host);
    const t = h.s().createTask({ projectId: 's-pond', title: 'Skim the leaves', due: TODAY });
    expect(h.task(t.id)!.host).toMatchObject({ pending: true });
    h.s().select({ type: 'task', id: t.id });
    h.s().planTask(t.id, TODAY, 'afternoon');
    h.s().parkTask(t.id, { nextAction: 'Find the net' });
    h.s().updateTask('t-liner', { dependsOn: [t.id] });
    expect(await g.count()).toBe(1);
    await g.release();
    await h.settle();
    const made = h.host.log[0];
    expect(made).toEqual({ op: 'create', args: [{ system: 's-pond', title: 'Skim the leaves', priority: 2, due: TODAY }] });
    const real = h.s().tasks.find((x) => x.title === 'Skim the leaves')!;
    expect(real.id).toMatch(/^t-made-/);
    expect(real.host!.pending).toBeFalsy();
    expect(real.status).toBe('parked');
    expect(h.task(t.id)).toBeUndefined();
    expect(h.s().selection).toEqual({ type: 'task', id: real.id });
    expect(h.s().dayItems[0].taskId).toBe(real.id);
    expect(h.s().checkpoints[0].taskId).toBe(real.id);
    expect(h.task('t-liner')!.dependsOn).toEqual([real.id]);
    const saved = await h.saved();
    expect(saved.dayItems[0].taskId).toBe(real.id);
    expect(saved.checkpoints[0].taskId).toBe(real.id);
    expect(saved.taskWork.map((w) => w.id).sort()).toEqual([real.id, 't-liner'].sort());
    expect(saved.taskWork.find((w) => w.id === 't-liner')!.dependsOn).toEqual([real.id]);
    expect(hostTables(h.writes)).toEqual([]);
  });

  it('a change made while the create is waiting is sent after it, to the host’s id', async () => {
    const h = await editable();
    const g = gated(h.host);
    const t = h.s().createTask({ projectId: 's-pond', title: 'Skim' });
    h.s().updateTask(t.id, { title: 'Skim the leaves' });
    await g.release();
    await g.release();
    await h.settle();
    const real = h.s().tasks.find((x) => x.title === 'Skim the leaves')!;
    expect(h.host.log.map((l) => l.op)).toEqual(['create', 'update']);
    expect(h.host.log[1].args).toEqual([real.id, { title: 'Skim the leaves' }]);
  });

  it('creating where the system does not allow it is refused before asking', async () => {
    const h = await editable();
    h.s().createTask({ projectId: 's-nowhere', title: 'x' });
    await h.settle();
    expect(h.host.log).toEqual([]);
    expect(h.s().tasks.some((t) => t.title === 'x')).toBe(false);
  });

  it('complete and Undo: setStatus done then todo', async () => {
    const h = await editable();
    h.s().completeTask('t-compost');
    await h.settle();
    expect(h.task('t-compost')!.status).toBe('done');
    h.s().toasts.at(-1)!.action!.run();
    await h.settle();
    expect(h.task('t-compost')!.status).toBe('todo');
    expect(h.host.log).toEqual([
      { op: 'setStatus', args: ['t-compost', 'done'] },
      { op: 'setStatus', args: ['t-compost', 'todo'] },
    ]);
  });

  it('drop needs a reason when the task asks for one, and sends it', async () => {
    const h = await editable();
    h.s().dropTask('t-compost');
    expect(h.toasts().join()).toMatch(/asks for a reason to drop/);
    expect(h.task('t-compost')!.status).toBe('todo');
    h.s().dropTask('t-compost', 'Rained off');
    await h.settle();
    expect(h.host.log).toEqual([{ op: 'setStatus', args: ['t-compost', 'dropped', 'Rained off'] }]);
    expect(h.task('t-compost')).toMatchObject({ status: 'done', host: { dropped: true } });
    h.s().reopenTask('t-compost');
    await h.settle();
    expect(h.task('t-compost')).toMatchObject({ status: 'todo', host: { dropped: false } });
  });

  it('move to another system: update(id, {system}); a target that takes no tasks is refused', async () => {
    const h = await editable();
    h.s().updateTask('t-bike', { projectId: 's-shelves' });
    await h.settle();
    expect(h.host.log).toEqual([{ op: 'update', args: ['t-bike', { system: 's-shelves' }] }]);
    expect(h.task('t-bike')!.projectId).toBe('s-shelves');
    h.s().updateTask('t-bike', { projectId: 's-nowhere' });
    await h.settle();
    expect(h.host.log).toHaveLength(1);
    expect(h.task('t-bike')!.projectId).toBe('s-shelves');
    expect(h.toasts().join()).toMatch(/does not take tasks in that system/);
  });

  it('a move the host refuses goes back', async () => {
    const h = await editable();
    h.host.refuseNext('Shelves are full.');
    h.s().updateTask('t-bike', { projectId: 's-shelves' });
    await h.settle();
    expect(h.task('t-bike')!.projectId).toBe('s-odd');
    expect(h.toasts()).toContain('Shelves are full.');
  });

  it('a task with no caps cannot be changed (no call is made)', async () => {
    const h = await editable();
    h.s().updateTask('t-keys', { title: 'x' });
    h.s().reopenTask('t-keys');
    h.s().deleteTask('t-keys', 'x');
    await h.settle();
    expect(h.host.log).toEqual([]);
    expect(h.task('t-keys')!.title).toBe('Return the spare keys');
  });
});

/* ---------------- multi-record actions ---------------- */

describe('multi-record actions', () => {
  it('deleteTask: asks for a reason, cleans up only after the host accepts, rewrites dependents in taskWork', async () => {
    const h = await editable();
    h.s().updateTask('t-liner', { dependsOn: ['t-compost'] });
    h.s().planTask('t-compost', TODAY, 'morning');
    h.s().parkTask('t-compost', { nextAction: 'x' });
    await h.settle();
    h.s().deleteTask('t-compost');
    expect(h.toasts().join()).toMatch(/asks for a reason to delete/);
    expect(h.task('t-compost')).toBeTruthy();
    const g = gated(h.host);
    h.s().deleteTask('t-compost', 'Done by hand');
    expect(h.task('t-compost')).toBeUndefined();
    expect(h.s().dayItems).toHaveLength(1); // not yet
    await g.release();
    await h.settle();
    expect(h.host.log.at(-1)).toEqual({ op: 'remove', args: ['t-compost', 'Done by hand'] });
    expect(h.s().dayItems).toEqual([]);
    expect(h.s().checkpoints).toEqual([]);
    expect(h.task('t-liner')!.dependsOn).toEqual([]);
    const saved = await h.saved();
    expect(saved.dayItems).toEqual([]);
    expect(saved.checkpoints).toEqual([]);
    expect(saved.taskWork.find((w) => w.id === 't-compost')).toBeUndefined();
    expect(saved.taskWork.find((w) => w.id === 't-liner')!.dependsOn).toEqual([]);
    expect(hostTables(h.writes)).toEqual([]);
  });

  it('deleteProject and deleteGroup on host records are refused (with a way to the host) and touch no task', async () => {
    const h = await editable();
    const before = JSON.stringify(h.s().tasks);
    h.s().deleteProject('s-beds');
    const t = h.s().toasts.at(-1)!;
    expect(t.text).toMatch(/ORBIT does not delete it/);
    t.action!.run();
    h.s().dismissToast(t.id);
    h.s().deleteGroup('g-garden');
    h.s().toasts.at(-1)!.action!.run();
    await h.settle();
    expect(JSON.stringify(h.s().tasks)).toBe(before);
    expect(h.host.log).toEqual([]);
    expect(h.writes).toEqual([]);
    expect(h.host.opened).toEqual([{ kind: 'plan', id: 's-beds' }, { kind: 'area', id: 'g-garden' }]);
  });

  it('updateProject / updateGroup on host records: only their place', async () => {
    const h = await editable();
    h.s().updateProject('s-beds', { name: 'Renamed' });
    h.s().updateGroup('g-garden', { name: 'Renamed' });
    h.s().updateProject('s-beds', { groupId: 'g-move' });
    await h.settle();
    expect(h.s().projects.find((p) => p.id === 's-beds')).toMatchObject({ name: 'Vegetable beds', groupId: 'g-garden' });
    expect(h.s().groups.find((g) => g.id === 'g-garden')!.name).toBe('Garden');
    h.s().updateProject('s-beds', { x: 10, y: 20 });
    await h.settle();
    expect(new Set(h.writes.map((w) => w.table))).toEqual(new Set(['placements']));
  });
});

/* ---------------- working state with the host ---------------- */

describe('working state is kept by the host (caps.work)', () => {
  it('focus, sessions, checkpoints, day items, captures and prefs reach host.store; host records never do', async () => {
    const h = await editable();
    h.s().startFocus({ taskId: 't-compost' });
    h.s().parkTask('t-compost', { nextAction: 'Fork it' });
    h.s().planTask('t-trays', TODAY, 'morning');
    h.s().addCapture({ text: 'Buy twine' });
    h.s().setPrefs({ focusMin: 30 });
    await h.settle();
    const saved = await h.saved();
    expect(saved.sessions).toHaveLength(1);
    expect(saved.sessions[0].taskId).toBe('t-compost');
    expect(saved.checkpoints[0]).toMatchObject({ taskId: 't-compost', nextAction: 'Fork it' });
    expect(saved.dayItems[0]).toMatchObject({ taskId: 't-trays', slot: 'morning' });
    expect(saved.captures[0].text).toBe('Buy twine');
    expect(saved.taskWork).toEqual([expect.objectContaining({ id: 't-compost', parked: true })]);
    expect(saved.prefs.focusMin).toBe(30);
    expect(h.writes.some((w) => w.table === 'focus')).toBe(true);
    expect(saved.tasks).toEqual([]);
    expect(saved.projects).toEqual([]);
    expect(saved.groups).toEqual([]);
    expect(h.host.log).toEqual([]); // parking is not the host's business
  });

  it('Today and the Inbox are open; park, then a fresh load with the same store, then resume', async () => {
    const h = await editable();
    h.s().setView('today');
    expect(h.s().view).toBe('today');
    h.s().setView('inbox');
    expect(h.s().view).toBe('inbox');
    h.s().parkTask('t-compost', { nextAction: 'Fork it' });
    await h.settle();
    const again = await editable({ host: h.host });
    expect(again.task('t-compost')).toMatchObject({ status: 'parked' });
    again.s().resumeTask('t-compost', 'fresh');
    await again.settle();
    expect(again.task('t-compost')!.status).toBe('todo');
    expect(again.s().focus?.taskId).toBe('t-compost');
    expect((await again.saved()).taskWork.find((w) => w.id === 't-compost')).toMatchObject({ parked: false });
  });

  it('parked overlay vs the host saying done: done wins and the stale flag is cleared', async () => {
    const h = await editable();
    h.s().parkTask('t-compost', {});
    await h.settle();
    h.host.change((v) => {
      v.planets.find((p) => p.id === 't-compost')!.status = 'done';
    });
    await h.s().refreshHost();
    await h.settle();
    expect(h.task('t-compost')!.status).toBe('done');
    expect((await h.saved()).taskWork.find((w) => w.id === 't-compost')).toMatchObject({ parked: false });
  });

  it('sortCapture into a host system creates a host task', async () => {
    const h = await editable();
    const c = h.s().addCapture({ text: 'Oil the hinges' });
    h.s().sortCapture(c.id, { projectId: 's-shelves', slot: 'evening' });
    await h.settle();
    const t = h.s().tasks.find((x) => x.title === 'Oil the hinges')!;
    expect(t.id).toMatch(/^t-made-/);
    expect(h.host.log[0]).toEqual({ op: 'create', args: [{ system: 's-shelves', title: 'Oil the hinges', priority: 2 }] });
    expect(h.s().captures[0]).toMatchObject({ status: 'sorted', sortedTaskId: t.id });
    expect(h.s().dayItems[0].taskId).toBe(t.id);
    expect((await h.saved()).captures[0].sortedTaskId).toBe(t.id);
  });
});

/* ---------------- locked, refresh, links ---------------- */

describe('locked, refresh, linked items', () => {
  it('refresh re-reads the handshake: locked comes and goes; while locked host changes are refused but working state works', async () => {
    const h = await editable();
    expect(h.s().abilities().locked).toBeUndefined();
    h.host.setLocked('Stocktaking until noon.');
    await h.s().refreshHost();
    expect(h.host.calls.handshake).toBeGreaterThanOrEqual(2);
    expect(h.s().abilities().locked).toBe('Stocktaking until noon.');
    h.s().updateTask('t-compost', { title: 'x' });
    h.s().completeTask('t-compost');
    expect(h.toasts()).toContain('Stocktaking until noon.');
    h.s().parkTask('t-compost', {});
    h.s().planTask('t-compost', TODAY, 'later');
    await h.settle();
    expect(h.host.log).toEqual([]);
    expect(h.task('t-compost')).toMatchObject({ title: 'Turn the compost', status: 'parked' });
    expect(h.s().dayItems).toHaveLength(1);
    h.host.setLocked();
    await h.s().refreshHost();
    expect(h.s().abilities().locked).toBeUndefined();
  });

  it('a handshake that fails on refresh is shown as an error, and the sky stays', async () => {
    const h = await editable();
    h.host.handshake = () => Promise.reject(new Error('host restarting'));
    await h.s().refreshHost();
    expect(h.s().host!.error).toMatch(/host restarting/);
    expect(h.s().tasks.length).toBeGreaterThan(50);
  });

  it('detach takes a linked item off (and refreshes); refused, it comes back', async () => {
    const h = await editable();
    h.s().detachLinked('t-raised-bed', 'a-saw');
    expect(h.s().host!.attachments['t-raised-bed'].items.some((a) => a.id === 'a-saw')).toBe(false);
    await h.settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.host.log[0]).toEqual({ op: 'detach', args: ['t-raised-bed', 'l-a-saw'] });
    expect(h.s().host!.rev).not.toBe('1');
    h.host.refuseNext('That drill is on loan.');
    h.s().detachLinked('t-raised-bed', 'a-drill');
    await h.settle();
    await new Promise((r) => setTimeout(r, 0));
    expect(h.s().host!.attachments['t-raised-bed'].items.some((a) => a.id === 'a-drill')).toBe(true);
    expect(h.toasts()).toContain('That drill is on loan.');
  });

  it('pick asks the host’s own picker, then refreshes', async () => {
    const h = await editable();
    await h.s().pickLinked('tool', { planet: 't-compost' });
    expect(h.host.log).toEqual([{ op: 'pick', args: ['tool', { planet: 't-compost' }] }]);
    expect(h.s().host!.attachments['t-compost'].items[0].label).toMatch(/Tools pick/);
  });

  it('a refresh while a change is waiting keeps what is on screen', async () => {
    const h = await editable();
    const g = gated(h.host);
    h.s().updateTask('t-compost', { title: 'Waiting' });
    h.host.change((v) => v.planets.push({ id: 't-other', system: 's-pond', type: 'task', title: 'Other', status: 'todo' }));
    const r = h.s().refreshHost(); // waits for the change to be answered first
    expect(h.task('t-compost')!.title).toBe('Waiting');
    await g.release();
    await r;
    expect(h.task('t-compost')!.title).toBe('Waiting');
    expect(h.task('t-other')).toBeTruthy();
  });
});
