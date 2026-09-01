import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { ArrowLeftRight, CalendarArrowDown, Copy, MoveRight, X } from 'lucide-react';
import { addDays, format, parseISO } from 'date-fns';
import clsx from 'clsx';

/**
 * The bulk operations from section 4.5.
 *
 * One dialog for all of them, because they ask nearly the same question - which
 * day, and what happens to what is already there - and four near-identical
 * dialogs would be four places to keep in step.
 *
 * Every one says in plain words what it is about to do before you confirm it,
 * since these move a lot of cards at once.
 */

export const BULK_KINDS = {
  moveDay: {
    title: 'Move day',
    icon: MoveRight,
    verb: 'Move',
    needsTarget: true,
    needsMode: true
  },
  copyDay: {
    title: 'Copy day',
    icon: Copy,
    verb: 'Copy',
    needsTarget: true,
    needsMode: true
  },
  swapDays: {
    title: 'Swap days',
    icon: ArrowLeftRight,
    verb: 'Swap',
    needsTarget: true,
    needsMode: false
  },
  copyWeek: {
    title: 'Copy week',
    icon: Copy,
    verb: 'Copy',
    needsTarget: true,
    needsMode: true,
    week: true
  },
  shiftRange: {
    title: 'Shift a range',
    icon: CalendarArrowDown,
    verb: 'Shift',
    needsRange: true
  }
};

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

const pretty = (iso) => (iso ? format(parseISO(iso), 'EEE d MMM yyyy') : '—');

export default function BulkDialog({ open, onOpenChange, kind, sourceDate, onSubmit, busy }) {
  const spec = BULK_KINDS[kind] || BULK_KINDS.moveDay;
  const Icon = spec.icon;

  const [target, setTarget] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [days, setDays] = useState(1);
  const [mode, setMode] = useState('merge');

  useEffect(() => {
    if (!open) return;
    setMode('merge');
    setDays(1);
    // A sensible first guess: the same weekday next week for a copy, the next
    // day for a move, and a week-long range for a shift.
    const base = sourceDate ? parseISO(sourceDate) : new Date();
    setTarget(format(addDays(base, spec.week || kind === 'copyDay' ? 7 : 1), 'yyyy-MM-dd'));
    setRangeTo(format(addDays(base, 6), 'yyyy-MM-dd'));
  }, [open, kind, sourceDate, spec.week]);

  const submit = (event) => {
    event.preventDefault();
    onSubmit({ kind, sourceDate, target, rangeTo, days: Number(days), mode });
  };

  /** What this will actually do, spelled out before the button is pressed. */
  const summary = () => {
    if (spec.needsRange) {
      const n = Number(days);
      if (!n) return 'Choose how many days to move by.';
      return `Everything planned from ${pretty(sourceDate)} to ${pretty(rangeTo)} moves ` +
             `${n > 0 ? 'forward' : 'back'} by ${Math.abs(n)} day${Math.abs(n) === 1 ? '' : 's'}. ` +
             'Cards landing on a day that already has production join it underneath.';
    }
    if (kind === 'swapDays') {
      return `${pretty(sourceDate)} and ${pretty(target)} exchange all their production, both shifts included.`;
    }
    const what = spec.week ? 'the whole week starting' : 'everything on';
    const fate = mode === 'replace'
      ? `Anything already there is removed.`
      : `Anything already there stays, and these join underneath.`;
    return `${spec.verb === 'Copy' ? 'Copies' : 'Moves'} ${what} ${pretty(sourceDate)} to ${pretty(target)}. ${fate}`;
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-gray-200 bg-white shadow-lg focus:outline-none">
          <form onSubmit={submit}>
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-3.5">
              <div className="flex items-center gap-2">
                <Icon className="h-4 w-4 text-etilog" aria-hidden="true" />
                <Dialog.Title className="text-[16px] font-bold text-gray-900">{spec.title}</Dialog.Title>
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
              {spec.needsRange ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="From">
                      <input value={sourceDate || ''} disabled className={clsx(inputClass, 'bg-gray-50 text-gray-500')} />
                    </Field>
                    <Field label="To">
                      <input
                        type="date"
                        value={rangeTo}
                        min={sourceDate}
                        onChange={(e) => setRangeTo(e.target.value)}
                        className={inputClass}
                      />
                    </Field>
                  </div>

                  <Field label="Move by (days)">
                    <div className="flex items-center gap-2">
                      {[-7, -1, 1, 7].map((n) => (
                        <button
                          key={n}
                          type="button"
                          onClick={() => setDays(n)}
                          className={clsx(
                            'rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition',
                            Number(days) === n
                              ? 'border-etilog bg-etilog text-white'
                              : 'border-gray-300 text-gray-700 hover:bg-gray-50'
                          )}
                        >
                          {n > 0 ? `+${n}` : n}
                        </button>
                      ))}
                      <input
                        type="number"
                        value={days}
                        onChange={(e) => setDays(e.target.value)}
                        className={clsx(inputClass, 'w-20')}
                        aria-label="Days to move by"
                      />
                    </div>
                  </Field>
                </>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <Field label={kind === 'swapDays' ? 'This day' : 'From'}>
                    <input value={sourceDate || ''} disabled className={clsx(inputClass, 'bg-gray-50 text-gray-500')} />
                  </Field>
                  <Field label={kind === 'swapDays' ? 'Swap with' : 'To'}>
                    <input
                      type="date"
                      value={target}
                      onChange={(e) => setTarget(e.target.value)}
                      className={inputClass}
                      required
                    />
                  </Field>
                </div>
              )}

              {spec.needsMode && (
                <Field label="If the target already has production">
                  <select value={mode} onChange={(e) => setMode(e.target.value)} className={inputClass}>
                    <option value="merge">Keep it, add these underneath</option>
                    <option value="replace">Remove it and replace</option>
                  </select>
                </Field>
              )}

              <p className="rounded-md bg-gray-50 px-3 py-2.5 text-[13px] leading-relaxed text-gray-600">
                {summary()}
              </p>
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
                disabled={busy}
                className="rounded-md bg-etilog px-3 py-1.5 text-[14px] font-medium text-white transition hover:bg-etilog-hover disabled:opacity-60"
              >
                {busy ? 'Working…' : spec.verb}
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
