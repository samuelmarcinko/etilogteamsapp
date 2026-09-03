import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle } from 'lucide-react';
import clsx from 'clsx';

/**
 * Ask before something that cannot be taken back.
 *
 * Used sparingly and on purpose. Confirming everything trains people to click
 * through confirmations without reading them, at which point the one that
 * mattered is gone too - so marking a card done, which is one click to undo,
 * asks nothing, while deleting a card, which is not, asks here.
 *
 * The card being deleted is named in the question. "Delete this card?" tells
 * you nothing you did not already believe; "Delete FG100782 — 240 pcs?" is
 * the sentence that catches the wrong card.
 */
export default function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  detail,
  confirmLabel = 'Delete',
  destructive = true,
  busy = false,
  onConfirm
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-gray-900/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-gray-200 bg-white p-5 shadow-lg focus:outline-none">
          <div className="flex gap-3">
            <span
              className={clsx(
                'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                destructive ? 'bg-red-50 text-etilog' : 'bg-gray-100 text-gray-500'
              )}
            >
              <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            </span>

            <div className="min-w-0">
              <Dialog.Title className="text-[15px] font-bold text-gray-900">{title}</Dialog.Title>
              {detail && (
                <p className="mt-1 truncate text-[13px] font-semibold text-gray-700">{detail}</p>
              )}
              <Dialog.Description className="mt-1 text-[13px] leading-snug text-gray-500">
                {body}
              </Dialog.Description>
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2">
            <Dialog.Close
              type="button"
              className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[14px] font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Cancel
            </Dialog.Close>
            <button
              type="button"
              autoFocus
              disabled={busy}
              onClick={onConfirm}
              className={clsx(
                'rounded-md px-3 py-1.5 text-[14px] font-medium text-white transition disabled:opacity-60',
                destructive ? 'bg-etilog hover:bg-etilog-hover' : 'bg-gray-900 hover:bg-gray-700'
              )}
            >
              {busy ? 'Working…' : confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
