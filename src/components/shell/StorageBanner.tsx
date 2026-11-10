import { useState } from 'react';
import { HardDrive, Lock, RefreshCw, X } from 'lucide-react';
import { useOrbit } from '../../store/store';
import { useAbilities } from '../../host/useAbilities';

/** Across the top while the host refuses changes to its records (handshake.locked); its text says why. */
export function LockedBanner() {
  const can = useAbilities();
  const [open, setOpen] = useState(false);
  if (!can.locked) return null;
  const full = `${can.locked}${can.work ? ` Focus, parking and day plans still work; changes to ${can.name}’s records wait until it allows them.` : ''}`;
  return (
    <div role="status" aria-label="Changes paused" className="flex items-start gap-3 border-b border-line bg-surface-2 px-4 py-2.5 text-[13px] text-text md:px-6">
      <Lock size={15} className="mt-0.5 shrink-0 text-amber" />
      {/* two lines at most; the whole text on hover, or by clicking it */}
      <p data-testid="locked-text" title={full} onClick={() => setOpen((o) => !o)} className={`flex-1 cursor-pointer leading-snug ${open ? '' : 'line-clamp-2'}`}>
        <span className="font-semibold">{can.locked}</span>
        {can.work && <span className="text-muted"> Focus, parking and day plans still work; changes to {can.name}’s records wait until it allows them.</span>}
      </p>
    </div>
  );
}

/** Shown only when ORBIT cannot keep data as it normally would: we never pretend data is being kept. */
export function StorageBanner() {
  const kind = useOrbit((s) => s.storageKind);
  const error = useOrbit((s) => s.storageError);
  const hosted = useOrbit((s) => !!s.host);
  const hostError = useOrbit((s) => s.host?.error);
  const refusal = useOrbit((s) => s.hostRefusal);
  const setView = useOrbit((s) => s.setView);
  const refreshHost = useOrbit((s) => s.refreshHost);
  const [hidden, setHidden] = useState(false);
  if (hidden) return null;

  if (hosted) {
    if (!hostError && !error) return null;
    return (
      <div role="alert" className="flex items-start gap-3 border-b border-line bg-amber-soft px-4 py-2.5 text-[13px] text-text md:px-6">
        <HardDrive size={16} className="mt-0.5 shrink-0 text-amber" />
        <p className="flex-1 leading-snug">{hostError ?? error}</p>
        {hostError && (
          <button onClick={() => void refreshHost()} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-semibold text-amber hover:underline">
            <RefreshCw size={13} /> Try again
          </button>
        )}
      </div>
    );
  }

  if (refusal) {
    return (
      <div role="alert" className="flex items-start gap-3 border-b border-line bg-amber-soft px-4 py-2.5 text-[13px] text-text md:px-6">
        <HardDrive size={16} className="mt-0.5 shrink-0 text-amber" />
        <p className="flex-1 leading-snug">
          <strong className="font-semibold">ORBIT is running on its own, not with the application that opened it.</strong> {refusal} Nothing is kept after this tab closes.
        </p>
        <button onClick={() => setHidden(true)} className="rounded-md p-1 text-muted hover:text-text" aria-label="Hide this message">
          <X size={15} />
        </button>
      </div>
    );
  }

  if (kind === 'indexeddb' && !error) return null;
  return (
    <div role="alert" className="flex items-start gap-3 border-b border-line bg-amber-soft px-4 py-2.5 text-[13px] text-text md:px-6">
      <HardDrive size={16} className="mt-0.5 shrink-0 text-amber" />
      <p className="flex-1 leading-snug">
        <strong className="font-semibold">This browser is not letting ORBIT save.</strong> Your work stays only until this tab closes.{' '}
        <button className="font-semibold text-amber underline underline-offset-2" onClick={() => setView('settings')}>
          Copy a backup
        </button>{' '}
        before leaving.{error ? <span className="text-muted"> ({error})</span> : null}
      </p>
      <button onClick={() => setHidden(true)} className="rounded-md p-1 text-muted hover:text-text" aria-label="Hide this message">
        <X size={15} />
      </button>
    </div>
  );
}
