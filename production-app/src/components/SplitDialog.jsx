import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Split, X } from 'lucide-react';
import { addDays, format, parseISO } from 'date-fns';
import clsx from 'clsx';

/**
 * Split a card's quantity across two slots (section 4.5).
 *
 * "FG100735 200 pcs -> 120 Monday + 80 Tuesday". You choose how much stays; the
 * remainder is worked out and shown, so there is no arithmetic to get wrong and
 * no way to enter two numbers that do not add up.
 */

const inputClass =
  'rounded-md border border-gray-300 px-2.5 py-1.5 text-[14px] outline-none transition ' +
  'focus:border-etilog focus:ring-1 focus:ring-etilog';

function Field({ label, children }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
      {children}
    </label>
  );
}

export default function SplitDialog({ open, onOpenChange, entry, shifts, onSubmit, busy }) {
  const total = Number(entry?.planned_quantity || 0);

  const [keep, setKeep] = useState(0);
  const [date, setDate] = useState('');
  const [shiftId, setShiftId] = useState('');

  useEffect(() => {
    if (!open || !entry) return;
    setKeep(Math.max(1, Math.floor(total / 2)));
    const base = entry.production_date ? parseISO(String(entry.production_date).slice(0, 10)) : new Date();
    setDate(format(addDays(base, 1), 'yyyy-MM-dd'));
    setShiftId(String(entry.shift_id || shifts[0]?.id || ''));
  }, [open, entry, total, shifts]);

  if (!entry) return null;

  const keptNumber = Number(keep);
  const remainder = total - keptNumber;
  const valid = Number.isFinite(keptNumber) && keptNumber > 0 && keptNumber < total;

  const label = entry.fg_number || entry.custom_product_name;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(26rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-gray-200 bg-white shadow-lg focus:outline-none">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!valid) return;
              onSubmit({ keepQuantity: keptNumber, productionDate: date, shiftId: Number(shiftId) || null });
            }}
          >
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Split className="h-4 w-4 text-etilog" aria-hidden="true" />
                <div>
                  <Dialog.Title className="text-[16px] font-bold text-gray-900">Split production</Dialog.Title>
                  <Dialog.Description className="text-[13px] text-gray-500">
                    {label} · {total} pcs
                  </Dialog.Description>
                </div>
              </div>
              <Dialog.Close
                type="button"
                className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>

            <div className="flex flex-col gap-3.5 px-5 py-4">
              <Field label="Stays where it is">
                <input
                  type="number"
                  min={1}
                  max={total - 1}
                  value={keep}
                  onChange={(e) => setKeep(e.target.value)}
                  className={inputClass}
                  autoFocus
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Rest moves to">
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className={inputClass}
                    required
                  />
                </Field>
                <Field label="Shift">
                  <select value={shiftId} onChange={(e) => setShiftId(e.target.value)} className={inputClass}>
                    {shifts.map((shift) => (
                      <option key={shift.id} value={shift.id}>{shift.name}</option>
                    ))}
                  </select>
                </Field>
              </div>

              <div
                className={clsx(
                  'rounded-md px-3 py-2.5 text-[14px]',
                  valid ? 'bg-gray-50 text-gray-700' : 'bg-red-50 text-etilog'
                )}
              >
                {valid ? (
                  <>
                    <span className="font-semibold tabular-nums">{keptNumber} pcs</span> stay put,{' '}
                    <span className="font-semibold tabular-nums">{remainder} pcs</span> move to{' '}
                    {date ? format(parseISO(date), 'EEE d MMM') : '—'}.
                  </>
                ) : (
                  `Enter an amount between 1 and ${total - 1}.`
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <Dialog.Close
                type="button"
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[14px] font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Cancel
              </Dialog.Close>
              <button
                type="submit"
                disabled={!valid || busy}
                className="rounded-md bg-etilog px-3 py-1.5 text-[14px] font-medium text-white transition hover:bg-etilog-hover disabled:opacity-60"
              >
                {busy ? 'Splitting…' : 'Split'}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
