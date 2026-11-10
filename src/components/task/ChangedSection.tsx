import { useMemo } from 'react';
import { useOrbit } from '../../store/store';
import { shownExtras, shownProjects } from '../../store/shown';
import { changedInSystem, changedText, NO_CHANGED, type ChangedIn, type ChangedPlanet } from '../../host/changed';
import type { Task } from '../../types';
import type { ItemPlanet, MoonSet } from '../../host/adapt';
import { SectionTitle } from '../ui/primitives';
import { ChangedPill } from '../universe/ChangedMark';

const NO_TASKS: Task[] = [];
const NO_ITEMS: ItemPlanet[] = [];
const NO_MOONS: Record<string, MoonSet> = {};

/** What changed in one system of the verse on screen: the same derivation the sky uses. */
export function useChangedIn(systemId: string): ChangedIn {
  const tasks = useOrbit((s) => (s.host?.sky ? NO_TASKS : s.tasks));
  const attachments = useOrbit((s) => shownExtras(s)?.attachments ?? NO_MOONS);
  const items = useOrbit((s) => shownExtras(s)?.items[systemId] ?? NO_ITEMS);
  return useMemo(() => changedInSystem(systemId, tasks.filter((t) => t.projectId === systemId), attachments, items), [systemId, tasks, attachments, items]);
}

/** What changed in every system of a galaxy, by system, in the order the galaxy lists them. */
export function useChangedInGalaxy(galaxyId: string): { system: { id: string; name: string }; changed: ChangedIn }[] {
  const projects = useOrbit((s) => shownProjects(s));
  const tasks = useOrbit((s) => (s.host?.sky ? NO_TASKS : s.tasks));
  const extras = useOrbit((s) => shownExtras(s));
  return useMemo(
    () =>
      projects
        .filter((p) => p.groupId === galaxyId && !p.archived)
        .map((p) => ({ system: { id: p.id, name: p.name }, changed: changedInSystem(p.id, tasks.filter((t) => t.projectId === p.id), extras?.attachments ?? NO_MOONS, extras?.items[p.id] ?? NO_ITEMS) }))
        .filter((x) => x.changed.planets.length > 0),
    [projects, tasks, extras, galaxyId],
  );
}

/** One marked planet: its name, and the moons that changed. Click: fly to it and select it. */
function PlanetRow({ p }: { p: ChangedPlanet }) {
  const { select, requestFlight } = useOrbit.getActions();
  return (
    <li>
      <button
        data-changed-planet={p.id}
        onClick={() => {
          requestFlight('system', p.system);
          select({ type: p.type, id: p.id });
        }}
        className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm">{p.title}</span>
          <span className="block truncate text-xs text-muted" data-changed-moons>
            {p.moons.map((m) => m.label).join(' · ')}
          </span>
        </span>
        <ChangedPill n={p.moons.length} />
      </button>
    </li>
  );
}

/**
 * "Changed", first in a system's or galaxy's panel: each planet with something that changed since it was attached,
 * and what. Nothing is drawn when nothing changed.
 */
export function ChangedSection({ groups }: { groups: { system?: { id: string; name: string }; changed: ChangedIn }[] }) {
  const total = groups.reduce((n, g) => n + g.changed.moons, 0);
  if (!total) return null;
  const planets = groups.reduce((n, g) => n + g.changed.planets.length, 0);
  return (
    <section data-changed-section={total}>
      <SectionTitle right={<span className="tabular text-xs text-danger">{changedText(total)}</span>}>Changed</SectionTitle>
      <p className="mb-1.5 text-xs text-muted">
        {planets === 1 ? 'One planet holds' : `${planets} planets hold`} something that changed since it was attached.
      </p>
      {groups.map((g) => (
        <div key={g.system?.id ?? 'here'} className="mb-1.5">
          {g.system && <p className="px-2 pt-1 text-[11px] font-semibold tracking-wide text-faint uppercase">{g.system.name}</p>}
          <ul className="space-y-0.5">
            {g.changed.planets.map((p) => (
              <PlanetRow key={p.id} p={p} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

export { NO_CHANGED };
