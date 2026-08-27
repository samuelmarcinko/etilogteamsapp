import * as Dialog from '@radix-ui/react-dialog';
import { Pencil, Split, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { formatQuantity } from '../lib/weeks';

/**
 * Card detail (section 4.2): full FG, product name, quantity with its
 * breakdown, shift, notes, priority and who last touched it.
 *
 * Radix handles the focus trap, escape key and ARIA wiring.
 */

const PRIORITY_LABEL = {
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
  blocked: 'Blocked'
};

const PRIORITY_CLASS = {
  normal: 'bg-gray-100 text-gray-700',
  high: 'bg-orange-100 text-orange-800',
  urgent: 'bg-etilog text-white',
  blocked: 'bg-amber-100 text-amber-900'
};

function Field({ label, children }) {
  if (children == null || children === '') return null;
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="text-[14px] text-gray-800">{children}</dd>
    </div>
  );
}

function asDate(value) {
  if (!value) return null;
  const date = typeof value === 'string' ? parseISO(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export default function EntryDetailDialog({ entry, open, onOpenChange, canManage, onEdit, onSplit }) {
  if (!entry) return null;

  const quantity = formatQuantity(entry);
  const productionDate = asDate(entry.production_date);
  const updatedAt = asDate(entry.updated_at);
  const priority = entry.priority || 'normal';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2
                     rounded-lg border border-gray-200 bg-white shadow-lg focus:outline-none"
        >
          <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-3.5">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-[16px] font-bold text-gray-900">
                {entry.fg_number || entry.custom_product_name}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 line-clamp-2 text-[13px] text-gray-500">
                {entry.product_description || (entry.fg_number ? 'No description' : 'Custom production')}
              </Dialog.Description>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide ${PRIORITY_CLASS[priority]}`}
              >
                {PRIORITY_LABEL[priority]}
              </span>
              <Dialog.Close
                className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3.5 px-5 py-4">
            <Field label="Date">
              {productionDate ? format(productionDate, 'EEEE d MMM yyyy') : null}
            </Field>
            <Field label="Shift">{entry.shift_name}</Field>

            <Field label="Quantity">
              {quantity?.main != null ? (
                <span className="tabular-nums">
                  {quantity.main} pcs
                  {quantity.breakdown && (
                    <span className="ml-1.5 text-gray-400">({quantity.breakdown})</span>
                  )}
                </span>
              ) : (
                quantity?.breakdown
              )}
            </Field>
            <Field label="Status">{(entry.status || 'planned').replace(/_/g, ' ')}</Field>

            {entry.notes && (
              <div className="col-span-2">
                <Field label="Notes">
                  <p className="whitespace-pre-line leading-relaxed">{entry.notes}</p>
                </Field>
              </div>
            )}

            {(updatedAt || entry.updated_by_name) && (
              <div className="col-span-2 border-t border-gray-100 pt-3">
                <Field label="Last modified">
                  {[
                    updatedAt ? format(updatedAt, 'd MMM yyyy HH:mm') : null,
                    entry.updated_by_name
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </Field>
              </div>
            )}
          </dl>

          {canManage && (
            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
              {/* Only a card with a plain number can be split in two. */}
              {entry.planned_quantity != null && Number(entry.planned_quantity) > 1 && (
                <button
                  type="button"
                  onClick={() => onSplit(entry)}
                  className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[14px] font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  <Split className="h-3.5 w-3.5" aria-hidden="true" />
                  Split
                </button>
              )}
              <button
                type="button"
                onClick={() => onEdit(entry)}
                className="flex items-center gap-1.5 rounded-md bg-etilog px-3 py-1.5 text-[14px] font-medium text-white transition hover:bg-etilog-hover"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                Edit
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
