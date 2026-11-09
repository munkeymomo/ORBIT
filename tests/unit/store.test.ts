import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createOrbitStore } from '../../src/store/store';
import { MemoryAdapter } from '../../src/data/storage';
import * as T from '../../src/lib/timer';
import { spiralSlot } from '../../src/data/layout';

const MIN = 60_000;
let clock = Date.UTC(2026, 10, 8, 9, 0, 0);
const advance = (ms: number) => (clock += ms);
const chime = vi.fn();
const notify = vi.fn();

async function setup() {
  const adapter = new MemoryAdapter();
  const store = createOrbitStore({ now: () => clock, effects: { chime, notify } });
  await store.getState().init(adapter);
  return { store, s: () => store.getState(), adapter };
}

beforeEach(() => {
  clock = Date.UTC(2026, 10, 8, 9, 0, 0);
  chime.mockReset();
  notify.mockReset();
});

describe('vertical slice: create → focus → park → resume → complete', () => {
  it('runs the whole loop and persists every step', async () => {
    const { s, adapter } = await setup();
    const p = s().createProject({ name: 'Thesis' });
    const t = s().createTask({ projectId: p.id, title: 'Write chapter 3', estimateMin: 60 });

    s().startFocus({ taskId: t.id, minutes: 25 });
    expect(s().focus?.taskId).toBe(t.id);
    advance(10 * MIN);

    const cp = s().parkTask(t.id, { stoppedAt: 'Section 3.2', nextAction: 'Write the methods para' });
    expect(s().focus).toBeNull();
    expect(s().tasks[0].status).toBe('parked');
    expect(cp.timer).toEqual({ kind: 'focus', mode: 'countdown', plannedMs: 25 * MIN, elapsedMs: 10 * MIN });
    expect(s().sessions[0]).toMatchObject({ endReason: 'parked', activeMs: 10 * MIN });

    advance(60 * MIN); // time away does not count
    s().resumeTask(t.id, 'continue');
    expect(s().tasks[0].status).toBe('todo');
    const rt = s().focus!;
    expect(T.remainingMs(rt, clock)).toBe(15 * MIN);
    expect(s().checkpoints[0].resumedAt).toBe(clock);

    advance(5 * MIN);
    s().completeTask(t.id);
    expect(s().focus).toBeNull();
    expect(s().tasks[0]).toMatchObject({ status: 'done', progress: 100 });
    expect(s().sessions[1]).toMatchObject({ endReason: 'completed', activeMs: 5 * MIN });

    // everything reached storage
    const saved = await adapter.load();
    expect(saved.tasks[0].status).toBe('done');
    expect(saved.checkpoints).toHaveLength(1);
    expect(saved.sessions).toHaveLength(2);
    expect(saved.focus).toBeNull();
  });

  it('survives a reload mid-session with the timer intact', async () => {
    const adapter = new MemoryAdapter();
    const a = createOrbitStore({ now: () => clock });
    await a.getState().init(adapter);
    const p = a.getState().createProject({ name: 'P' });
    const t = a.getState().createTask({ projectId: p.id, title: 'T' });
    a.getState().startFocus({ taskId: t.id, minutes: 25 });
    advance(7 * MIN);
    await new Promise((r) => setTimeout(r, 0));

    const b = createOrbitStore({ now: () => clock }); // "reload"
    await b.getState().init(adapter);
    expect(T.remainingMs(b.getState().focus!, clock)).toBe(18 * MIN);
  });
});

describe('one active session', () => {
  it('starting another task auto-parks the current one with its timer', async () => {
    const { s } = await setup();
    const p = s().createProject({ name: 'P' });
    const a = s().createTask({ projectId: p.id, title: 'A' });
    const b = s().createTask({ projectId: p.id, title: 'B' });
    s().startFocus({ taskId: a.id, minutes: 25 });
    advance(3 * MIN);
    s().startFocus({ taskId: b.id, minutes: 25 });
    expect(s().focus?.taskId).toBe(b.id);
    const aTask = s().tasks.find((x) => x.id === a.id)!;
    expect(aTask.status).toBe('parked');
    const cp = s().checkpoints.find((c) => c.taskId === a.id)!;
    expect(cp.auto).toBe(true);
    expect(cp.timer?.elapsedMs).toBe(3 * MIN);
    expect(s().toasts.at(-1)?.action?.label).toBe('Add a note');
  });

  it('resuming a parked task parks whatever is active', async () => {
    const { s } = await setup();
    const p = s().createProject({ name: 'P' });
    const a = s().createTask({ projectId: p.id, title: 'A' });
    const b = s().createTask({ projectId: p.id, title: 'B' });
    s().startFocus({ taskId: a.id });
    s().parkTask(a.id, { nextAction: 'x' });
    s().startFocus({ taskId: b.id });
    s().resumeTask(a.id, 'fresh');
    expect(s().focus?.taskId).toBe(a.id);
    expect(s().tasks.find((x) => x.id === b.id)!.status).toBe('parked');
    expect(s().tasks.filter((x) => x.status === 'parked')).toHaveLength(1);
  });
});

describe('timer finishing', () => {
  it('chimes once at zero and keeps running in overtime', async () => {
    const { s } = await setup();
    const p = s().createProject({ name: 'P' });
    const t = s().createTask({ projectId: p.id, title: 'T' });
    s().setPrefs({ sound: true, notifications: true });
    s().startFocus({ taskId: t.id, minutes: 15 });
    advance(15 * MIN + 500);
    s().tick();
    s().tick();
    expect(chime).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(s().focus?.runningSince).not.toBeNull(); // not forced to stop
    s().stopFocus();
    expect(s().lastFocusEnd).toMatchObject({ completedCountdown: true, cycle: 1 });
  });

  it('does not chime for a finish noticed long after the fact', async () => {
    const { s } = await setup();
    const p = s().createProject({ name: 'P' });
    const t = s().createTask({ projectId: p.id, title: 'T' });
    s().startFocus({ taskId: t.id, minutes: 15 });
    advance(3 * 60 * MIN);
    s().tick();
    expect(chime).not.toHaveBeenCalled();
    expect(s().focus?.finishedAt).toBe(clock - 3 * 60 * MIN + 15 * MIN);
  });
});

describe('data integrity', () => {
  it('deleting a project cascades to its tasks, checkpoints and day items', async () => {
    const { s, adapter } = await setup();
    const p = s().createProject({ name: 'P' });
    const t = s().createTask({ projectId: p.id, title: 'T' });
    s().startFocus({ taskId: t.id });
    s().parkTask(t.id, {});
    s().planTask(t.id, '2026-11-08', 'morning');
    s().deleteProject(p.id);
    expect(s().tasks).toHaveLength(0);
    expect(s().checkpoints).toHaveLength(0);
    expect(s().dayItems).toHaveLength(0);
    await new Promise((r) => setTimeout(r, 0));
    const saved = await adapter.load();
    expect(saved.tasks).toHaveLength(0);
  });

  it('deleting a task removes it from other tasks’ dependencies', async () => {
    const { s } = await setup();
    const p = s().createProject({ name: 'P' });
    const a = s().createTask({ projectId: p.id, title: 'A' });
    const b = s().createTask({ projectId: p.id, title: 'B', dependsOn: [a.id] });
    s().deleteTask(a.id);
    expect(s().tasks.find((x) => x.id === b.id)!.dependsOn).toEqual([]);
  });

  it('reports storage failures instead of failing silently', async () => {
    const { s, adapter } = await setup();
    adapter.failWrites = true;
    s().createProject({ name: 'P' });
    await new Promise((r) => setTimeout(r, 0));
    expect(s().toasts.some((t) => t.tone === 'danger')).toBe(true);
  });
});

describe('capture and day plan', () => {
  it('sorts a capture into a project and onto today', async () => {
    const { s } = await setup();
    const p = s().createProject({ name: 'P' });
    const c = s().addCapture({ text: 'Email Priya' });
    const task = s().sortCapture(c.id, { projectId: p.id, slot: 'afternoon' })!;
    expect(task.title).toBe('Email Priya');
    expect(s().captures[0]).toMatchObject({ status: 'sorted', sortedTaskId: task.id });
    expect(s().dayItems[0]).toMatchObject({ taskId: task.id, slot: 'afternoon', date: '2026-11-08' });
  });

  it('keeps slot order compact when moving between slots', async () => {
    const { s } = await setup();
    const p = s().createProject({ name: 'P' });
    const [a, b, c] = ['A', 'B', 'C'].map((title) => s().createTask({ projectId: p.id, title }));
    const d = '2026-11-08';
    s().planTask(a.id, d, 'morning');
    s().planTask(b.id, d, 'morning');
    s().planTask(c.id, d, 'morning', 0);
    const order = () =>
      s()
        .dayItems.filter((x) => x.slot === 'morning')
        .sort((x, y) => x.order - y.order)
        .map((x) => s().tasks.find((t) => t.id === x.taskId)!.title);
    expect(order()).toEqual(['C', 'A', 'B']);
    const itemA = s().dayItems.find((x) => x.taskId === a.id)!;
    s().moveDayItem(itemA.id, 'evening', 0);
    expect(order()).toEqual(['C', 'B']);
    expect(s().dayItems.filter((x) => x.slot === 'morning').map((x) => x.order).sort()).toEqual([0, 1]);
    // planning a task already on the day moves it rather than duplicating
    s().planTask(a.id, d, 'morning', 1);
    expect(order()).toEqual(['C', 'A', 'B']);
    expect(s().dayItems).toHaveLength(3);
  });

  it('a distraction during focus lands in the inbox and is counted', async () => {
    const { s } = await setup();
    const p = s().createProject({ name: 'P' });
    const t = s().createTask({ projectId: p.id, title: 'T' });
    s().startFocus({ taskId: t.id });
    s().captureDistraction('Buy milk');
    expect(s().captures[0]).toMatchObject({ text: 'Buy milk', source: 'focus', contextTaskId: t.id, status: 'inbox' });
    expect(s().sessions[0].distractions).toBe(1);
  });
});

describe('galaxies', () => {
  it('new galaxies get their own space; moving a project finds it a free orbit', async () => {
    const { s } = await setup();
    const a = s().createGroup('Research');
    const b = s().createGroup('Teaching');
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(3000);
    const p1 = s().createProject({ name: 'P1', groupId: a.id, ...s().freeSystemSpot(a.id) });
    const p2 = s().createProject({ name: 'P2', groupId: a.id, ...s().freeSystemSpot(a.id) });
    const q1 = s().projects.find((p) => p.id === p1.id)!;
    const q2 = s().projects.find((p) => p.id === p2.id)!;
    expect(Math.hypot(q1.x - q2.x, q1.y - q2.y)).toBeGreaterThanOrEqual(560);
    // move P2 into Teaching: placed relative to that galaxy, not overlapping
    s().updateProject(p2.id, { groupId: b.id });
    const moved = s().projects.find((p) => p.id === p2.id)!;
    expect(moved.groupId).toBe(b.id);
    expect(moved).toMatchObject({ x: 0, y: 0 });
  });

  it('deleting a galaxy keeps its projects, drifting them into deep space without overlap', async () => {
    const { s } = await setup();
    const g = s().createGroup('Temp');
    s().createProject({ name: 'Loose', x: 0, y: 0 });
    const inG = s().createProject({ name: 'In G', groupId: g.id, x: 0, y: 0 });
    s().deleteGroup(g.id);
    expect(s().groups).toHaveLength(0);
    const p = s().projects.find((x) => x.id === inG.id)!;
    expect(p.groupId).toBeNull();
    expect(Math.hypot(p.x, p.y)).toBeGreaterThanOrEqual(560);
  });
});

describe('spiral layout and moving between galaxies', () => {
  it('new galaxies wind out along a spiral from the centre, never on a grid', async () => {
    const { s } = await setup();
    const gs = ['A', 'B', 'C', 'D', 'E', 'F'].map((n) => s().createGroup(n));
    gs.forEach((g, i) => expect(g).toMatchObject(spiralSlot(i)));
    const rows = new Set(gs.map((g) => g.y));
    expect(rows.size).toBe(gs.length); // no two galaxies share a row
    for (let i = 0; i < gs.length; i++)
      for (let j = i + 1; j < gs.length; j++) expect(Math.hypot(gs[i].x - gs[j].x, gs[i].y - gs[j].y)).toBeGreaterThanOrEqual(3000);
  });

  it('a new galaxy skips the slot deep space is using', async () => {
    const { s } = await setup();
    s().createProject({ name: 'Loose' }); // deep space claims the first free slot
    const ds = s().prefs.deepSpace;
    const g = s().createGroup('Next');
    expect(Math.hypot(g.x - ds.x, g.y - ds.y)).toBeGreaterThanOrEqual(3000);
  });

  it('“Tidy into a spiral” reorders by age and can be undone', async () => {
    const { s } = await setup();
    const a = s().createGroup('A');
    advance(1000);
    const b = s().createGroup('B');
    s().updateGroup(a.id, { x: 50_000, y: 50_000 });
    s().updateGroup(b.id, { x: -50_000, y: 0 });
    s().arrangeGalaxiesSpiral();
    expect(s().groups.find((g) => g.id === a.id)).toMatchObject(spiralSlot(0));
    expect(s().groups.find((g) => g.id === b.id)).toMatchObject(spiralSlot(1));
    expect(s().flight?.kind).toBe('universe');
    const undo = s().toasts.at(-1)!.action!;
    undo.run();
    expect(s().groups.find((g) => g.id === a.id)).toMatchObject({ x: 50_000, y: 50_000 });
    expect(s().groups.find((g) => g.id === b.id)).toMatchObject({ x: -50_000, y: 0 });
  });

  it('dropping a star on another galaxy keeps the exact spot it was dropped', async () => {
    const { s } = await setup();
    const a = s().createGroup('A');
    const b = s().createGroup('B');
    const p = s().createProject({ name: 'P', groupId: a.id, x: 0, y: 0 });
    s().updateProject(p.id, { groupId: b.id, x: -310, y: 140 });
    expect(s().projects.find((x) => x.id === p.id)).toMatchObject({ groupId: b.id, x: -310, y: 140 });
  });

  it('deleting a galaxy when deep space is empty: deep space takes its place, nothing moves on screen', async () => {
    const { s } = await setup();
    s().createGroup('First');
    const g = s().createGroup('Doomed');
    const p = s().createProject({ name: 'Stays put', groupId: g.id, x: 300, y: -100 });
    s().deleteGroup(g.id);
    expect(s().prefs.deepSpace).toEqual({ x: g.x, y: g.y });
    expect(s().projects.find((x) => x.id === p.id)).toMatchObject({ groupId: null, x: 300, y: -100 });
  });
});

describe('example workspace', () => {
  it('keeps example projects that hold the user’s own tasks (no orphans)', async () => {
    const { s } = await setup();
    await s().loadExample();
    const home = s().projects.find((p) => p.name === 'Home move')!;
    s().createTask({ projectId: home.id, title: 'My own task' });
    await s().removeExample();
    expect(s().tasks.map((t) => t.title)).toEqual(['My own task']);
    const kept = s().projects.find((p) => p.id === home.id)!;
    expect(kept.example).toBeUndefined();
    expect(s().tasks.every((t) => s().projects.some((p) => p.id === t.projectId))).toBe(true);
  });

  it('loads labelled example data and removes all of it', async () => {
    const { s } = await setup();
    const mine = s().createProject({ name: 'Mine' });
    await s().loadExample();
    expect(s().projects.length).toBeGreaterThan(1);
    expect(s().projects.filter((p) => p.id !== mine.id).every((p) => p.example)).toBe(true);
    await s().removeExample();
    expect(s().projects.map((p) => p.name)).toEqual(['Mine']);
    expect(s().tasks).toHaveLength(0);
    expect(s().sessions).toHaveLength(0);
  });
});
