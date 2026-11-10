import { useMemo, useState } from 'react';
import { ExternalLink, X } from 'lucide-react';
import { useOrbit } from '../../store/store';
import type { HostRef, Task } from '../../types';
import type { Attachment, Beacon, Collection, Family } from '../../host/types';
import { useAbilities } from '../../host/useAbilities';
import { CLUTTER } from '../universe/space';
import { colorHex } from '../../lib/colors';
import { projectStats } from '../../store/selectors';
import { daysBetween, friendlyDay, toDateKey } from '../../lib/util';
import { Button, IconButton, SectionTitle, cx } from '../ui/primitives';
import { DueBadge, PriorityBars, ProgressRing, ProjectChip } from '../ui/visuals';

/*
 * Panels for records a host owns. Read-only in this stage: they show what the host sent and offer to open it
 * in the host; nothing here edits a host record.
 */

/** Where a record is kept, and a way there. */
export function KeptBy({ refOf }: { refOf: HostRef }) {
  const can = useAbilities();
  const openInHost = useOrbit((s) => s.openInHost);
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate text-muted">{can.storedLabel}</span>
      {refOf.open && (
        <Button size="sm" variant="secondary" icon={<ExternalLink size={14} />} onClick={() => openInHost(refOf.open)}>
          {can.openLabel}
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

/** One attachment (a moon, or an item in a belt) as a row. */
export function AttachmentRow({ a, families }: { a: Attachment; families: Record<string, Family> }) {
  const openInHost = useOrbit((s) => s.openInHost);
  return (
    <li className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
      <FamilyDot family={a.family} families={families} state={a.state} flag={a.flag} />
      <span className="min-w-0 flex-1">
        <span className={cx('block truncate text-sm', a.state === 'gone' && 'text-faint line-through')}>{a.label}</span>
        <span className="block truncate text-xs text-muted">{[families[a.family]?.label ?? a.kind, a.sub].filter(Boolean).join(' · ')}</span>
      </span>
      <StateBadge a={a} />
      {a.open && (
        <IconButton label={`Open ${a.label}`} size="xs" onClick={() => openInHost(a.open)}>
          <ExternalLink size={13} />
        </IconButton>
      )}
    </li>
  );
}

/** A task's moons, listed (TaskPanel). */
export function LinkedItems({ taskId }: { taskId: string }) {
  const set = useOrbit((s) => s.host?.attachments[taskId]);
  const families = useOrbit((s) => s.host?.families ?? {});
  const can = useAbilities();
  if (!set || (!set.items.length && !set.more)) return null;
  return (
    <section>
      <SectionTitle right={<span className="tabular text-xs text-muted">{set.items.length + set.more}</span>}>Linked items</SectionTitle>
      <ul className="space-y-0.5">
        {set.items.map((a) => (
          <AttachmentRow key={a.id} a={a} families={families} />
        ))}
      </ul>
      {set.more > 0 && <p className="mt-1.5 px-2 text-xs text-muted">+{set.more} more in {can.name}</p>}
    </section>
  );
}

/** What a system holds that no task uses (its belt), listed or counted. */
function Belt({ c }: { c: Collection }) {
  const families = useOrbit((s) => s.host?.families ?? {});
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

const BEACON_TONE: Record<Beacon['state'], string> = {
  planned: 'text-text',
  soon: 'text-amber',
  late: 'text-danger',
  achieved: 'text-teal',
  rescoped: 'text-faint',
};

function beaconWhen(b: Beacon, today: string) {
  if (b.state === 'achieved') return 'achieved';
  if (b.state === 'rescoped') return 'rescoped';
  if (!b.due) return b.state;
  const d = daysBetween(today, b.due);
  return d < 0 ? `${-d} days late` : d === 0 ? 'today' : `in ${d} days`;
}

function BeaconDiamond({ b }: { b: Beacon }) {
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

function Header({ kind, onClose }: { kind: string; onClose: () => void }) {
  return (
    <header className="flex items-center gap-2 border-b border-line px-5 py-3">
      <span className="text-xs font-semibold tracking-[0.08em] text-muted uppercase">{kind}</span>
      <div className="flex-1" />
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

/** A system a host owns. */
export function HostSystemPanel({ id }: { id: string }) {
  const project = useOrbit((s) => s.projects.find((p) => p.id === id))!;
  const tasks = useOrbit((s) => s.tasks);
  const collection = useOrbit((s) => s.host?.collections[id]);
  const beacons = useOrbit((s) => s.host?.beacons);
  const { select, openInHost } = useOrbit.getActions();
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
  const LIST_MAX = 60;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header kind="System" onClose={() => select(null)} />
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
        <KeptBy refOf={ref} />

        <dl className="grid grid-cols-3 gap-2 text-center">
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
        </dl>
        {ref.count != null && ref.count > stats.total && <p className="-mt-3 text-xs text-muted">Stands for {ref.count} records in {can.name}; {stats.total} are shown here.</p>}
        <Facts facts={ref.facts} />

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
        {collection && <Belt c={collection} />}

        <section>
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
          {visible.length === 0 && <p className="py-3 text-center text-sm text-muted">{own.length ? 'All done here.' : 'No tasks.'}</p>}
          <TaskRows tasks={visible.slice(0, LIST_MAX)} today={today} />
          {visible.length > LIST_MAX && <p className="mt-1.5 px-2.5 text-xs text-muted">and {visible.length - LIST_MAX} more; search finds any of them.</p>}
        </section>
      </div>
    </div>
  );
}

/** A galaxy a host owns. */
export function HostGalaxyPanel({ id }: { id: string }) {
  const galaxy = useOrbit((s) => s.groups.find((g) => g.id === id))!;
  const projects = useOrbit((s) => s.projects);
  const tasks = useOrbit((s) => s.tasks);
  const beacons = useOrbit((s) => s.host?.beacons);
  const cluster = useOrbit((s) => s.host?.clusters.find((c) => c.id === galaxy.host?.cluster));
  const { select, requestFlight } = useOrbit.getActions();
  const today = toDateKey(Date.now());
  const ref = galaxy.host!;
  const members = useMemo(() => projects.filter((p) => p.groupId === id).map((p) => ({ p, s: projectStats(p.id, tasks, today) })), [projects, tasks, id, today]);
  const mine = useMemo(() => (beacons ?? []).filter((b) => b.galaxy === id), [beacons, id]);
  const total = members.reduce((a, m) => a + m.s.total, 0);
  const done = members.reduce((a, m) => a + m.s.done, 0);
  const open = members.reduce((a, m) => a + m.s.open, 0);
  const overdue = members.reduce((a, m) => a + m.s.overdue, 0);
  const hex = colorHex(galaxy.color);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Header kind="Galaxy" onClose={() => select(null)} />
      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        <div className="flex items-center gap-4">
          <ProgressRing value={total ? done / total : 0} size={64} stroke={5} color={hex} label={`${total ? Math.round((done / total) * 100) : 0}% of tasks done`}>
            <span className="h-6 w-6 rounded-full" style={{ background: `radial-gradient(circle, #fff 0%, ${hex} 45%, transparent 75%)` }} />
          </ProgressRing>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[22px] leading-tight font-semibold tracking-tight">{galaxy.name}</h2>
            <p className="tabular text-sm text-muted">
              {members.length} system{members.length === 1 ? '' : 's'} · {open} open{overdue ? <span className="text-danger"> · {overdue} overdue</span> : null}
            </p>
          </div>
        </div>
        <Chips items={[ref.chip ?? ref.status, cluster ? `in ${cluster.name}` : undefined, ref.finished ? 'finished' : undefined]} />
        <KeptBy refOf={ref} />
        <Facts facts={ref.facts} />
        <BeaconList beacons={mine} />
        <section>
          <SectionTitle>Systems</SectionTitle>
          {members.length === 0 && <p className="py-3 text-center text-sm text-muted">No systems.</p>}
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
                      {[p.host?.code, `${s.open} open`].filter(Boolean).join(' · ')}
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
  const b = useOrbit((s) => s.host?.beacons.find((x) => x.id === id))!;
  const where = useOrbit((s) => (b.system ? s.projects.find((p) => p.id === b.system) : s.groups.find((g) => g.id === b.galaxy)));
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
