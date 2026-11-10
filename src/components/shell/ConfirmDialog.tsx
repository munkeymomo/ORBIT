import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { useOrbit } from '../../store/store';
import { Button, Field, Modal, Textarea } from '../ui/primitives';
import { downloadBackupNow } from '../settings/backupNow';

export function ConfirmDialog() {
  const req = useOrbit((s) => s.confirmReq);
  const confirm = useOrbit((s) => s.confirm);
  const [reason, setReason] = useState('');
  const [blocked, setBlocked] = useState<string | null>(null);
  useEffect(() => {
    setReason('');
    setBlocked(null);
  }, [req]);
  const close = () => confirm(null);
  const missing = !!req?.reason?.required && !reason.trim();
  const ok = () => {
    if (missing) return;
    req?.onConfirm(req.reason ? reason.trim() : undefined);
    close();
  };
  return (
    <Modal
      open={!!req}
      onClose={close}
      title={req?.title ?? ''}
      width="max-w-md"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant={req?.danger ? 'danger' : 'primary'} data-autofocus={req?.reason ? undefined : true} disabled={missing} onClick={ok}>
            {req?.confirmLabel}
          </Button>
        </>
      }
    >
      {req?.body && <p className="text-sm leading-relaxed whitespace-pre-line text-muted">{req.body}</p>}
      {req?.backup && (
        <div className="mt-3">
          <Button size="sm" variant="secondary" icon={<Download size={15} />} onClick={() => setBlocked(downloadBackupNow())}>
            Download a backup first
          </Button>
          {blocked && (
            <Textarea readOnly value={blocked} rows={4} onFocus={(e) => e.currentTarget.select()} className="mt-2 font-mono text-xs" aria-label="Backup JSON (the download was blocked: copy it into a file)" />
          )}
        </div>
      )}
      {req?.reason && (
        <Field label={req.reason.label} className={req.body ? 'mt-4' : undefined}>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), ok())}
            placeholder={req.reason.placeholder}
            rows={2}
            data-autofocus
            aria-required={req.reason.required || undefined}
          />
        </Field>
      )}
    </Modal>
  );
}
