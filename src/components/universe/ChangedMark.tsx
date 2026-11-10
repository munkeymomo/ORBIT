import { changedText } from '../../host/changed';
import { cx } from '../ui/primitives';

/**
 * How "something changed" looks in the sky and in the panels. One red (the same coral as every warning), told apart
 * from "overdue" by SHAPE:
 *   - overdue: a solid round badge with a number, and a whole glowing ring on a planet;
 *   - a date that is late: a diamond;
 *   - changed: an outlined square-cornered tag with "≠" (a star), a short solid notch on a planet's rim, and a pill
 *     with "≠" in front of the words "n changed".
 */
export const CHANGED_HEX = '#f2766b';

/** The "≠" in front of the words: decorative, the words carry the meaning. */
export function NotEqual({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden className="inline-block shrink-0 overflow-visible align-[-1px]">
      <path d="M2 4.2h8M2 7.8h8M8.6 1.2 3.4 10.8" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** A small pill: "≠ 2 changed". */
export function ChangedPill({ n, className, hook = 'data-changed-pill' }: { n: number; className?: string; hook?: string }) {
  return (
    <span
      {...{ [hook]: n }}
      className={cx('inline-flex items-center gap-1 rounded-[5px] border border-danger/70 bg-[#1b0d11]/90 px-1.5 text-[10.5px] leading-[15px] font-semibold whitespace-nowrap text-danger', className)}
    >
      <NotEqual size={9} />
      {changedText(n)}
    </span>
  );
}

/** On a star: an outlined tag with "≠" and the number. Its accessible name is "n changed". */
export function ChangedBadge({ n, small = false, style }: { n: number; small?: boolean; style?: React.CSSProperties }) {
  return (
    <span
      role="img"
      aria-label={changedText(n)}
      title={changedText(n)}
      data-changed-badge={n}
      className={cx(
        'absolute flex items-center gap-0.5 rounded-[5px] border-[1.5px] border-danger bg-[#1b0d11] font-bold text-danger shadow-[0_0_8px_rgba(242,118,107,.55)] ring-2 ring-[#0a0c12]',
        small ? 'h-4 px-0.5 text-[9px]' : 'h-5 px-1 text-[10.5px]',
      )}
      style={style}
    >
      <NotEqual size={small ? 8 : 10} />
      {n}
    </span>
  );
}

/** On a planet: a short solid notch on its rim, at the top. `d` is the planet's diameter on screen. */
export function ChangedRim({ d, n }: { d: number; n: number }) {
  const r = d / 2 + 3.4;
  const box = 2 * r + 12;
  const c = box / 2;
  const a0 = -Math.PI / 2 - 0.95;
  const a1 = -Math.PI / 2 + 0.95;
  const pt = (a: number) => `${(c + Math.cos(a) * r).toFixed(2)} ${(c + Math.sin(a) * r).toFixed(2)}`;
  return (
    <svg data-changed-rim={n} className="pointer-events-none absolute overflow-visible" style={{ left: '50%', top: '50%', marginLeft: -c, marginTop: -c }} width={box} height={box} aria-hidden>
      <path d={`M ${pt(a0)} A ${r} ${r} 0 0 1 ${pt(a1)}`} fill="none" stroke={CHANGED_HEX} strokeWidth={3} strokeLinecap="round" style={{ filter: 'drop-shadow(0 0 4px rgba(242,118,107,.8))' }} />
    </svg>
  );
}
