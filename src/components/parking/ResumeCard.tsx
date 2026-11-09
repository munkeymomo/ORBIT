import { ArrowRight, ExternalLink, FolderOpen, Play, RotateCcw } from 'lucide-react';
import { useOrbit } from '../../store/store';
import { fmtClock, relativeTime } from '../../lib/util';
import { Button, Modal } from '../ui/primitives';
import { ProjectChip } from '../ui/visuals';

/** Restores a parked task: shows where you stopped and the next action, then restarts the timer as chosen. */
export function ResumeCard() {
  const taskId = useOrbit((s) => s.resumeFor);
  return taskId ? <Card key={taskId} taskId={taskId} /> : null;
}

function Card({ taskId }: { taskId: string }) {
  const task = useOrbit((s) => s.tasks.find((t) => t.id === taskId));
  const project = useOrbit((s) => s.projects.find((p) => p.id === task?.projectId));
  const cp = useOrbit((s) => s.checkpoints.filter((c) => c.taskId === taskId).sort((a, b) => b.createdAt - a.createdAt)[0]);
  const activeTitle = useOrbit((s) => (s.focus?.taskId && s.focus.taskId !== taskId ? s.tasks.find((t) => t.id === s.focus!.taskId)?.title : null));
  const focusMin = useOrbit((s) => s.prefs.focusMin);
  const openResume = useOrbit((s) => s.openResume);
  const resumeTask = useOrbit((s) => s.resumeTask);
  const select = useOrbit((s) => s.select);
  const setView = useOrbit((s) => s.setView);
  const close = () => openResume(null);
  if (!task) return null;

  const timer = cp?.timer && cp.timer.kind === 'focus' ? cp.timer : null;
  const left = timer && timer.mode === 'countdown' && timer.plannedMs != null ? timer.plannedMs - timer.elapsedMs : null;
  const continueLabel = !timer ? null : timer.mode === 'flow' ? `Continue flow (${fmtClock(timer.elapsedMs)} so far)` : left != null && left > 0 ? `Continue timer · ${fmtClock(left)} left` : 'Continue (time was already up)';

  const go = (mode: 'continue' | 'fresh' | 'none') => {
    resumeTask(taskId, mode);
    if (mode === 'none') select({ type: 'task', id: taskId });
    else setView('focus');
  };

  return (
    <Modal open onClose={close} title="Welcome back" width="max-w-xl">
      <div className="space-y-5">
        <div className="flex items-center gap-3">
          {project && <ProjectChip color={project.color} icon={project.icon} size={40} />}
          <div className="min-w-0">
            <p className="text-xs text-muted">
              {project?.name} · parked {cp ? relativeTime(cp.createdAt, Date.now()) : ''}
            </p>
            <h3 className="font-display text-xl leading-snug font-semibold">{task.title}</h3>
          </div>
        </div>

        {cp?.nextAction ? (
          <div className="rounded-2xl border border-accent/40 bg-accent-soft p-4">
            <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-[0.08em] text-accent-ink uppercase">
              <ArrowRight size={13} /> Your next action
            </p>
            <p className="font-display text-lg leading-snug font-semibold">{cp.nextAction}</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-line bg-surface-2 p-4 text-sm text-muted">No next action was saved. Take a moment to decide the first small step before you start.</div>
        )}

        {cp && (cp.stoppedAt || cp.doing || cp.notes) && (
          <dl className="space-y-3 text-sm">
            {cp.stoppedAt && (
              <div>
                <dt className="text-xs text-muted">Where you stopped</dt>
                <dd className="mt-0.5">{cp.stoppedAt}</dd>
              </div>
            )}
            {cp.doing && (
              <div>
                <dt className="text-xs text-muted">What you were doing</dt>
                <dd className="mt-0.5">{cp.doing}</dd>
              </div>
            )}
            {cp.notes && (
              <div>
                <dt className="text-xs text-muted">Notes</dt>
                <dd className="mt-0.5 whitespace-pre-wrap">{cp.notes}</dd>
              </div>
            )}
          </dl>
        )}

        {cp && cp.links.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {cp.links.map((l) => (
              <a key={l.id} href={l.url} target="_blank" rel="noreferrer noopener" className="inline-flex h-9 max-w-full items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 text-sm hover:border-line-strong">
                <ExternalLink size={14} className="shrink-0 text-faint" />
                <span className="truncate">{l.label || l.url}</span>
              </a>
            ))}
          </div>
        )}

        {activeTitle && <p className="rounded-xl bg-amber-soft px-3 py-2 text-xs text-amber">“{activeTitle}” is in focus now. It will be parked with its timer saved, so you can come straight back.</p>}

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {continueLabel && (
            <Button variant="teal" size="lg" icon={<Play size={16} fill="currentColor" />} onClick={() => go('continue')} data-autofocus>
              {continueLabel}
            </Button>
          )}
          <Button variant={continueLabel ? 'secondary' : 'teal'} size="lg" icon={continueLabel ? <RotateCcw size={16} /> : <Play size={16} fill="currentColor" />} onClick={() => go('fresh')} data-autofocus={!continueLabel || undefined}>
            {continueLabel ? `Start fresh · ${focusMin}m` : `Start focus · ${focusMin}m`}
          </Button>
          <Button variant="ghost" size="lg" icon={<FolderOpen size={16} />} onClick={() => go('none')}>
            Just open it
          </Button>
        </div>
      </div>
    </Modal>
  );
}

