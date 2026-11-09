import { Plus, Search, WifiOff } from 'lucide-react';
import { useOrbit } from '../../store/store';
import { useIsPhone, useOnline } from '../../lib/hooks';
import { Button, IconButton, Kbd } from '../ui/primitives';
import { Logo } from './NavRail';
import { plural } from '../../lib/util';

const TITLES = {
  universe: 'Universe',
  today: 'Today',
  focus: 'Focus',
  inbox: 'Inbox',
  next: 'What next?',
  insights: 'Insights',
  settings: 'Settings',
} as const;

function Subtitle() {
  const view = useOrbit((s) => s.view);
  const projects = useOrbit((s) => s.projects.length);
  const open = useOrbit((s) => s.tasks.filter((t) => t.status !== 'done').length);
  const inbox = useOrbit((s) => s.captures.filter((c) => c.status === 'inbox').length);
  if (view === 'universe') return <>{projects ? `${plural(projects, 'project')} · ${plural(open, 'open task')}` : 'Your projects, at a glance'}</>;
  if (view === 'inbox') return <>{inbox ? `${inbox} to sort` : 'All sorted'}</>;
  if (view === 'next') return <>Suggestions with reasons, not magic</>;
  if (view === 'today') return <>Plan loosely, adjust freely</>;
  if (view === 'focus') return <>One thing at a time</>;
  if (view === 'insights') return <>What you have done, not how you rank</>;
  return <>Stored on this device only</>;
}

export function TopBar() {
  const view = useOrbit((s) => s.view);
  const setCaptureOpen = useOrbit((s) => s.setCaptureOpen);
  const setSearchOpen = useOrbit((s) => s.setSearchOpen);
  const phone = useIsPhone();
  const online = useOnline();

  return (
    <header className="safe-top z-10 flex shrink-0 items-center gap-3 border-b border-line bg-bg/60 px-4 backdrop-blur-xl md:px-6">
      <div className="flex h-14 min-w-0 flex-1 items-center gap-3 md:h-16">
        {phone && <Logo size={26} />}
        <div className="min-w-0">
          <h1 className="truncate font-display text-[17px] leading-tight font-semibold tracking-tight md:text-xl">{TITLES[view]}</h1>
          <p className="truncate text-xs text-muted">
            <Subtitle />
          </p>
        </div>
      </div>
      {!online && (
        <span className="hidden items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-xs text-muted sm:inline-flex" title="ORBIT works fully offline">
          <WifiOff size={13} /> Offline — all features work
        </span>
      )}
      {phone ? (
        <IconButton label="Search" onClick={() => setSearchOpen(true)}>
          <Search size={20} />
        </IconButton>
      ) : (
        <>
          <button
            onClick={() => setSearchOpen(true)}
            className="hidden h-10 w-56 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 text-sm text-faint transition-colors hover:border-line-strong hover:text-muted lg:flex"
          >
            <Search size={16} />
            <span className="flex-1 text-left">Search tasks…</span>
            <Kbd>/</Kbd>
          </button>
          <IconButton label="Search (/)" className="lg:hidden" onClick={() => setSearchOpen(true)}>
            <Search size={19} />
          </IconButton>
          <Button variant="primary" onClick={() => setCaptureOpen(true)} icon={<Plus size={17} />}>
            Capture
            <span className="ml-1 hidden rounded-md bg-white/20 px-1.5 text-[11px] font-semibold lg:inline">C</span>
          </Button>
        </>
      )}
    </header>
  );
}
