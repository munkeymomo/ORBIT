import { useState } from 'react';
import { HardDrive, X } from 'lucide-react';
import { useOrbit } from '../../store/store';

/** Shown only when IndexedDB could not be opened: we never pretend data is being kept. */
export function StorageBanner() {
  const kind = useOrbit((s) => s.storageKind);
  const error = useOrbit((s) => s.storageError);
  const setView = useOrbit((s) => s.setView);
  const [hidden, setHidden] = useState(false);
  if (hidden || (kind === 'indexeddb' && !error)) return null;
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
