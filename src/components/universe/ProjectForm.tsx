import { useEffect, useState, useMemo } from 'react';
import { Check, Plus } from 'lucide-react';
import { PROJECT_COLORS } from '../../lib/colors';
import { useOrbit } from '../../store/store';
import { Button, Field, Input, Modal, Select, Textarea, cx } from '../ui/primitives';
import { PROJECT_ICONS, ProjectGlyph } from '../ui/visuals';

export interface ProjectDraft {
  name: string;
  color: string;
  icon: string;
  groupId: string | null;
  description: string;
}

export function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-1.5">
      {PROJECT_COLORS.map((c) => (
        <button
          key={c.id}
          type="button"
          role="radio"
          aria-checked={value === c.id}
          aria-label={c.name}
          title={c.name}
          onClick={() => onChange(c.id)}
          className={cx('flex h-7 w-7 items-center justify-center rounded-full transition-transform hover:scale-110', value === c.id && 'ring-2 ring-text ring-offset-2 ring-offset-surface')}
          style={{ background: c.hex }}
        >
          {value === c.id && <Check size={15} className="text-white mix-blend-difference" />}
        </button>
      ))}
    </div>
  );
}

export function IconPicker({ value, onChange, color }: { value: string; onChange: (i: string) => void; color: string }) {
  const hex = PROJECT_COLORS.find((c) => c.id === color)?.hex ?? '#8B7CF6';
  return (
    <div role="radiogroup" aria-label="Icon" className="grid grid-cols-8 gap-1.5 sm:grid-cols-11">
      {Object.keys(PROJECT_ICONS).map((k) => (
        <button
          key={k}
          type="button"
          role="radio"
          aria-checked={value === k}
          aria-label={k.replace('-', ' ')}
          title={k.replace('-', ' ')}
          onClick={() => onChange(k)}
          className={cx('flex h-9 w-9 items-center justify-center rounded-lg border transition-colors', value === k ? 'border-transparent' : 'border-line text-muted hover:text-text')}
          style={value === k ? { background: `${hex}2e`, color: hex, boxShadow: `inset 0 0 0 1.5px ${hex}` } : undefined}
        >
          <ProjectGlyph icon={k} size={17} />
        </button>
      ))}
    </div>
  );
}

export function GroupSelect({ value, onChange }: { value: string | null; onChange: (g: string | null) => void }) {
  // ORBIT's own systems go only into ORBIT's own galaxies (a host's galaxies hold only the host's systems)
  const all = useOrbit((s) => s.groups);
  const groups = useMemo(() => all.filter((g) => !g.host), [all]);
  const createGroup = useOrbit((s) => s.createGroup);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  if (adding)
    return (
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          const g = createGroup(name);
          onChange(g.id);
          setAdding(false);
          setName('');
        }}
      >
        <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Galaxy name" aria-label="New galaxy name" />
        <Button type="submit" variant="primary" disabled={!name.trim()}>
          Add
        </Button>
        <Button variant="ghost" onClick={() => setAdding(false)}>
          Cancel
        </Button>
      </form>
    );
  return (
    <div className="flex gap-2">
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)} aria-label="Galaxy">
        <option value="">Deep space (no galaxy)</option>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </Select>
      <Button variant="secondary" onClick={() => setAdding(true)} icon={<Plus size={15} />} title="New galaxy">
        Galaxy
      </Button>
    </div>
  );
}

export function NewProjectDialog({ open, onClose, onCreate, defaultGroupId = null }: { open: boolean; onClose: () => void; onCreate: (d: ProjectDraft) => void; defaultGroupId?: string | null }) {
  const used = useOrbit((s) => s.projects.map((p) => p.color).join(','));
  const firstFree = PROJECT_COLORS.find((c) => !used.split(',').includes(c.id))?.id ?? 'violet';
  const [d, setD] = useState<ProjectDraft>({ name: '', color: firstFree, icon: 'orbit', groupId: defaultGroupId, description: '' });
  useEffect(() => {
    if (open) setD((x) => ({ ...x, groupId: defaultGroupId }));
  }, [open, defaultGroupId]);
  const set = (p: Partial<ProjectDraft>) => setD((x) => ({ ...x, ...p }));
  const submit = () => {
    if (!d.name.trim()) return;
    onCreate(d);
    setD({ name: '', color: firstFree, icon: 'orbit', groupId: null, description: '' });
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project (a star system)"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!d.name.trim()}>
            Create project
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Name">
          <Input data-autofocus value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Thesis chapter 3" />
        </Field>
        <Field group label="Colour">
          <ColorPicker value={d.color} onChange={(color) => set({ color })} />
        </Field>
        <Field group label="Icon">
          <IconPicker value={d.icon} onChange={(icon) => set({ icon })} color={d.color} />
        </Field>
        <Field group label="Galaxy" hint="Galaxies gather related projects. Without one, a project drifts in deep space.">
          <GroupSelect value={d.groupId} onChange={(groupId) => set({ groupId })} />
        </Field>
        <Field label="Description (optional)">
          <Textarea value={d.description} onChange={(e) => set({ description: e.target.value })} rows={2} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function NewGalaxyDialog({ open, onClose, onCreate }: { open: boolean; onClose: () => void; onCreate: (name: string, color: string) => void }) {
  const used = useOrbit((s) => s.groups.map((g) => g.color).join(','));
  const firstFree = PROJECT_COLORS.find((c) => !used.split(',').includes(c.id))?.id ?? 'violet';
  const [name, setName] = useState('');
  const [color, setColor] = useState(firstFree);
  useEffect(() => {
    if (open) {
      setName('');
      setColor(firstFree);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const submit = () => name.trim() && onCreate(name.trim(), color);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New galaxy"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={!name.trim()}>
            Create galaxy
          </Button>
        </>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Field label="Name">
          <Input data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Research, Teaching, Home" />
        </Field>
        <Field group label="Colour">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
        <p className="text-xs text-muted">A galaxy groups related projects. You can move projects into it from their details panel.</p>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
