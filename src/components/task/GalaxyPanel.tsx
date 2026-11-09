import { useMemo, useState } from 'react';
import { MoreHorizontal, Plus, Trash2, X } from 'lucide-react';
import { useOrbit } from '../../store/store';
import { colorHex } from '../../lib/colors';
import { projectStats } from '../../store/selectors';
import { fmtMinutes, toDateKey } from '../../lib/util';
import { Field, IconButton, Input, Menu, SectionTitle } from '../ui/primitives';
import { ProgressRing, ProjectChip } from '../ui/visuals';
import { ColorPicker } from '../universe/ProjectForm';
import { useDraft } from './actions';

/** Details for a galaxy (a group of projects). */
export function GalaxyPanel({ id }: { id: string }) {
  const galaxy = useOrbit((s) => s.groups.find((g) => g.id === id))!;
  const projects = useOrbit((s) => s.projects);
  const tasks = useOrbit((s) => s.tasks);
  const { select, updateGroup, confirm, deleteGroup, createProject, freeSystemSpot, requestFlight } = useOrbit.getActions();
  const [newName, setNewName] = useState('');
  const today = toDateKey(Date.now());
  const name = useDraft(galaxy.name, (v) => v.trim() && updateGroup(id, { name: v.trim() }), 500);
  const hex = colorHex(galaxy.color);

  const members = useMemo(() => projects.filter((p) => p.groupId === id).map((p) => ({ p, s: projectStats(p.id, tasks, today) })), [projects, tasks, id, today]);
  const total = members.reduce((a, m) => a + m.s.total, 0);
  const done = members.reduce((a, m) => a + m.s.done, 0);
  const open = members.reduce((a, m) => a + m.s.open, 0);
  const effort = members.reduce((a, m) => a + m.s.openEffortMin, 0);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-line px-5 py-3">
        <span className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">Galaxy</span>
        <div className="flex-1" />
        <Menu
          label="Galaxy actions"
          trigger={(p) => (
            <IconButton {...p} label="More actions" size="sm">
              <MoreHorizontal size={18} />
            </IconButton>
          )}
          items={[
            {
              label: 'Delete galaxy',
              icon: <Trash2 size={15} />,
              danger: true,
              onSelect: () =>
                confirm({
                  title: `Delete the “${galaxy.name}” galaxy?`,
                  body: members.length ? `Its ${members.length} project${members.length === 1 ? '' : 's'} will drift into deep space. No projects or tasks are deleted.` : 'It has no projects.',
                  confirmLabel: 'Delete galaxy',
                  danger: true,
                  onConfirm: () => deleteGroup(id),
                }),
            },
          ]}
        />
        <IconButton label="Close (Esc)" size="sm" onClick={() => select(null)}>
          <X size={18} />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <div className="flex items-center gap-4">
          <ProgressRing value={total ? done / total : 0} size={64} stroke={5} color={hex} label={`${total ? Math.round((done / total) * 100) : 0}% of tasks done`}>
            <span className="h-6 w-6 rounded-full" style={{ background: `radial-gradient(circle, #fff 0%, ${hex} 45%, transparent 75%)` }} />
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <input
              value={name.value}
              onChange={(e) => name.onChange(e.target.value)}
              onBlur={name.flush}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              aria-label="Galaxy name"
              className="w-full bg-transparent font-display text-[22px] font-semibold tracking-tight outline-none"
            />
            <p className="tabular text-sm text-muted">
              {members.length} system{members.length === 1 ? '' : 's'} · {open} open · {total ? Math.round((done / total) * 100) : 0}% done{effort ? ` · ${fmtMinutes(effort)} left` : ''}
            </p>
          </div>
        </div>

        <Field group label="Colour">
          <ColorPicker value={galaxy.color} onChange={(color) => updateGroup(id, { color })} />
        </Field>

        <section>
          <SectionTitle>Systems</SectionTitle>
          <form
            className="mb-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!newName.trim()) return;
              const spot = freeSystemSpot(id);
              const p = createProject({ name: newName, groupId: id, x: spot.x, y: spot.y });
              setNewName('');
              requestFlight('system', p.id);
            }}
          >
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New project in this galaxy" aria-label="New project name" />
            <IconButton label="Add project" type="submit" variant="primary" disabled={!newName.trim()}>
              <Plus size={18} />
            </IconButton>
          </form>
          {members.length === 0 && <p className="py-4 text-center text-sm text-muted">No projects yet. Add one above, or move a project here from its details panel.</p>}
          <ul className="space-y-1">
            {members.map(({ p, s }) => (
              <li key={p.id}>
                <button
                  onClick={() => {
                    requestFlight('system', p.id);
                    select({ type: 'project', id: p.id });
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-surface-2"
                >
                  <ProjectChip color={p.color} icon={p.icon} size={28} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    <span className="tabular block text-xs text-muted">
                      {s.open} open{s.parked ? ` · ${s.parked} parked` : ''}
                      {s.overdue ? <span className="text-danger"> · {s.overdue} overdue</span> : null}
                    </span>
                  </span>
                  <span className="tabular text-xs text-muted">{Math.round(s.progress * 100)}%</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
