import { CalendarDays, ChartLine, Compass, Inbox, Keyboard, Orbit, Search, Settings2, Timer } from 'lucide-react';
import type { ViewName } from '../../types';
import { useOrbit, viewAvailable } from '../../store/store';
import { useAbilities } from '../../host/useAbilities';
import { cx } from '../ui/primitives';
import { remainingMs, elapsedMs } from '../../lib/timer';
import { useNow } from '../../lib/hooks';
import { fmtClock } from '../../lib/util';

export const NAV: { id: ViewName; label: string; icon: typeof Orbit; key: string }[] = [
  { id: 'universe', label: 'Universe', icon: Orbit, key: '1' },
  { id: 'today', label: 'Today', icon: CalendarDays, key: '2' },
  { id: 'focus', label: 'Focus', icon: Timer, key: '3' },
  { id: 'inbox', label: 'Inbox', icon: Inbox, key: '4' },
  { id: 'next', label: 'Next', icon: Compass, key: '5' },
  { id: 'insights', label: 'Insights', icon: ChartLine, key: '6' },
  { id: 'settings', label: 'Settings', icon: Settings2, key: '7' },
];

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id="orbit-logo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#A498FF" />
          <stop offset="1" stopColor="#2DD4BF" />
        </linearGradient>
      </defs>
      <ellipse cx="32" cy="32" rx="25" ry="10" fill="none" stroke="var(--accent)" strokeOpacity=".6" strokeWidth="3" transform="rotate(-25 32 32)" />
      <circle cx="32" cy="32" r="11.5" fill="url(#orbit-logo)" />
      <circle cx="53" cy="22" r="4.5" fill="#F5B544" />
    </svg>
  );
}

export function useInboxCount() {
  return useOrbit((s) => s.captures.filter((c) => c.status === 'inbox').length);
}

function FocusIndicator() {
  const focus = useOrbit((s) => s.focus);
  const now = useNow(focus ? 1000 : null);
  if (!focus) return null;
  const r = remainingMs(focus, now);
  const over = r != null && r <= 0;
  return (
    <span className={cx('tabular absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full px-1 text-[9px] font-semibold', over ? 'bg-[#F5B544] text-[#2a1a00]' : 'bg-teal text-[#04201c]', focus.runningSince == null && 'opacity-60')}>
      {fmtClock(r ?? elapsedMs(focus, now)).replace(/^\+/, '+')}
    </span>
  );
}

export function NavRail() {
  const view = useOrbit((s) => s.view);
  const setView = useOrbit((s) => s.setView);
  const setHelpOpen = useOrbit((s) => s.setHelpOpen);
  const setSearchOpen = useOrbit((s) => s.setSearchOpen);
  const inbox = useInboxCount();
  const can = useAbilities();
  return (
    <nav aria-label="Main" className="z-20 flex w-[76px] shrink-0 flex-col items-center gap-1 border-r border-line bg-surface/70 py-4 backdrop-blur-xl">
      <button className="mb-4 rounded-xl p-1" onClick={() => setView('universe')} aria-label="ORBIT home">
        <Logo />
      </button>
      {NAV.filter((n) => viewAvailable(can, n.id)).map((n) => {
        const active = view === n.id;
        return (
          <button
            key={n.id}
            onClick={() => setView(n.id)}
            aria-current={active ? 'page' : undefined}
            title={`${n.label} (${n.key})`}
            className={cx(
              'group relative flex w-[60px] flex-col items-center gap-1 rounded-xl py-2 text-[10.5px] font-medium transition-colors',
              active ? 'text-text' : 'text-faint hover:text-text',
            )}
          >
            <span className={cx('relative flex h-9 w-11 items-center justify-center rounded-xl transition-colors', active ? 'bg-accent-soft text-accent-ink' : 'group-hover:bg-surface-2')}>
              <n.icon size={20} strokeWidth={active ? 2.2 : 1.8} />
              {n.id === 'inbox' && inbox > 0 && (
                <span className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#F5B544] px-1 text-[10px] font-bold text-[#2a1a00]">{inbox}</span>
              )}
              {n.id === 'focus' && <FocusIndicator />}
            </span>
            {n.label}
          </button>
        );
      })}
      <div className="flex-1" />
      {can.hosted && (
        <button onClick={() => setSearchOpen(true)} className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl text-faint hover:bg-surface-2 hover:text-text" title="Search tasks (/)" aria-label="Search tasks">
          <Search size={18} />
        </button>
      )}
      <button onClick={() => setHelpOpen(true)} className="flex h-10 w-10 items-center justify-center rounded-xl text-faint hover:bg-surface-2 hover:text-text" title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">
        <Keyboard size={18} />
      </button>
    </nav>
  );
}
