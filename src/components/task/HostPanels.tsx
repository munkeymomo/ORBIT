import { useEffect, useMemo, useRef, useState } from 'react';
import { onPanelSection, takePanelSection } from './panelSection';
import { ExternalLink, Link2, MoreHorizontal, Plus, Search, X } from 'lucide-react';
import { useOrbit } from '../../store/store';
import type { HostRef, Task } from '../../types';
import type { Also, Attachment, Beacon, Collection, Family, HostAction } from '../../host/types';
import type { ItemPlanet } from '../../host/adapt';
import { findItem, shownExtras, shownGroups, shownProjects } from '../../store/shown';
import { useOfferedVerses, WormholeMark, Wormholes, wormholeText } from '../host/Wormholes';
import { useAbilities } from '../../host/useAbilities';
import { may } from '../../host/caps';
import { CLUTTER } from '../universe/space';
import { colorHex } from '../../lib/colors';
import { projectStats } from '../../store/selectors';
import { daysBetween, friendlyDay, toDateKey } from '../../lib/util';
import { Button, IconButton, Input, Menu, SectionTitle, cx } from '../ui/primitives';
import { DueBadge, PriorityBars, ProgressRing, ProjectChip } from '../ui/visuals';

/*
 * Panels for records a host owns. They show what the host sent and offer to open it in the host. What can be
 * changed from here is what the record's caps allow: new tasks in a system (create), and taking linked items
 * off a task (attach) or linking more through the host's own picker. Everything else is the host's.
 */

/** Where a record is kept, and a way there. */
export function KeptBy({ refOf }: { refOf: HostRef }) {
  const can = useAbilities();
  const openInHost = useOrbit((s) => s.openInHost);
  return (
    // a long host name wraps; the button goes under the words when they need the room
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
      <span className="min-w-0 flex-[1_1_160px] break-words text-muted">{can.storedLabel}</span>
      {refOf.open && (
        <Button size="sm" variant="secondary" icon={<ExternalLink size={14} />} onClick={() => openInHost(refOf.open)} className="max-w-full" title={can.openLabel}>
          <span className="truncate">{can.openLabel}</span>
        </Button>
      )}
    </div>
  );
}

function FamilyDot({ family, families, state, flag }: { family: string; families: Record<string, Family>; state: Attachment['state']; flag?: string }) {
  const hex = flag === 'changed' ? '#f2766b' : (families[family]?.color ?? '#9aa3b8');
  return <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={state === 'live' ? { background: hex } : { boxShadow: `inset 0 0 0 1.6px ${hex}` }} aria-hidden />;
}

function StateBadge({ a }: { a: Attachment }) {
  if (a.flag === 'changed') return <span className="rounded bg-danger-soft px-1.5 py-0.5 text-[10px] font-semibold text-danger uppercase">Changed</span>;
  if (a.state === 'live') return null;
  return <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-muted uppercase">{a.state}</span>;
}

/** A small button with a menu of a record's wormholes (the same thing in other verses). */
export function WormholeMenu({ also, label }: { also?: Also[]; label: string }) {
  const verses = useOfferedVerses();
  const follow = useOrbit((s) => s.followWormhole);
  const shown = useOrbit((s) => s.host?.shown);
  const holes = (also ?? []).filter((a) => verses.has(a.verse));
  if (!holes.length) return null;
  return (
    <Menu
      label={`${label} elsewhere`}
      align="right"
      trigger={(p) => (
        <IconButton {...p} label={`${label}: the same thing in another view`} size="xs" className="text-[#c9b3ff]">
          <WormholeMark size={13} />
        </IconButton>
      )}
      items={holes.map((a) => {
        const t = wormholeText(a, verses, shown);
        return { label: `${t.head}${t.note ? ` — ${t.note}` : ''}`, icon: <WormholeMark size={13} />, onSelect: () => void follow(a) };
      })}
    />
  );
}

/** One attachment (a moon, or an item in a belt) as a row. */
export function AttachmentRow({ a, families, onDetach }: { a: Attachment; families: Record<string, Family>; onDetach?: () => void }) {
  const openInHost = useOrbit((s) => s.openInHost);
  return (
    <li className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
      <FamilyDot family={a.family} families={families} state={a.state} flag={a.flag} />
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-sm', a.state === 'gone' && 'text-faint line-through')}>{a.label}</span>
        <span className="block truncate text-xs text-muted">{[families[a.family]?.label ?? a.kind, a.sub].filter(Boolean).join(' · ')}</span>
      </span>
      <StateBadge a={a} />
      <WormholeMenu also={a.also} label={a.label} />
      {a.open && (
        <IconButton label={`Open ${a.label}`} size="xs" onClick={() => openInHost(a.open)}>
          <ExternalLink size={13} />
        </IconButton>
      )}
      {onDetach && (
        <IconButton label={`Take ${a.label} off this task`} size="xs" onClick={onDetach}>
          <X size={13} />
        </IconButton>
      )}
    </li>
  );
}

/** A task's moons, listed (TaskPanel). */
export function LinkedItems({ taskId }: { taskId: string }) {
  const set = useOrbit((s) => s.host?.attachments[taskId]);
  const families = useOrbit((s) => s.host?.families ?? {});
  const pickable = useOrbit((s) => s.host?.info.caps.pick);
  const ref = useOrbit((s) => s.tasks.find((t) => t.id === taskId)?.host);
  const { detachLinked, pickLinked } = useOrbit.getActions();
  const can = useAbilities();
  const attach = !!ref && !ref.pending && may(can, ref, 'attach');
  const offer = attach ? (pickable ?? []) : [];
  const empty = !set || (!set.items.length && !set.more);
  if (empty && !offer.length) return null;
  const label = (f: string) => families[f]?.label ?? f;
  const pick = (f: string) => void pickLinked(f, { planet: taskId });
  return (
    <section>
      <SectionTitle
        right={
          <span className="flex items-center gap-2">
            {!empty && <span className="tabular text-xs text-muted">{set!.items.length + set!.more}</span>}
            {offer.length === 1 && (
              <Button size="sm" variant="ghost" icon={<Link2 size={14} />} onClick={() => pick(offer[0])}>
                Link {label(offer[0]).toLowerCase()}…
              </Button>
            )}
            {offer.length > 1 && (
              <Menu
                label="Link an item"
                align="right"
                trigger={(p) => (
                  <Button {...p} size="sm" variant="ghost" icon={<Link2 size={14} />}>
                    Link…
                  </Button>
                )}
                items={offer.map((f) => ({ label: label(f), icon: <span className="h-2.5 w-2.5 rounded-full" style={{ background: families[f]?.color ?? '#9aa3b8' }} />, onSelect: () => pick(f) }))}
              />
            )}
          </span>
        }
      >
        Linked items
      </SectionTitle>
      {empty ? (
        <p className="px-2 text-sm text-muted">Nothing linked yet; {can.name} shows its own picker.</p>
      ) : (
        <ul className="space-y-0.5">
          {set!.items.map((a) => (
            <AttachmentRow key={a.id} a={a} families={families} onDetach={attach && a.link ? () => detachLinked(taskId, a.id) : undefined} />
          ))}
        </ul>
      )}
      {!empty && set!.more > 0 && <p className="mt-1.5 px-2 text-xs text-muted">+{set!.more} more in {can.name}</p>}
    </section>
  );
}

/** What a system holds that no task uses (its belt), listed or counted. */
function Belt({ c }: { c: Collection }) {
  const families = useOrbit((s) => shownExtras(s)?.families ?? NO_FAMILIES);
  const openInHost = useOrbit((s) => s.openInHost);
  const can = useAbilities();
  const many = c.total > CLUTTER.belt || !c.items?.length;
  return (
    <section>
      <SectionTitle
        right={
          c.open && (
            <button className="inline-flex items-center gap-1 text-xs text-muted hover:text-text" onClick={() => openInHost(c.open)}>
              Open all <ExternalLink size={11} />
            </button>
          )
        }
      >
        Held here · {c.total}
      </SectionTitle>
      {many ? (
        <ul className="space-y-1">
          {Object.entries(c.counts ?? {}).map(([f, n]) => (
            <li key={f} className="flex items-center gap-2.5 px-2 py-1 text-sm">
              <FamilyDot family={f} families={families} state="live" />
              <span className="flex-1">{families[f]?.label ?? f}</span>
              <span className="tabular text-muted">{n}</span>
            </li>
          ))}
          {!c.counts && <li className="px-2 text-sm text-muted">Too many to list here; open them in {can.name}.</li>}
        </ul>
      ) : (
        <ul className="space-y-0.5">
          {c.items!.map((a) => (
            <AttachmentRow key={a.id} a={a} families={families} />
          ))}
        </ul>
      )}
    </section>
  );
}

export const BEACON_TONE: Record<Beacon['state'], string> = {
  planned: 'text-text',
  soon: 'text-amber',
  late: 'text-danger',
  achieved: 'text-teal',
  rescoped: 'text-faint',
};

export function beaconWhen(b: Beacon, today: string) {
  if (b.state === 'achieved') return 'achieved';
  if (b.state === 'rescoped') return 'rescoped';
  if (!b.due) return b.state;
  const d = daysBetween(today, b.due);
  return d < 0 ? `${-d} days late` : d === 0 ? 'today' : `in ${d} days`;
}

export function BeaconDiamond({ b }: { b: Beacon }) {
  const col = { planned: '#ffffff', soon: '#f5b544', late: '#f2766b', achieved: '#2dd4bf', rescoped: '#8e95a9' }[b.state];
  return <span className={cx('block h-2.5 w-2.5 shrink-0 rotate-45 border-[1.6px]', b.state === 'rescoped' && 'border-dashed')} style={{ borderColor: col, background: b.state === 'achieved' ? col : 'transparent' }} aria-hidden />;
}

function BeaconList({ beacons }: { beacons: Beacon[] }) {
  const select = useOrbit((s) => s.select);
  const today = toDateKey(Date.now());
  if (!beacons.length) return null;
  return (
    <section>
      <SectionTitle>Dates</SectionTitle>
      <ul className="space-y-0.5">
        {beacons.map((b) => (
          <li key={b.id}>
            <button onClick={() => select({ type: 'beacon', id: b.id })} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
              <BeaconDiamond b={b} />
              <span className="min-w-0 flex-1 truncate text-sm">
                {b.code && <span className="mr-1.5 font-semibold">{b.code}</span>}
                {b.title}
              </span>
              <span className={cx('shrink-0 text-xs', BEACON_TONE[b.state])}>{beaconWhen(b, today)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Facts({ facts }: { facts?: { label: string; value: string }[] }) {
  if (!facts?.length) return null;
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      {facts.map((f) => (
        <div key={f.label} className="contents">
          <dt className="text-muted">{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Chips({ items }: { items: (string | undefined)[] }) {
  const shown = items.filter(Boolean) as string[];
  if (!shown.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((t) => (
        <span key={t} className="rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs text-muted">
          {t}
        </span>
      ))}
    </div>
  );
}

const NO_FAMILIES: Record<string, Family> = {};

function Header({ kind, onClose, actions, ctx }: { kind: string; onClose: () => void; actions?: HostAction[]; ctx?: Record<string, string> }) {
  const hostAction = useOrbit((s) => s.hostAction);
  const verse = useOrbit((s) => s.host?.shown ?? '');
  return (
    <header className="flex items-center gap-2 border-b border-line px-5 py-3">
      <span className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">{kind}</span>
      <div className="flex-1" />
      {!!actions?.length && (
        // the host's own dialogs for this record: ORBIT draws none of them
        <Menu
          label={`${kind} actions`}
          align="right"
          trigger={(p) => (
            <IconButton {...p} label={`${kind} actions`} size="sm">
              <MoreHorizontal size={18} />
            </IconButton>
          )}
          items={actions.map((a) => ({ label: a.label, onSelect: () => void hostAction(a.id, { verse, ...(ctx ?? {}) }) }))}
        />
      )}
      <IconButton label="Close (Esc)" size="sm" onClick={onClose}>
        <X size={18} />
      </IconButton>
    </header>
  );
}

function TaskRows({ tasks, today }: { tasks: Task[]; today: string }) {
  const select = useOrbit((s) => s.select);
  return (
    <ul className="space-y-1">
      {tasks.map((t) => (
        <li key={t.id}>
          <button onClick={() => select({ type: 'task', id: t.id })} className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-surface-2">
            <span className={cx('h-3 w-3 shrink-0 rounded-full border-2', t.status === 'done' ? 'border-teal bg-teal' : 'border-line-strong')} />
            <span className={cx('min-w-0 flex-1 truncate text-sm', t.status === 'done' && 'text-faint line-through')}>{t.title}</span>
            {t.status !== 'done' && (
              <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                {t.due && <DueBadge due={t.due} today={today} />}
                <PriorityBars priority={t.priority} />
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A new task in a host's system: shown at once, and created by the host (see the store's createTask). */
function NewHostTask({ systemId }: { systemId: string }) {
  const createTask = useOrbit((s) => s.createTask);
  const [title, setTitle] = useState('');
  return (
    <form
      className="mb-2 flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        createTask({ projectId: systemId, title: title.trim() });
        setTitle('');
      }}
    >
      <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New task" aria-label="New task title" className="h-9" />
      <IconButton label="New task" type="submit" variant="secondary" size="sm" className="!h-9 !w-9" disabled={!title.trim()}>
        <Plus size={16} />
      </IconButton>
    </form>
  );
}

/** A system a host owns. */
export function HostSystemPanel({ id }: { id: string }) {
  const project = useOrbit((s) => shownProjects(s).find((p) => p.id === id))!;
  const tasks = useOrbit((s) => (s.host?.sky ? NO_TASKS : s.tasks));
  const collection = useOrbit((s) => shownExtras(s)?.collections[id]);
  const beacons = useOrbit((s) => shownExtras(s)?.beacons);
  const items = useOrbit((s) => shownExtras(s)?.items[id] ?? NO_ITEM_LIST);
  const inSky = useOrbit((s) => !!s.host?.sky);
  const portalVerse = useOfferedVerses().get(project.host?.portal?.verse ?? '');
  const { select, openInHost, showVerse } = useOrbit.getActions();
  const can = useAbilities();
  const [showDone, setShowDone] = useState(false);
  const today = toDateKey(Date.now());
  const ref = project.host!;
  const stats = useMemo(() => projectStats(id, tasks, today), [id, tasks, today]);
  const own = useMemo(
    () => tasks.filter((t) => t.projectId === id).sort((a, b) => Number(a.status === 'done') - Number(b.status === 'done') || b.priority - a.priority || (a.due ?? '9999').localeCompare(b.due ?? '9999')),
    [tasks, id],
  );
  const mine = useMemo(() => (beacons ?? []).filter((b) => b.system === id), [beacons, id]);
  const visible = showDone ? own : own.filter((t) => t.status !== 'done');
  const busy = stats.open > CLUTTER.tasks;
  const canCreate = !ref.portal && !inSky && may(can, ref, 'create');
  const itemCount = items.length ? Math.max(ref.count ?? 0, items.length) : 0;
  const showTasks = stats.total > 0 || canCreate || (!items.length && !ref.portal);
  const LIST_MAX = 60;
  // opened from the belt in the sky: show the belt list
  const beltRef = useRef<HTMLDivElement>(null);
  const [beltFlash, setBeltFlash] = useState(false);
  useEffect(() => {
    const show = () => {
      if (takePanelSection(id) !== 'belt' || !beltRef.current) return;
      beltRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
      setBeltFlash(true);
      window.setTimeout(() => setBeltFlash(false), 1200);
    };
    show();
    return onPanelSection(show);
  }, [id]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header kind={ref.portal ? 'Portal' : 'System'} onClose={() => select(null)} actions={ref.actions} ctx={{ system: id, ...(project.groupId ? { galaxy: project.groupId } : {}) }} />
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <div className="flex items-center gap-4">
          <ProgressRing value={stats.total ? stats.done / stats.total : 0} size={64} stroke={5} color={colorHex(project.color)} label={`${stats.done} of ${stats.total} tasks done`}>
            <ProjectChip color={project.color} icon={project.icon} size={40} />
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[22px] leading-tight font-semibold tracking-tight">{project.name}</h2>
            <div className="mt-1.5">
              <Chips items={[ref.code, ref.status, ref.virtual ? 'not a record of its own' : undefined]} />
            </div>
          </div>
        </div>
        {ref.note && <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm">{ref.note}</p>}
        {ref.portal && (
          <button
            data-portal-go={id}
            disabled={!portalVerse}
            onClick={() => portalVerse && void showVerse(portalVerse.id, project.groupId ? { galaxy: project.groupId } : undefined)}
            className="flex w-full items-center gap-3 rounded-xl border border-[#b18cff]/60 bg-[#b18cff]/10 px-3 py-2.5 text-left enabled:hover:bg-[#b18cff]/20 disabled:opacity-50"
          >
            <WormholeMark size={20} className="shrink-0 text-[#c9b3ff]" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{ref.portal.label ?? `Go to ${portalVerse?.name ?? ref.portal.verse}`}</span>
              <span className="block text-xs text-muted">{portalVerse ? `${portalVerse.name} · ${portalVerse.plain}, in the same galaxy` : 'That view is not offered now.'}</span>
            </span>
          </button>
        )}
        <KeptBy refOf={ref} />

        {showTasks && <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            ['Open', stats.open],
            ['Done', stats.done],
            ['Overdue', stats.overdue],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-xl bg-surface-2 px-2 py-2.5">
              <dd className={cx('tabular font-display text-lg font-semibold', k === 'Overdue' && Number(v) > 0 && 'text-danger')}>{v}</dd>
              <dt className="text-[11px] text-muted">{k}</dt>
            </div>
          ))}
        </dl>}
        {showTasks && ref.count != null && ref.count > stats.total && !items.length && <p className="-mt-3 text-xs text-muted">Stands for {ref.count} records in {can.name}; {stats.total} are shown here.</p>}
        <Facts facts={ref.facts} />
        <Wormholes also={ref.also} />
        {items.length > 0 && <ItemList items={items} count={itemCount} />}

        {busy && (
          <div className="rounded-xl border border-amber/40 bg-amber-soft p-3 text-sm">
            <p>
              {stats.open} open tasks: too many to draw one by one, so the sky shows them as a ring of dots.
            </p>
            {ref.open && (
              <Button size="sm" variant="secondary" className="mt-2" icon={<ExternalLink size={14} />} onClick={() => openInHost(ref.open)}>
                {can.openLabel}
              </Button>
            )}
          </div>
        )}

        <BeaconList beacons={mine} />
        {collection && (
          <div ref={beltRef} className={cx('-mx-2 rounded-xl px-2 transition-[background] duration-700', beltFlash && 'bg-accent-soft')}>
            <Belt c={collection} />
          </div>
        )}

        {showTasks && <section>
          <SectionTitle
            right={
              stats.done > 0 && (
                <button className="text-xs text-muted hover:text-text" onClick={() => setShowDone((x) => !x)}>
                  {showDone ? 'Hide done' : `Show ${stats.done} done`}
                </button>
              )
            }
          >
            Tasks
          </SectionTitle>
          {canCreate && <NewHostTask systemId={id} />}
          {visible.length === 0 && <p className="py-3 text-center text-sm text-muted">{own.length ? 'All done here.' : 'No tasks.'}</p>}
          <TaskRows tasks={visible.slice(0, LIST_MAX)} today={today} />
          {visible.length > LIST_MAX && <p className="mt-1.5 px-2.5 text-xs text-muted">and {visible.length - LIST_MAX} more; search finds any of them.</p>}
        </section>}
      </div>
    </div>
  );
}

const NO_TASKS: Task[] = [];
const NO_ITEM_LIST: ItemPlanet[] = [];

/** A system's items, listed (scrollable; type to narrow it down). Each opens the item's panel. */
function ItemList({ items, count }: { items: ItemPlanet[]; count: number }) {
  const families = useOrbit((s) => shownExtras(s)?.families ?? NO_FAMILIES);
  const select = useOrbit((s) => s.select);
  const can = useAbilities();
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const shown = needle ? items.filter((i) => `${i.title} ${i.sub ?? ''} ${families[i.family]?.label ?? i.kind}`.toLowerCase().includes(needle)) : items;
  const many = items.length > CLUTTER.tasks;
  return (
    <section>
      <SectionTitle right={<span className="tabular text-xs text-muted">{count}</span>}>Items</SectionTitle>
      {many && <p className="mb-2 text-xs text-muted">Too many to draw one by one: the sky shows them as a ring of dots.</p>}
      {items.length > 8 && (
        <label className="mb-2 flex h-9 items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 focus-within:border-accent">
          <Search size={14} className="text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Find among ${items.length}…`} aria-label="Find an item in this system" className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-faint" />
        </label>
      )}
      <ul className={cx('space-y-0.5', items.length > 12 && 'max-h-[360px] overflow-y-auto pr-1')} data-item-list>
        {shown.map((it) => (
          <li key={it.id}>
            <button onClick={() => select({ type: 'item', id: it.id })} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2">
              <FamilyDot family={it.family} families={families} state={it.ghost ? 'archived' : it.state} />
              <span className="min-w-0 flex-1">
                <span className={cx('block truncate text-sm', it.state === 'gone' && 'text-faint line-through', it.ghost && 'text-muted italic')}>{it.title}</span>
                <span className="block truncate text-xs text-muted">{[families[it.family]?.label ?? it.kind, it.sub, it.ghost ? 'lives elsewhere' : undefined].filter(Boolean).join(' · ')}</span>
              </span>
              {it.state !== 'live' && <span className="rounded bg-surface-3 px-1.5 py-0.5 text-[10px] font-semibold text-muted uppercase">{it.state}</span>}
            </button>
          </li>
        ))}
        {!shown.length && <li className="px-2 py-2 text-sm text-muted">Nothing here matches “{q}”.</li>}
      </ul>
      {count > items.length && <p className="mt-1.5 px-2 text-xs text-muted">{items.length} of {count} are shown here; the rest are in {can.name}.</p>}
    </section>
  );
}

const STATE_WORD: Record<ItemPlanet['state'], string> = { live: 'Current', archived: 'Archived', gone: 'Gone' };

/** A record shown as a planet (an item). Read-only: what the host sent, its moons, its wormholes, and a way to it. */
export function ItemPanel({ id }: { id: string }) {
  const it = useOrbit((s) => findItem(s, id))!;
  const families = useOrbit((s) => shownExtras(s)?.families ?? NO_FAMILIES);
  const system = useOrbit((s) => shownProjects(s).find((p) => p.id === it.system));
  const galaxy = useOrbit((s) => (system?.groupId ? shownGroups(s).find((g) => g.id === system.groupId) : undefined));
  const { select, openInHost, requestFlight } = useOrbit.getActions();
  const can = useAbilities();
  const fam = families[it.family];
  const hex = fam?.color ?? '#9aa3b8';
  const where = (
    <p className="text-sm text-muted">
      In{' '}
      {system ? (
        <button className="text-accent-ink hover:underline" onClick={() => (requestFlight('system', system.id), select({ type: 'project', id: system.id }))}>
          {system.name}
        </button>
      ) : (
        'a system'
      )}
      {galaxy ? ` · ${galaxy.name}` : ''}
    </p>
  );
  if (it.ghost)
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <Header kind="Lives elsewhere" onClose={() => select(null)} />
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <div className="flex items-center gap-3">
            <span className="h-9 w-9 shrink-0 rounded-full border-2 border-dashed" style={{ borderColor: hex }} aria-hidden />
            <div className="min-w-0">
              <h2 className="font-display text-[22px] leading-tight font-semibold tracking-tight text-muted italic">{it.title}</h2>
              {where}
            </div>
          </div>
          <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm">Shown here, but it lives elsewhere. The way home:</p>
          <Wormholes also={it.also} title="Where it lives" />
          {!it.also.length && <p className="text-sm text-muted">{can.name} did not say where it lives.</p>}
        </div>
      </div>
    );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header kind={fam?.label ?? 'Item'} onClose={() => select(null)} />
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <div className="flex items-center gap-4">
          <ProgressRing value={it.ring ?? 0} size={64} stroke={5} color="#eef2ff" label={it.ring != null ? `Ring: ${Math.round(it.ring * 100)}%` : 'No ring'}>
            <span
              className="h-9 w-9 rounded-full"
              style={it.state === 'live' ? { background: `radial-gradient(circle at 38% 34%, #fff 0%, ${hex} 40%, color-mix(in srgb, ${hex} 45%, black) 100%)` } : { boxShadow: `inset 0 0 0 2.5px ${hex}` }}
              aria-hidden
            />
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <h2 className={cx('font-display text-[22px] leading-tight font-semibold tracking-tight break-words', it.state === 'gone' && 'text-muted line-through')}>{it.title}</h2>
            {it.sub && <p className="mt-0.5 text-sm text-muted">{it.sub}</p>}
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-0.5 text-xs">
                <span className="h-2 w-2 rounded-full" style={{ background: hex }} /> {fam?.label ?? it.kind}
              </span>
              <span className={cx('rounded-full px-2.5 py-0.5 text-xs font-semibold', it.state === 'live' ? 'bg-teal/15 text-teal' : 'bg-surface-3 text-muted')} data-item-state={it.state}>
                {STATE_WORD[it.state]}
              </span>
            </div>
          </div>
        </div>
        {where}
        {it.note && <p className="rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm">{it.note}</p>}
        {it.notes && <p className="text-sm whitespace-pre-wrap text-muted">{it.notes}</p>}
        <Facts facts={it.facts} />
        {(it.moons.items.length > 0 || it.moons.more > 0) && (
          <section>
            <SectionTitle right={<span className="tabular text-xs text-muted">{it.moons.items.length + it.moons.more}</span>}>Moons</SectionTitle>
            <ul className="space-y-0.5" data-item-moons>
              {it.moons.items.map((a) => (
                <AttachmentRow key={a.id} a={a} families={families} />
              ))}
            </ul>
            {it.moons.more > 0 && <p className="mt-1.5 px-2 text-xs text-muted">+{it.moons.more} more in {can.name}</p>}
          </section>
        )}
        <Wormholes also={it.also} />
        {it.open && (
          <Button variant="secondary" icon={<ExternalLink size={15} />} onClick={() => openInHost(it.open)} className="w-full">
            {can.openLabel}
          </Button>
        )}
      </div>
    </div>
  );
}


/** A galaxy a host owns. */
export function HostGalaxyPanel({ id }: { id: string }) {
  const galaxy = useOrbit((s) => shownGroups(s).find((g) => g.id === id))!;
  const projects = useOrbit((s) => shownProjects(s));
  const tasks = useOrbit((s) => (s.host?.sky ? NO_TASKS : s.tasks));
  const beacons = useOrbit((s) => shownExtras(s)?.beacons);
  const itemsBySystem = useOrbit((s) => shownExtras(s)?.items);
  const cluster = useOrbit((s) => shownExtras(s)?.clusters.find((c) => c.id === galaxy.host?.cluster));
  const { select, requestFlight } = useOrbit.getActions();
  const today = toDateKey(Date.now());
  const ref = galaxy.host!;
  const members = useMemo(
    () => projects.filter((p) => p.groupId === id).map((p) => ({ p, s: projectStats(p.id, tasks, today), items: itemsBySystem?.[p.id]?.length ? Math.max(p.host?.count ?? 0, itemsBySystem[p.id].length) : 0 })),
    [projects, tasks, id, today, itemsBySystem],
  );
  const items = members.reduce((a, m) => a + m.items, 0);
  const mine = useMemo(() => (beacons ?? []).filter((b) => b.galaxy === id), [beacons, id]);
  const total = members.reduce((a, m) => a + m.s.total, 0);
  const done = members.reduce((a, m) => a + m.s.done, 0);
  const open = members.reduce((a, m) => a + m.s.open, 0);
  const overdue = members.reduce((a, m) => a + m.s.overdue, 0);
  const hex = colorHex(galaxy.color);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header kind="Galaxy" onClose={() => select(null)} actions={ref.actions} ctx={{ galaxy: id }} />
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <div className="flex items-center gap-4">
          <ProgressRing value={total ? done / total : 0} size={64} stroke={5} color={hex} label={`${total ? Math.round((done / total) * 100) : 0}% of tasks done`}>
            <span className="h-6 w-6 rounded-full" style={{ background: `radial-gradient(circle, #fff 0%, ${hex} 45%, transparent 75%)` }} />
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[22px] leading-tight font-semibold tracking-tight">{galaxy.name}</h2>
            <p className="tabular text-sm text-muted">
              {members.length} system{members.length === 1 ? '' : 's'}
              {total > 0 && ` · ${open} open`}
              {items > 0 && ` · ${items} item${items === 1 ? '' : 's'}`}
              {overdue ? <span className="text-danger"> · {overdue} overdue</span> : null}
            </p>
          </div>
        </div>
        <Chips items={[ref.chip ?? ref.status, cluster ? `in ${cluster.name}` : undefined, ref.finished ? 'finished' : undefined]} />
        <KeptBy refOf={ref} />
        <Facts facts={ref.facts} />
        <Wormholes also={ref.also} />
        <BeaconList beacons={mine} />
        <section>
          <SectionTitle>Systems</SectionTitle>
          {members.length === 0 && <p className="py-3 text-center text-sm text-muted">No systems.</p>}
          <ul className="space-y-1">
            {members.map(({ p, s, items: n }) => (
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
                      {[p.host?.code, p.host?.portal ? 'portal' : undefined, s.total || !n ? `${s.open} open` : undefined, n ? `${n} items` : undefined].filter(Boolean).join(' · ')}
                      {s.overdue ? <span className="text-danger"> · {s.overdue} overdue</span> : null}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

/** A date that matters (a beacon). */
export function BeaconPanel({ id }: { id: string }) {
  const b = useOrbit((s) => shownExtras(s)?.beacons.find((x) => x.id === id))!;
  const where = useOrbit((s) => (b.system ? shownProjects(s).find((p) => p.id === b.system) : shownGroups(s).find((g) => g.id === b.galaxy)));
  const { select, openInHost, requestFlight } = useOrbit.getActions();
  const can = useAbilities();
  const today = toDateKey(Date.now());
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header kind="Date" onClose={() => select(null)} />
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
        <div className="flex items-start gap-3">
          <span className="mt-2.5">
            <BeaconDiamond b={b} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-[22px] leading-tight font-semibold tracking-tight">{b.title}</h2>
            <p className={cx('mt-0.5 text-sm', BEACON_TONE[b.state])}>
              {[b.code, b.state, beaconWhen(b, today)].filter((x, i, a) => x && a.indexOf(x) === i).join(' · ')}
            </p>
          </div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {b.due && (
            <>
              <dt className="text-muted">Due</dt>
              <dd>{friendlyDay(b.due, today)}</dd>
            </>
          )}
          {b.serves != null && (
            <>
              <dt className="text-muted">Serves</dt>
              <dd>
                {b.serves} open task{b.serves === 1 ? '' : 's'}
              </dd>
            </>
          )}
          {where && (
            <>
              <dt className="text-muted">{b.system ? 'Beside' : 'On'}</dt>
              <dd>
                <button
                  className="text-accent-ink hover:underline"
                  onClick={() => {
                    requestFlight(b.system ? 'system' : 'galaxy', where.id);
                    select({ type: b.system ? 'project' : 'group', id: where.id });
                  }}
                >
                  {where.name}
                </button>
              </dd>
            </>
          )}
        </dl>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate text-muted">{can.storedLabel}</span>
          {b.open && (
            <Button size="sm" variant="secondary" icon={<ExternalLink size={14} />} onClick={() => openInHost(b.open)}>
              {can.openLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
