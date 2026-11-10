import { useState } from 'react';
import { CalendarDays, ChartLine, Compass, Inbox, LayoutGrid, Orbit, Plus, Settings2, Timer } from 'lucide-react';
import { useOrbit } from '../../store/store';
import { useAbilities } from '../../host/useAbilities';
import { cx, Modal } from '../ui/primitives';
import { useInboxCount } from './NavRail';
import type { ViewName } from '../../types';

const MORE: { id: ViewName; label: string; icon: typeof Orbit; hint: string }[] = [
  { id: 'focus', label: 'Focus', icon: Timer, hint: 'Timer, breaks and session notes' },
  { id: 'next', label: 'What next?', icon: Compass, hint: 'Suggestions with reasons' },
  { id: 'insights', label: 'Insights', icon: ChartLine, hint: 'Progress and focus time' },
  { id: 'settings', label: 'Settings', icon: Settings2, hint: 'Theme, sounds, backup' },
];

/** Phone navigation: four destinations and a central capture button, with large targets. */
export function TabBar() {
  const view = useOrbit((s) => s.view);
  const setView = useOrbit((s) => s.setView);
  const setCaptureOpen = useOrbit((s) => s.setCaptureOpen);
  const inbox = useInboxCount();
  const can = useAbilities();
  const [more, setMore] = useState(false);
  const moreActive = MORE.some((m) => m.id === view);

  const Tab = ({ id, label, icon: Icon, badge }: { id: ViewName; label: string; icon: typeof Orbit; badge?: number }) => (
    <button
      onClick={() => setView(id)}
      aria-current={view === id ? 'page' : undefined}
      className={cx('relative flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', view === id ? 'text-accent-ink' : 'text-faint')}
    >
      <Icon size={22} strokeWidth={view === id ? 2.2 : 1.8} />
      {label}
      {!!badge && <span className="absolute top-1.5 left-1/2 ml-2 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-[#F5B544] px-1 text-[10px] font-bold text-[#2a1a00]">{badge}</span>}
    </button>
  );

  return (
    <>
      <nav aria-label="Main" className="safe-bottom z-20 flex shrink-0 items-stretch border-t border-line bg-surface/90 px-1 backdrop-blur-xl">
        <Tab id="universe" label="Universe" icon={Orbit} />
        {can.work && <Tab id="today" label="Today" icon={CalendarDays} />}
        <div className="flex flex-1 items-center justify-center">
          {can.capture && <button
            onClick={() => setCaptureOpen(true)}
            aria-label="Capture"
            className="-mt-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-white shadow-[0_8px_24px_-6px_var(--accent)] active:scale-95"
          >
            <Plus size={26} strokeWidth={2.4} />
          </button>}
        </div>
        {can.capture && <Tab id="inbox" label="Inbox" icon={Inbox} badge={inbox} />}
        <button
          onClick={() => setMore(true)}
          aria-haspopup="dialog"
          className={cx('flex h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium', moreActive ? 'text-accent-ink' : 'text-faint')}
        >
          <LayoutGrid size={22} />
          More
        </button>
      </nav>
      <Modal open={more} onClose={() => setMore(false)} title="More">
        <div className="grid grid-cols-2 gap-2.5">
          {MORE.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                setView(m.id);
                setMore(false);
              }}
              className={cx('flex min-h-[92px] flex-col items-start gap-2 rounded-2xl border p-3.5 text-left', view === m.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface-2')}
            >
              <m.icon size={22} className="text-accent-ink" />
              <span>
                <span className="block text-sm font-semibold">{m.label}</span>
                <span className="block text-xs text-muted">{m.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </Modal>
    </>
  );
}
