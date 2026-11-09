import { MOD_KEY } from '../../lib/platform';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, SquareParking } from 'lucide-react';
import { useOrbit } from '../../store/store';
import type { Link } from '../../types';
import { elapsedMs } from '../../lib/timer';
import { fmtClock } from '../../lib/util';
import { Button, Field, Input, Kbd, Modal, Textarea, cx } from '../ui/primitives';
import { LinkList } from '../task/TaskPanel';

/**
 * Park a task (or edit an auto-saved checkpoint). Built for speed: the cursor
 * starts in "Where I stopped", Enter in "Next action" parks, ⌘/Ctrl+Enter parks
 * from anywhere, and "Park now" skips notes entirely.
 */
export function ParkSheet() {
  const req = useOrbit((s) => s.park);
  return req ? <Sheet key={`${req.taskId}-${req.checkpointId ?? 'new'}`} taskId={req.taskId} checkpointId={req.checkpointId} /> : null;
}

function Sheet({ taskId, checkpointId }: { taskId: string; checkpointId?: string }) {
  const task = useOrbit((s) => s.tasks.find((t) => t.id === taskId));
  const existing = useOrbit((s) => (checkpointId ? s.checkpoints.find((c) => c.id === checkpointId) : undefined));
  const focus = useOrbit((s) => s.focus);
  const openPark = useOrbit((s) => s.openPark);
  const parkTask = useOrbit((s) => s.parkTask);
  const updateCheckpoint = useOrbit((s) => s.updateCheckpoint);
  const toast = useOrbit((s) => s.toast);

  const [stoppedAt, setStoppedAt] = useState(existing?.stoppedAt ?? '');
  const [nextAction, setNextAction] = useState(existing?.nextAction ?? '');
  const [doing, setDoing] = useState(existing?.doing ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [links, setLinks] = useState<Link[]>(existing?.links ?? []);
  const [more, setMore] = useState(!!(existing && (existing.doing || existing.notes || existing.links.length)));
  const first = useRef<HTMLTextAreaElement>(null);
  const editing = !!existing;
  const close = () => openPark(null);

  useEffect(() => {
    if (!task) close();
  });
  if (!task) return null;

  const timerHere = focus?.taskId === taskId ? focus : null;
  const submit = (withNotes = true) => {
    const input = withNotes ? { stoppedAt, nextAction, doing, notes, links } : {};
    if (editing && existing) {
      updateCheckpoint(existing.id, { stoppedAt: stoppedAt.trim(), nextAction: nextAction.trim(), doing: doing.trim(), notes: notes.trim(), links });
      openPark(null);
      toast({ text: 'Checkpoint saved.' });
    } else {
      parkTask(taskId, input);
      toast({ text: `Parked “${task.title}”. Resume it from the dock whenever you are ready.` });
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <Modal
      open
      onClose={close}
      title={editing ? 'Edit checkpoint' : `Park “${task.title}”`}
      initialFocus={first}
      footer={
        <>
          <span className="mr-auto hidden items-center gap-1 text-xs text-faint sm:flex">
            <Kbd>{MOD_KEY}</Kbd>
            <Kbd>Enter</Kbd> to {editing ? 'save' : 'park'}
          </span>
          {!editing && (
            <Button variant="ghost" onClick={() => submit(false)}>
              Park without notes
            </Button>
          )}
          <Button variant="primary" icon={!editing ? <SquareParking size={16} /> : undefined} onClick={() => submit()}>
            {editing ? 'Save checkpoint' : 'Park'}
          </Button>
        </>
      }
    >
      <div className="space-y-4" onKeyDown={onKeyDown}>
        {!editing && (
          <p className="text-sm text-muted">
            A few words now saves minutes later.
            {timerHere ? ` The timer will be saved at ${fmtClock(elapsedMs(timerHere, Date.now()))}${timerHere.plannedMs ? ` of ${fmtClock(timerHere.plannedMs)}` : ''}.` : ''}
          </p>
        )}
        <Field label="Where I stopped">
          <Textarea ref={first} value={stoppedAt} onChange={(e) => setStoppedAt(e.target.value)} rows={2} placeholder="e.g. Halfway through section 3.2, figures still to check" />
        </Field>
        <Field label="My next action">
          <Input
            value={nextAction}
            onChange={(e) => setNextAction(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="The very next small step, e.g. “Rewrite the opening sentence”"
          />
        </Field>
        <button type="button" onClick={() => setMore((m) => !m)} aria-expanded={more} className="flex items-center gap-1.5 text-sm font-medium text-muted hover:text-text">
          <ChevronDown size={16} className={cx('transition-transform', more && 'rotate-180')} />
          More detail
          {!more && (doing || notes || links.length > 0) && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
        </button>
        {more && (
          <div className="anim-fade space-y-4">
            <Field label="What I was doing">
              <Input value={doing} onChange={(e) => setDoing(e.target.value)} placeholder="e.g. Drafting the risks paragraph" />
            </Field>
            <Field label="Notes">
              <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Anything else future-you should know" />
            </Field>
            <Field group label="Relevant links">
              <LinkList links={links} onChange={setLinks} />
            </Field>
          </div>
        )}
      </div>
    </Modal>
  );
}
