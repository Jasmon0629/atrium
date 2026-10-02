import { AnimatePresence } from 'motion/react';
import { AlertTriangle } from 'lucide-react';
import { useUi } from '../stores/ui';
import { Button, Modal } from './ui';

/** Renders the pending confirm request from the ui store (see useConfirm). */
export function ConfirmDialog() {
  const req = useUi((s) => s.confirm);
  const answer = useUi((s) => s.answer);
  return (
    <AnimatePresence>
      {req && (
        <Modal key="confirm" size="sm" onClose={() => answer(false)} labelledBy="confirm-title">
          <div className="p-6">
            <div className="flex items-start gap-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${
                  req.danger ? 'bg-urgent-soft text-urgent' : 'bg-paper text-ink-700'
                }`}
              >
                <AlertTriangle size={17} />
              </span>
              <div className="min-w-0 pr-16">
                <h2 id="confirm-title" className="text-sm font-semibold">
                  {req.title}
                </h2>
                {req.body && <p className="mt-1 text-sm text-ink-500">{req.body}</p>}
              </div>
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => answer(false)} autoFocus>
                {req.cancelLabel || 'Cancel'}
              </Button>
              <Button variant={req.danger ? 'danger' : 'primary'} onClick={() => answer(true)}>
                {req.confirmLabel || 'Confirm'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </AnimatePresence>
  );
}

/** `const confirm = useConfirm(); if (await confirm({ title: 'Delete?' })) …` */
export function useConfirm() {
  return useUi((s) => s.ask);
}
