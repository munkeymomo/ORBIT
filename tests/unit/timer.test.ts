import { describe, expect, it } from 'vitest';
import * as T from '../../src/lib/timer';

const MIN = 60_000;
const base = (now: number, o: Partial<Parameters<typeof T.createRuntime>[0]> = {}) =>
  T.createRuntime({ sessionId: 's', taskId: 't', kind: 'focus', mode: 'countdown', plannedMs: 25 * MIN, now, ...o });

describe('timer engine', () => {
  it('derives elapsed and remaining from timestamps only', () => {
    const rt = base(1_000);
    expect(T.elapsedMs(rt, 1_000)).toBe(0);
    expect(T.remainingMs(rt, 1_000 + 10 * MIN)).toBe(15 * MIN);
  });

  it('is accurate across a long gap (e.g. tab asleep) with no ticks', () => {
    const start = Date.UTC(2026, 0, 1, 9);
    const rt = base(start);
    expect(T.remainingMs(rt, start + 24 * MIN + 59_999)).toBe(1);
    expect(T.isOvertime(rt, start + 25 * MIN)).toBe(true);
  });

  it('pauses and resumes without losing or gaining time', () => {
    let rt = base(0);
    rt = T.pause(rt, 5 * MIN);
    expect(T.elapsedMs(rt, 60 * MIN)).toBe(5 * MIN); // time stands still while paused
    rt = T.resume(rt, 60 * MIN);
    expect(T.elapsedMs(rt, 62 * MIN)).toBe(7 * MIN);
    expect(T.sessionActiveMs(rt, 62 * MIN)).toBe(7 * MIN);
  });

  it('pause and resume are idempotent', () => {
    const rt = T.pause(T.pause(base(0), 1000), 5000);
    expect(T.elapsedMs(rt, 9000)).toBe(1000);
    const r2 = T.resume(T.resume(rt, 10_000), 20_000);
    expect(r2.runningSince).toBe(10_000);
  });

  it('carries over checkpoint time on the clock but not in session active time', () => {
    const rt = base(0, { baseMs: 14 * MIN });
    expect(T.elapsedMs(rt, 2 * MIN)).toBe(16 * MIN);
    expect(T.sessionActiveMs(rt, 2 * MIN)).toBe(2 * MIN);
    expect(T.remainingMs(rt, 2 * MIN)).toBe(9 * MIN);
  });

  it('marks the exact finish moment once, even when noticed late', () => {
    const rt = base(0);
    expect(T.markFinishedIfDue(rt, 24 * MIN)).toBeNull();
    const done = T.markFinishedIfDue(rt, 40 * MIN)!;
    expect(done.finishedAt).toBe(25 * MIN);
    expect(T.markFinishedIfDue(done, 41 * MIN)).toBeNull();
  });

  it('keeps counting into overtime instead of stopping', () => {
    const rt = base(0);
    expect(T.remainingMs(rt, 30 * MIN)).toBe(-5 * MIN);
    expect(T.progressFraction(rt, 30 * MIN)).toBe(1);
  });

  it('extending a finished countdown clears overtime', () => {
    const rt = T.markFinishedIfDue(base(0), 26 * MIN)!;
    const ext = T.extend(rt, 5 * MIN, 26 * MIN);
    expect(ext.finishedAt).toBeNull();
    expect(T.remainingMs(ext, 26 * MIN)).toBe(4 * MIN);
  });

  it('flow mode counts up with no remaining time', () => {
    const rt = base(0, { mode: 'flow' });
    expect(rt.plannedMs).toBeNull();
    expect(T.remainingMs(rt, 90 * MIN)).toBeNull();
    expect(T.elapsedMs(rt, 90 * MIN)).toBe(90 * MIN);
    expect(T.markFinishedIfDue(rt, 999 * MIN)).toBeNull();
  });

  it('ignores a clock that jumps backwards', () => {
    const rt = base(10 * MIN);
    expect(T.elapsedMs(rt, 5 * MIN)).toBe(0);
  });

  it('snapshots and resumes the same countdown', () => {
    const snap = T.snapshot(base(0), 14 * MIN);
    expect(snap).toEqual({ kind: 'focus', mode: 'countdown', plannedMs: 25 * MIN, elapsedMs: 14 * MIN });
    expect(T.resumeArgsFromSnapshot(snap)).toEqual({ mode: 'countdown', plannedMs: 25 * MIN, baseMs: 14 * MIN });
  });
});
