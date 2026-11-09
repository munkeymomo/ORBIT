import { useOrbit } from '../../store/store';
import { Button, Modal } from '../ui/primitives';

export function ConfirmDialog() {
  const req = useOrbit((s) => s.confirmReq);
  const confirm = useOrbit((s) => s.confirm);
  const close = () => confirm(null);
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
          <Button
            variant={req?.danger ? 'danger' : 'primary'}
            data-autofocus
            onClick={() => {
              req?.onConfirm();
              close();
            }}
          >
            {req?.confirmLabel}
          </Button>
        </>
      }
    >
      {req?.body && <p className="text-sm leading-relaxed text-muted">{req.body}</p>}
    </Modal>
  );
}
