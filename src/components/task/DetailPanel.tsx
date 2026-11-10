import { useOrbit } from '../../store/store';
import { useIsPhone, useMediaQuery } from '../../lib/hooks';
import { cx } from '../ui/primitives';
import { TaskPanel } from './TaskPanel';
import { ProjectPanel } from './ProjectPanel';
import { GalaxyPanel } from './GalaxyPanel';
import { BeaconPanel, HostGalaxyPanel, HostSystemPanel, ItemPanel } from './HostPanels';
import { findItem, shownExtras, shownGroups, shownProjects } from '../../store/shown';

/**
 * Right-hand detail panel. Wide screens: pushes content. Tablets: overlays.
 * Phones: a full-height sheet.
 */
export function DetailPanel() {
  const selection = useOrbit((s) => s.selection);
  const exists = useOrbit((s) =>
    !selection
      ? false
      : selection.type === 'task'
        ? s.tasks.some((t) => t.id === selection.id)
        : selection.type === 'project'
          ? shownProjects(s).some((p) => p.id === selection.id)
          : selection.type === 'group'
            ? shownGroups(s).some((g) => g.id === selection.id)
            : selection.type === 'item'
              ? !!findItem(s, selection.id)
              : !!shownExtras(s)?.beacons.some((b) => b.id === selection.id),
  );
  // records a host owns get read-only panels of their own
  const hostOwned = useOrbit((s) =>
    !selection
      ? false
      : selection.type === 'project'
        ? !!shownProjects(s).find((p) => p.id === selection.id)?.host
        : selection.type === 'group'
          ? !!shownGroups(s).find((g) => g.id === selection.id)?.host
          : false,
  );
  const select = useOrbit((s) => s.select);
  const phone = useIsPhone();
  const wide = useMediaQuery('(min-width: 1280px)');
  if (!selection || !exists) return null;

  const body =
    selection.type === 'task' ? (
      <TaskPanel key={selection.id} id={selection.id} />
    ) : selection.type === 'project' ? (
      hostOwned ? <HostSystemPanel key={selection.id} id={selection.id} /> : <ProjectPanel key={selection.id} id={selection.id} />
    ) : selection.type === 'group' ? (
      hostOwned ? <HostGalaxyPanel key={selection.id} id={selection.id} /> : <GalaxyPanel key={selection.id} id={selection.id} />
    ) : selection.type === 'item' ? (
      <ItemPanel key={selection.id} id={selection.id} />
    ) : (
      <BeaconPanel key={selection.id} id={selection.id} />
    );
  const label =
    selection.type === 'task'
      ? 'Task details'
      : selection.type === 'project'
        ? hostOwned
          ? 'System details'
          : 'Project details'
        : selection.type === 'group'
          ? 'Galaxy details'
          : selection.type === 'item'
            ? 'Item details'
            : 'Date details';

  if (phone)
    return (
      <div className="fixed inset-0 z-40 flex flex-col">
        <div className="anim-fade absolute inset-0 bg-black/50" onClick={() => select(null)} aria-hidden />
        <aside role="dialog" aria-modal="true" aria-label={label} className="anim-sheet safe-bottom relative mt-10 flex min-h-0 flex-1 flex-col rounded-t-3xl border-t border-line-strong bg-surface">
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-line-strong" aria-hidden />
          {body}
        </aside>
      </div>
    );

  return (
    <aside
      aria-label={label}
      className={cx(
        'anim-panel z-30 flex w-[420px] shrink-0 flex-col border-l border-line bg-surface',
        wide ? 'relative' : 'fixed top-0 right-0 bottom-0 shadow-[-20px_0_60px_-20px_rgba(0,0,0,0.5)]',
      )}
    >
      {body}
    </aside>
  );
}
