import { describe, expect, it } from 'vitest';
import { rankNext, scoreTask, type NextContext } from '../../src/lib/scoring';
import type { Task } from '../../src/types';

const today = '2026-11-08';
let n = 0;
const task = (o: Partial<Task> = {}): Task => ({
  id: `t${++n}`,
  createdAt: n,
  updatedAt: n,
  projectId: 'p',
  title: `Task ${n}`,
  notes: '',
  status: 'todo',
  priority: 2,
  due: null,
  estimateMin: null,
  energy: 'medium',
  progress: 0,
  subtasks: [],
  dependsOn: [],
  links: [],
  completedAt: null,
  parkedAt: null,
  ...o,
});
const ctx = (o: Partial<NextContext> = {}): NextContext => ({
  todayKey: today,
  availableMin: 30,
  energy: 'medium',
  checkpoints: new Map(),
  planned: new Map(),
  activeTaskId: null,
  ...o,
});

describe('smart next action', () => {
  it('explains every point with a reason', () => {
    const s = scoreTask(task({ due: '2026-11-07', priority: 4, estimateMin: 20 }), ctx(), 0);
    expect(s.score).toBe(s.reasons.reduce((a, r) => a + r.points, 0));
    const texts = s.reasons.map((r) => r.text);
    expect(texts).toContain('Overdue by a day');
    expect(texts).toContain('Critical priority');
    expect(texts).toContain('Fits in your 30 min');
  });

  it('ranks overdue critical work above a low-priority task', () => {
    const a = task({ priority: 1 });
    const b = task({ priority: 4, due: '2026-11-06' });
    const { suggestions } = rankNext([a, b], ctx());
    expect(suggestions[0].task.id).toBe(b.id);
  });

  it('penalises tasks that need more energy than available', () => {
    const hard = task({ energy: 'high' });
    const s = scoreTask(hard, ctx({ energy: 'low' }), 0);
    expect(s.reasons.find((r) => r.rule === 'energy')!.points).toBe(-40);
  });

  it('penalises tasks far longer than the available time', () => {
    const s = scoreTask(task({ estimateMin: 120 }), ctx({ availableMin: 30 }), 0);
    expect(s.reasons.find((r) => r.rule === 'time')!.points).toBe(-15);
  });

  it('boosts parked tasks with a next action and quotes it', () => {
    const t = task({ status: 'parked' });
    const checkpoints = new Map([[t.id, { nextAction: 'Finish the intro', taskId: t.id } as never]]);
    const s = scoreTask(t, ctx({ checkpoints }), 0);
    const r = s.reasons.find((x) => x.rule === 'parked')!;
    expect(r.points).toBe(15);
    expect(r.text).toContain('Finish the intro');
  });

  it('separates blocked tasks and names their blockers', () => {
    const dep = task({ title: 'Collect data' });
    const blocked = task({ dependsOn: [dep.id] });
    const { suggestions, blocked: b } = rankNext([dep, blocked], ctx());
    expect(suggestions.map((s) => s.task.id)).toEqual([dep.id]);
    expect(b[0].blockers[0].title).toBe('Collect data');
    // and the blocker earns an "unblocks" reason
    expect(suggestions[0].reasons.some((r) => r.rule === 'unblocks')).toBe(true);
  });

  it('a finished dependency no longer blocks', () => {
    const dep = task({ status: 'done' });
    const t = task({ dependsOn: [dep.id] });
    expect(rankNext([dep, t], ctx()).blocked).toHaveLength(0);
  });

  it('excludes done tasks and the active task', () => {
    const a = task({ status: 'done' });
    const b = task();
    const c = task();
    const { suggestions } = rankNext([a, b, c], ctx({ activeTaskId: c.id }));
    expect(suggestions.map((s) => s.task.id)).toEqual([b.id]);
  });
});
