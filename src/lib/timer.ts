import type { FocusRuntime, SessionKind, TimerMode, TimerSnapshot } from '../types';

/**
 * Timestamp-based timer maths. Nothing here counts ticks: every value is
 * derived from stored timestamps and the `now` passed in, so reloads, sleep
 * and background throttling cannot make the clock drift.
 */

/** Running time in the current session only (what gets recorded as activeMs). */
export function sessionActiveMs(rt: FocusRuntime, now: number): number {
  const running = rt.runningSince != null ? Math.max(0, now - rt.runningSince) : 0;
  return rt.accumulatedMs + running;
}

/** Total time shown on the clock, including time carried over from a checkpoint. */
export function elapsedMs(rt: FocusRuntime, now: number): number {
  return rt.baseMs + sessionActiveMs(rt, now);
}

/** Remaining countdown time; negative means overtime. Null in flow mode. */
export function remainingMs(rt: FocusRuntime, now: number): number | null {
  if (rt.mode === 'flow' || rt.plannedMs == null) return null;
  return rt.plannedMs - elapsedMs(rt, now);
}

export function isOvertime(rt: FocusRuntime, now: number): boolean {
  const r = remainingMs(rt, now);
  return r != null && r <= 0;
}

/** 0..1 fraction of the countdown used (capped at 1); for flow mode, fraction of the current hour. */
export function progressFraction(rt: FocusRuntime, now: number): number {
  const el = elapsedMs(rt, now);
  if (rt.mode === 'flow' || rt.plannedMs == null) return (el % 3_600_000) / 3_600_000;
  return Math.min(1, el / Math.max(1, rt.plannedMs));
}

export function createRuntime(args: {
  sessionId: string;
  taskId: string | null;
  kind: SessionKind;
  mode: TimerMode;
  plannedMs: number | null;
  now: number;
  baseMs?: number;
  fromCheckpointId?: string | null;
  cycleCount?: number;
}): FocusRuntime {
  return {
    sessionId: args.sessionId,
    taskId: args.taskId,
    kind: args.kind,
    mode: args.mode,
    plannedMs: args.mode === 'flow' ? null : args.plannedMs,
    baseMs: Math.max(0, args.baseMs ?? 0),
    accumulatedMs: 0,
    runningSince: args.now,
    finishedAt: null,
    fromCheckpointId: args.fromCheckpointId ?? null,
    cycleCount: args.cycleCount ?? 0,
  };
}

export function pause(rt: FocusRuntime, now: number): FocusRuntime {
  if (rt.runningSince == null) return rt;
  return { ...rt, accumulatedMs: sessionActiveMs(rt, now), runningSince: null };
}

export function resume(rt: FocusRuntime, now: number): FocusRuntime {
  if (rt.runningSince != null) return rt;
  return { ...rt, runningSince: now };
}

/** Extend a countdown (e.g. "+5 min") without restarting it. */
export function extend(rt: FocusRuntime, addMs: number, now: number): FocusRuntime {
  if (rt.mode === 'flow' || rt.plannedMs == null) return rt;
  const plannedMs = rt.plannedMs + addMs;
  const stillOver = rt.baseMs + sessionActiveMs(rt, now) >= plannedMs;
  return { ...rt, plannedMs, finishedAt: stillOver ? rt.finishedAt : null };
}

/** Marks the moment a countdown crossed zero. Returns null when nothing changed. */
export function markFinishedIfDue(rt: FocusRuntime, now: number): FocusRuntime | null {
  if (rt.finishedAt != null || rt.mode === 'flow' || rt.plannedMs == null) return null;
  const r = remainingMs(rt, now);
  if (r == null || r > 0) return null;
  // The exact crossing time, even if we only noticed later (e.g. after a reload).
  const crossedAt = rt.runningSince != null ? now + r : now;
  return { ...rt, finishedAt: crossedAt };
}

export function snapshot(rt: FocusRuntime, now: number): TimerSnapshot {
  return { kind: rt.kind, mode: rt.mode, plannedMs: rt.plannedMs, elapsedMs: elapsedMs(rt, now) };
}

/** What a resumed timer should look like given a snapshot: continue the same countdown or flow. */
export function resumeArgsFromSnapshot(s: TimerSnapshot): { mode: TimerMode; plannedMs: number | null; baseMs: number } {
  if (s.mode === 'flow' || s.plannedMs == null) return { mode: 'flow', plannedMs: null, baseMs: s.elapsedMs };
  // If the countdown had already run out, continue in overtime rather than pretending time is left.
  return { mode: 'countdown', plannedMs: s.plannedMs, baseMs: s.elapsedMs };
}

export const minutes = (m: number) => Math.round(m * 60_000);
