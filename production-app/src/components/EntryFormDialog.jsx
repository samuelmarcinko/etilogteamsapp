import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Check, Trash2, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import clsx from 'clsx';

import FgCombobox from './FgCombobox';
import MaterialPanel from './MaterialPanel';
import { CARD_COLORS, DEFAULT_COLOR } from '../lib/colors';

/**
 * Add or edit a card.
 *
 * Quantity is a plain count of pieces. It used to be free text, because the
 * Excel sheets held cells like "130+22" - two deliveries against one FG,
 * written into the one cell a spreadsheet gave them. Here two deliveries are
 * two cards, so the field is a number and nothing else (migration 029).
 */

// Two, and no more. A planner marking everything "high" tells nobody anything;
// what they actually need is one alarm and a way to group related work, which
// is what the colour below is for.
const PRIORITIES = [
  ['normal', 'Normal'],
  ['urgent', 'Urgent']
];

// Likewise two: still to make, or made.
const STATUSES = [
  ['planned', 'Planned'],
  ['done', 'Done']
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
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
      {children}
    </Element>
  );
}

/** One colour in the palette. Big enough to hit on a tablet. */
function ColourSwatch({ colour, selected, onSelect }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      title={colour.label}
      aria-label={colour.label}
      aria-pressed={selected}
      className={clsx(
        'flex h-7 w-7 items-center justify-center rounded-md border transition',
        colour.bg,
        selected ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-300 hover:border-gray-500'
      )}
    >
      {/* the bar is the colour as it appears on the card, so the swatch shows
          both halves of what is being chosen */}
      <span aria-hidden="true" className={clsx('h-4 w-1.5 rounded-sm', colour.bar)} />
      {selected && <Check className="ml-0.5 h-3 w-3 text-gray-900" aria-hidden="true" />}
    </button>
  );
}

const inputClass =
  'rounded-md border border-gray-300 px-2.5 py-1.5 text-[14px] outline-none transition ' +
  'focus:border-etilog focus:ring-1 focus:ring-etilog';

/** The card's stored quantity, as the input should show it. */
function initialQuantity(entry) {
  if (!entry || entry.planned_quantity == null) return '';
  return String(Number(entry.planned_quantity));
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
  // The FG's description, and what it was when the dialog opened - it belongs
  // to the product rather than this card, so it is only written back when
  // someone actually changed it here.
  const [description, setDescription] = useState('');
  const [descriptionBase, setDescriptionBase] = useState('');
  const [quantity, setQuantity] = useState('');
  const [priority, setPriority] = useState('normal');
  const [color, setColor] = useState(null);
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
            customProductName: entry.custom_product_name || null,
            description: entry.product_description || '',
            // Set when the card was created from a SAP project, so reopening it
            // shows the same material picture rather than an empty panel.
            sapOrderEntry: entry.sap_order_entry || null
          }
        : null
    );
    setDescription(entry?.product_id ? entry.product_description || '' : '');
    setDescriptionBase(entry?.product_id ? entry.product_description || '' : '');
    setQuantity(initialQuantity(entry));
    setPriority(entry?.priority || 'normal');
    setColor(entry?.color || null);
    setStatus(entry?.status || 'planned');
    setNotes(entry?.notes || '');
    setDueDate(entry?.due_date ? String(entry.due_date).slice(0, 10) : '');
    setShiftId(String(entry?.shift_id || slot?.shiftId || ''));
  }, [open, entry, slot]);

  /** Picking a different FG brings that FG's own description with it. */
  const chooseProduct = (next) => {
    setProduct(next);
    const nextDescription = next?.productId ? next.description || '' : '';
    setDescription(nextDescription);
    setDescriptionBase(nextDescription);
  };

  const submit = (event) => {
    event.preventDefault();
    if (!product || (!product.productId && !product.customProductName)) {
      setError('Choose an FG number or type a product name.');
      return;
    }
    if (quantity !== '' && !/^\d+$/.test(quantity.trim())) {
      setError('Quantity is a whole number of pieces.');
      return;
    }
    setError(null);

    const descriptionChanged =
      Boolean(product.productId) && description.trim() !== descriptionBase.trim();

    onSubmit({
      productId: product.productId,
      customProductName: product.customProductName,
      // undefined rather than null when untouched, so nothing is written to the
      // product master on an ordinary card edit.
      productDescription: descriptionChanged ? description.trim() : undefined,
      quantity,
      priority,
      color: priority === 'urgent' ? null : color,
      status,
      notes,
      dueDate: dueDate || null,
      shiftId: shiftId ? Number(shiftId) : null,
      // Which SAP order this card is a slice of. Null for work planned outside
      // SAP, which has to keep working exactly as it does today.
      sapOrderEntry: product.sapOrderEntry || null
    });
  };

  // The material check appears once the card is tied to a SAP order, and only
  // then. It never gates anything: Save behaves identically whether the panel
  // is green, red or absent.
  const showPanel = Boolean(product?.sapOrderEntry);

  const heading = isEdit
    ? 'Edit production'
    : slot?.date
      ? `Add to ${format(parseISO(slot.date), 'EEE d MMM')}`
      : 'Add to Unscheduled';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-[2px]" />
        {/* The dialog only grows once there is something to show on the right,
            so planning that has nothing to do with SAP keeps the compact form
            it has today rather than a wide box with an empty half. */}
        <Dialog.Content
          className={clsx(
            'fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-gray-200 bg-white shadow-lg transition-[width] focus:outline-none',
            showPanel
              ? 'w-[min(56rem,calc(100vw-2rem))]'
              : 'w-[min(30rem,calc(100vw-2rem))]'
          )}
        >
          <form onSubmit={submit}>
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-3.5">
              <div>
                <Dialog.Title className="text-[16px] font-bold text-gray-900">{heading}</Dialog.Title>
                {slot?.shiftName && (
                  <Dialog.Description className="mt-0.5 text-[13px] text-gray-500">
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

            {/* Stacks on a phone or a tablet held upright, where the panel goes
                below the form instead of beside it. */}
            <div className="flex max-h-[70vh] min-h-[26rem] flex-col lg:flex-row">
            <div className={clsx(
              'flex flex-col gap-3.5 overflow-y-auto px-5 py-4',
              showPanel ? 'lg:w-[30rem] lg:shrink-0' : 'flex-1'
            )}>
              <Field label="Product" as="div">
                <FgCombobox value={product} onChange={chooseProduct} autoFocus={!isEdit} />
              </Field>

              {/* The FG master list arrived from Excel, where a missing or wrong
                  description stayed that way. A custom product has no master
                  row - its name is already the description. */}
              {product?.productId && (
                <Field label="Product description">
                  <input
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="e.g. GLT 70A541155 Sicherheitsg. VO EBSS ESD"
                    maxLength={200}
                    className={inputClass}
                  />
                  <span className="text-[12px] text-gray-500">
                    Belongs to {product.fgNumber} — every card with this FG shows it.
                  </span>
                </Field>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Field label="Quantity">
                  {/* Deliberately not type="number": there, a browser reports
                      anything it considers invalid as an empty value, so typing
                      the old "130+22" would leave the field showing "130+" while
                      the form held nothing. Filtering the text keeps what is on
                      screen and what will be saved the same thing. */}
                  <input
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value.replace(/\D/g, ''))}
                    placeholder="pieces, e.g. 240"
                    inputMode="numeric"
                    autoComplete="off"
                    className={clsx(inputClass, 'tabular-nums')}
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

              {/* Urgent owns the card's colour, so the palette steps aside for
                  it rather than offering a choice that would not be honoured. */}
              {priority !== 'urgent' && (
                <Field label="Colour" as="div">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ColourSwatch
                      colour={DEFAULT_COLOR}
                      selected={!color}
                      onSelect={() => setColor(null)}
                    />
                    {CARD_COLORS.map((option) => (
                      <ColourSwatch
                        key={option.key}
                        colour={option}
                        selected={color === option.key}
                        onSelect={() => setColor(option.key)}
                      />
                    ))}
                  </div>
                  <p className="mt-1 text-[12px] text-gray-500">
                    Give related work the same colour and it reads as one group across the week.
                  </p>
                </Field>
              )}

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
                <p role="alert" className="text-[13px] font-medium text-etilog">{error}</p>
              )}
            </div>

            {showPanel && (
              <div className="min-h-0 flex-1 overflow-y-auto border-t border-gray-200 bg-gray-50/60 lg:border-l lg:border-t-0">
                <MaterialPanel
                  sapOrderEntry={product.sapOrderEntry}
                  quantity={quantity}
                  projectType={product.projectType}
                />
              </div>
            )}
            </div>

            <div className="flex items-center justify-between gap-2 border-t border-gray-200 px-5 py-3">
              {isEdit ? (
                <button
                  type="button"
                  onClick={() => onDelete(entry)}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[14px] font-medium text-gray-500 transition hover:bg-red-50 hover:text-etilog"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  Delete
                </button>
              ) : <span />}

              <div className="flex gap-2">
                <Dialog.Close
                  type="button"
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[14px] font-medium text-gray-700 transition hover:bg-gray-50"
                >
                  Cancel
                </Dialog.Close>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-md bg-etilog px-3 py-1.5 text-[14px] font-medium text-white transition hover:bg-etilog-hover disabled:opacity-60"
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
