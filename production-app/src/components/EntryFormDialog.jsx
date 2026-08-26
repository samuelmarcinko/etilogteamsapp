import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Trash2, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';

import FgCombobox from './FgCombobox';

/**
 * Add or edit a card.
 *
 * Quantity is a free text field on purpose: the sheets contain "30", "130+22"
 * and the occasional note a number cannot hold, and the server keeps all three
 * shapes rather than forcing one.
 */

const PRIORITIES = [
  ['normal', 'Normal'],
  ['high', 'High'],
  ['urgent', 'Urgent'],
  ['blocked', 'Blocked']
];

const STATUSES = [
  ['planned', 'Planned'],
  ['in_progress', 'In progress'],
  ['done', 'Done'],
  ['cancelled', 'Cancelled']
];

/**
 * A labelled field.
 *
 * `as="div"` for anything containing its own interactive list: a <label>
 * forwards every click inside it to its first labelable control, so clicking a
 * result in the FG picker was being redirected into the search input instead of
 * selecting the row.
 */
function Field({ label, children, className, as: Element = 'label' }) {
  return (
    <Element className={clsx('flex flex-col gap-1', className)}>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
      {children}
    </Element>
  );
}

const inputClass =
  'rounded-md border border-gray-300 px-2.5 py-1.5 text-[13px] outline-none transition ' +
  'focus:border-etilog focus:ring-1 focus:ring-etilog';

/** The card's stored quantity, as the input should show it. */
function initialQuantity(entry) {
  if (!entry) return '';
  if (entry.raw_quantity) return entry.raw_quantity;
  if (entry.planned_quantity != null) return String(Number(entry.planned_quantity));
  return '';
}

export default function EntryFormDialog({
  open,
  onOpenChange,
  entry,          // editing an existing card, or null when adding
  slot,           // { date, shiftId, shiftName } for a new card; null for the queue
  shifts,
  onSubmit,
  onDelete,
  saving
}) {
  const isEdit = Boolean(entry);

  const [product, setProduct] = useState(null);
  const [quantity, setQuantity] = useState('');
  const [priority, setPriority] = useState('normal');
  const [status, setStatus] = useState('planned');
  const [notes, setNotes] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [error, setError] = useState(null);

  // Reset whenever the dialog opens, so a previous card never bleeds through.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setProduct(
      entry
        ? {
            productId: entry.product_id || null,
            fgNumber: entry.fg_number || null,
            customProductName: entry.custom_product_name || null
          }
        : null
    );
    setQuantity(initialQuantity(entry));
    setPriority(entry?.priority || 'normal');
    setStatus(entry?.status || 'planned');
    setNotes(entry?.notes || '');
    setDueDate(entry?.due_date ? String(entry.due_date).slice(0, 10) : '');
    setShiftId(String(entry?.shift_id || slot?.shiftId || ''));
  }, [open, entry, slot]);

  const submit = (event) => {
    event.preventDefault();
    if (!product || (!product.productId && !product.customProductName)) {
      setError('Choose an FG number or type a product name.');
      return;
    }
    setError(null);

    onSubmit({
      productId: product.productId,
      customProductName: product.customProductName,
      quantity,
      priority,
      status,
      notes,
      dueDate: dueDate || null,
      shiftId: shiftId ? Number(shiftId) : null
    });
  };

  const heading = isEdit
    ? 'Edit production'
    : slot?.date
      ? `Add to ${format(parseISO(slot.date), 'EEE d MMM')}`
      : 'Add to Unscheduled';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-gray-200 bg-white shadow-lg focus:outline-none">
          <form onSubmit={submit}>
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-3.5">
              <div>
                <Dialog.Title className="text-[15px] font-bold text-gray-900">{heading}</Dialog.Title>
                {slot?.shiftName && (
                  <Dialog.Description className="mt-0.5 text-[12px] text-gray-500">
                    {slot.shiftName} shift
                  </Dialog.Description>
                )}
              </div>
              <Dialog.Close
                type="button"
                className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>

            <div className="flex max-h-[70vh] min-h-[26rem] flex-col gap-3.5 overflow-y-auto px-5 py-4">
              <Field label="Product" as="div">
                <FgCombobox value={product} onChange={setProduct} autoFocus={!isEdit} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantity">
                  <input
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                    placeholder="30, or 130+22"
                    inputMode="text"
                    className={inputClass}
                  />
                </Field>

                <Field label="Shift">
                  <select
                    value={shiftId}
                    onChange={(e) => setShiftId(e.target.value)}
                    className={inputClass}
                    disabled={!slot?.date && !entry?.production_date}
                  >
                    <option value="">Unassigned</option>
                    {shifts.map((shift) => (
                      <option key={shift.id} value={shift.id}>{shift.name}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Priority">
                  <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
                    {PRIORITIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>

                <Field label="Status">
                  <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
                    {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </Field>
              </div>

              {/* Only meaningful for queued work, which is judged by when it is due */}
              {(!slot?.date && !entry?.production_date) && (
                <Field label="Due date">
                  <input
                    type="date"
                    value={dueDate}
                    onChange={(e) => setDueDate(e.target.value)}
                    className={inputClass}
                  />
                </Field>
              )}

              <Field label="Notes">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Anything the shift needs to know"
                  className={clsx(inputClass, 'resize-y')}
                />
              </Field>

              {error && (
                <p role="alert" className="text-[12px] font-medium text-etilog">{error}</p>
              )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-5 py-3">
              {isEdit ? (
                <button
                  type="button"
                  onClick={() => onDelete(entry)}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-gray-500 transition hover:bg-red-50 hover:text-etilog"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Delete
                </button>
              ) : <span />}

              <div className="flex gap-2">
                <Dialog.Close
                  type="button"
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Cancel
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-etilog px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-etilog-hover disabled:opacity-60"
                >
                  {saving ? 'Saving…' : isEdit ? 'Save' : 'Add'}
                </button>
              </div>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
