import type { FocusRuntime } from '../../types';
import { elapsedMs, progressFraction, remainingMs } from '../../lib/timer';
import { fmtClock } from '../../lib/util';

export function timerTone(rt: FocusRuntime, now: number): 'focus' | 'over' | 'break' | 'paused' {
  if (rt.kind !== 'focus') return 'break';
  const r = remainingMs(rt, now);
  if (r != null && r <= 0) return 'over';
  if (rt.runningSince == null) return 'paused';
  return 'focus';
}

export const TONE_COLOR = { focus: 'var(--teal)', over: 'var(--amber)', break: 'var(--accent)', paused: 'var(--muted)' } as const;

export function timerText(rt: FocusRuntime, now: number): string {
  const r = remainingMs(rt, now);
  // Overtime is shown as "+m:ss" (fmtClock prefixes negative values with +).
  return r == null ? fmtClock(elapsedMs(rt, now)) : fmtClock(r <= 0 ? -Math.abs(r) : r);
}

/** Large circular countdown. In overtime the ring stays full and turns amber; flow mode sweeps once per hour. */
export function TimerRing({ rt, now, size = 300, stroke = 12, children }: { rt: FocusRuntime; now: number; size?: number; stroke?: number; children?: React.ReactNode }) {
  const tone = timerTone(rt, now);
  const color = TONE_COLOR[tone];
  const r = (size - stroke) / 2 - 6;
  const C = 2 * Math.PI * r;
  const frac = progressFraction(rt, now);
  // Countdown: the arc shows time remaining (shrinks). Flow: arc grows through each hour.
  const shown = rt.mode === 'flow' || rt.plannedMs == null ? frac : tone === 'over' ? 1 : 1 - frac;
  const ticks = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        {ticks.map((i) => {
          const a = (i / 60) * 2 * Math.PI;
          const r1 = r + stroke / 2 + 4;
          const r2 = r1 + (i % 5 === 0 ? 6 : 3);
          return (
            <line
              key={i}
              x1={size / 2 + Math.cos(a) * r1}
              y1={size / 2 + Math.sin(a) * r1}
              x2={size / 2 + Math.cos(a) * r2}
              y2={size / 2 + Math.sin(a) * r2}
              stroke="var(--line-strong)"
              strokeWidth={i % 5 === 0 ? 1.5 : 1}
            />
          );
        })}
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--surface-3)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - shown)}
          style={{ transition: 'stroke-dashoffset 1s linear, stroke .3s', filter: `drop-shadow(0 0 12px color-mix(in srgb, ${color} 45%, transparent))` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">{children}</div>
    </div>
  );
}
