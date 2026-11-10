import { useEffect } from 'react';
import { orbit, orbitStore, useOrbit } from './store/store';
import type { ViewName } from './types';
import { useHotkeys, useIsPhone, useMediaQuery } from './lib/hooks';
import { localSet } from './lib/local';
import { parkedTasks } from './store/selectors';
import { NavRail } from './components/shell/NavRail';
import { TopBar } from './components/shell/TopBar';
import { TabBar } from './components/shell/TabBar';
import { Toasts } from './components/shell/Toasts';
import { ConfirmDialog } from './components/shell/ConfirmDialog';
import { ShortcutsHelp } from './components/shell/ShortcutsHelp';
import { SearchPalette } from './components/shell/SearchPalette';
import { StorageBanner } from './components/shell/StorageBanner';
import { Dock } from './components/dock/Dock';
import { MobileDock } from './components/dock/MobileDock';
import { DetailPanel } from './components/task/DetailPanel';
import { ParkSheet } from './components/parking/ParkSheet';
import { ResumeCard } from './components/parking/ResumeCard';
import { CaptureDialog } from './components/capture/CaptureDialog';
import { UniverseView } from './components/universe/UniverseView';
import { DayBoard } from './components/day/DayBoard';
import { FocusView } from './components/focus/FocusView';
import { InboxView } from './components/capture/InboxView';
import { NextView } from './components/next/NextView';
import { InsightsView } from './components/insights/InsightsView';
import { SettingsView } from './components/settings/SettingsView';

export const VIEWS: ViewName[] = ['universe', 'today', 'focus', 'inbox', 'next', 'insights', 'settings'];

/** Hash names per view. "settings" is reserved by some hosts (claude.ai artifacts), so it routes as #preferences. */
const toHash = (v: ViewName) => (v === 'settings' ? 'preferences' : v);
const fromHashName = (h: string): ViewName | null => (h === 'preferences' || h === 'settings' ? 'settings' : VIEWS.includes(h as ViewName) ? (h as ViewName) : null);

function useHashRoute() {
  useEffect(() => {
    const fromHash = () => {
      const v = fromHashName(location.hash.replace('#', ''));
      if (v && orbit().view !== v) orbit().setView(v);
    };
    fromHash();
    window.addEventListener('hashchange', fromHash);
    const unsub = orbitStore.subscribe((s, prev) => {
      // On phones the detail panel is a full sheet; leaving the view dismisses it.
      if (s.view !== prev.view && s.selection && window.matchMedia('(max-width: 767px)').matches) s.select(null);
      if (s.view !== prev.view && location.hash !== `#${toHash(s.view)}`) {
        try {
          location.hash = toHash(s.view);
        } catch {
          /* some frames disallow hash writes */
        }
      }
    });
    return () => {
      window.removeEventListener('hashchange', fromHash);
      unsub();
    };
  }, []);
}

function useThemeAndMotion() {
  const theme = useOrbit((s) => s.prefs.theme);
  const motion = useOrbit((s) => s.prefs.motion);
  const prefersLight = useMediaQuery('(prefers-color-scheme: light)');
  const prefersReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  useEffect(() => {
    const t = theme === 'system' ? (prefersLight ? 'light' : 'dark') : theme;
    document.documentElement.dataset.theme = t;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'light' ? '#F4F4F8' : '#0A0C12');
    localSet('orbit-theme', theme);
  }, [theme, prefersLight]);
  useEffect(() => {
    const reduce = motion === 'reduce' || (motion === 'system' && prefersReduced);
    document.documentElement.dataset.motion = reduce ? 'reduce' : 'full';
  }, [motion, prefersReduced]);
}

/** Drives timer completion (chime / notification) once per second while a session exists. */
function useFocusTicker() {
  const hasFocus = useOrbit((s) => !!s.focus);
  useEffect(() => {
    if (!hasFocus) return;
    const id = window.setInterval(() => orbit().tick(), 1000);
    const vis = () => orbit().tick();
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [hasFocus]);
}

function useTitle() {
  const title = useOrbit((s) => {
    const f = s.focus;
    if (!f) return 'ORBIT';
    const t = f.taskId ? s.tasks.find((x) => x.id === f.taskId)?.title : f.kind === 'focus' ? 'Open focus' : 'Break';
    return `● ${t ?? 'Focus'} · ORBIT`;
  });
  useEffect(() => {
    document.title = title;
  }, [title]);
}

function useGlobalHotkeys() {
  useHotkeys((e) => {
    const s = orbit();
    if (s.captureOpen || s.searchOpen || s.park || s.resumeFor || s.confirmReq || s.helpOpen) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      s.setSearchOpen(true);
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (k >= '1' && k <= '7') {
      s.setView(VIEWS[Number(k) - 1]);
    } else if (k === 'c' || k === 'C') {
      e.preventDefault();
      s.setCaptureOpen(true);
    } else if (k === '/') {
      e.preventDefault();
      s.setSearchOpen(true);
    } else if (k === '?') {
      s.setHelpOpen(true);
    } else if (k === 'p' || k === 'P') {
      if (s.focus?.taskId) s.openPark({ taskId: s.focus.taskId });
      else if (s.selection?.type === 'task') {
        const t = s.tasks.find((x) => x.id === s.selection!.id);
        if (t && t.status !== 'done') s.openPark({ taskId: t.id });
      }
    } else if (k === 'r' || k === 'R') {
      const last = parkedTasks(s.tasks)[0];
      if (last) s.openResume(last.id);
    } else if (k === ' ') {
      if (!s.focus) return;
      e.preventDefault();
      if (s.focus.runningSince != null) s.pauseFocus();
      else s.resumeFocus();
    } else if (k === 'x' || k === 'X') {
      if (s.focus?.taskId) s.completeTask(s.focus.taskId);
    } else if (k === 'f' || k === 'F') {
      s.setView('focus');
    } else if (k === 'Escape') {
      if (s.selection) {
        // Closing the panel uses up this Escape (the Universe will not also go up a level).
        e.preventDefault();
        s.select(null);
      }
    }
  });
}

function CurrentView() {
  const view = useOrbit((s) => s.view);
  switch (view) {
    case 'universe':
      return <UniverseView />;
    case 'today':
      return <DayBoard />;
    case 'focus':
      return <FocusView />;
    case 'inbox':
      return <InboxView />;
    case 'next':
      return <NextView />;
    case 'insights':
      return <InsightsView />;
    case 'settings':
      return <SettingsView />;
  }
}

export default function App() {
  const ready = useOrbit((s) => s.ready);
  const hosted = useOrbit((s) => !!s.host);
  const phone = useIsPhone();
  useThemeAndMotion();
  useHashRoute();
  useFocusTicker();
  useTitle();
  useGlobalHotkeys();

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center" aria-busy="true">
        <div className="anim-breathe h-10 w-10 rounded-full bg-gradient-to-br from-accent to-teal" />
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      {!phone && <NavRail />}
      <div className="relative flex min-w-0 flex-1 flex-col">
        {/* Embedded, the host shows its own header; search stays on / and in the Universe toolbar. */}
        {!hosted && <TopBar />}
        <StorageBanner />
        <main id="main" className="relative min-h-0 flex-1 overflow-hidden">
          <CurrentView />
        </main>
        {phone ? <MobileDock /> : <Dock />}
        {phone && <TabBar />}
        <Toasts />
      </div>
      <DetailPanel />
      <ParkSheet />
      <ResumeCard />
      <CaptureDialog />
      <SearchPalette />
      <ShortcutsHelp />
      <ConfirmDialog />
    </div>
  );
}
