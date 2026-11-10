import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { useOrbit } from '../../store/store';
import { useAbilities } from '../../host/useAbilities';
import { useIsPhone } from '../../lib/hooks';
import { Button, Input } from '../ui/primitives';
import { Logo } from '../shell/NavRail';
import { ColorPicker, NewGalaxyDialog, NewProjectDialog, type ProjectDraft } from './ProjectForm';
import { UniverseCanvas } from './Canvas';
import { UniverseCards } from './Cards';
import { PROJECT_COLORS } from '../../lib/colors';

export function UniverseView() {
  const count = useOrbit((s) => s.projects.filter((p) => !p.archived).length);
  const galaxyCount = useOrbit((s) => s.groups.length);
  const { createProject, createGroup, select, toggleExpanded, freeSystemSpot, requestFlight } = useOrbit.getActions();
  const phone = useIsPhone();
  const hosted = useOrbit((s) => !!s.host);
  const [newSystemIn, setNewSystemIn] = useState<{ groupId: string | null } | null>(null);
  const [newGalaxy, setNewGalaxy] = useState(false);

  const create = (d: ProjectDraft) => {
    const spot = freeSystemSpot(d.groupId);
    const p = createProject({ ...d, ...spot });
    toggleExpanded(p.id, true);
    setNewSystemIn(null);
    requestFlight('system', p.id);
    select({ type: 'project', id: p.id });
  };

  const personal = useAbilities().personal;
  // hosted with ORBIT's own records: a first system of one's own, but never the example workspace
  if (count === 0 && galaxyCount === 0) return hosted && !personal ? <EmptyHosted /> : <FirstRun onCreate={create} hosted={hosted} />;

  return (
    <>
      {phone ? (
        <UniverseCards onNewProject={() => setNewSystemIn({ groupId: null })} />
      ) : (
        <UniverseCanvas onNewSystem={(groupId) => setNewSystemIn({ groupId })} onNewGalaxy={() => setNewGalaxy(true)} />
      )}
      <NewProjectDialog open={!!newSystemIn} defaultGroupId={newSystemIn?.groupId ?? null} onClose={() => setNewSystemIn(null)} onCreate={create} />
      <NewGalaxyDialog
        open={newGalaxy}
        onClose={() => setNewGalaxy(false)}
        onCreate={(name, color) => {
          const g = createGroup(name, color);
          setNewGalaxy(false);
          requestFlight('galaxy', g.id);
        }}
      />
    </>
  );
}

/** Embedded, with nothing in the verse: no first-run form, no example (the host owns what appears here). */
function EmptyHosted() {
  const can = useAbilities();
  const error = useOrbit((s) => s.host?.error);
  return (
    <div className="canvas-dots flex h-full items-center justify-center p-5">
      <div className="max-w-sm rounded-3xl border border-line bg-surface/80 p-6 text-center shadow-panel backdrop-blur-xl">
        <Logo size={40} />
        <p className="mt-3 font-display text-lg font-semibold">Nothing to show yet</p>
        <p className="mt-1 text-sm text-muted">{error ?? `When ${can.name} has records for this view, they appear here as galaxies, stars and planets.`}</p>
      </div>
    </div>
  );
}

function FirstRun({ onCreate, hosted = false }: { onCreate: (d: ProjectDraft) => void; hosted?: boolean }) {
  const loadExample = useOrbit((s) => s.loadExample);
  const [name, setName] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[0].id);
  return (
    <div className="canvas-dots flex h-full items-center justify-center overflow-y-auto p-5">
      <div className="anim-fade w-full max-w-md rounded-3xl border border-line bg-surface/80 p-6 shadow-panel backdrop-blur-xl md:p-8">
        <div className="mb-5 flex items-center gap-3">
          <Logo size={44} />
          <div>
            <h2 className="font-display text-2xl font-semibold tracking-tight">Welcome to ORBIT</h2>
            <p className="text-sm text-muted">See your work. Never lose your place.</p>
          </div>
        </div>
        <p className="mb-5 text-sm leading-relaxed text-muted">
          Each project becomes a star with its tasks as planets. Related projects gather into galaxies. Start with one thing you are working on — you can add more later.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onCreate({ name, color, icon: 'orbit', groupId: null, description: '' });
          }}
          className="space-y-4"
        >
          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-muted">Your first project</span>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Thesis, Website, House move" className="h-12 text-base" />
          </label>
          <ColorPicker value={color} onChange={setColor} />
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={!name.trim()}>
            Create project
          </Button>
        </form>
        {!hosted && (
          <>
            <div className="my-5 flex items-center gap-3 text-xs text-faint">
              <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
            </div>
            <Button variant="secondary" className="w-full" icon={<Sparkles size={16} />} onClick={() => void loadExample()}>
              Explore an example workspace
            </Button>
            <p className="mt-3 text-center text-xs text-faint">Example items are labelled and can be removed in Settings. Everything is stored on this device only.</p>
          </>
        )}
      </div>
    </div>
  );
}
