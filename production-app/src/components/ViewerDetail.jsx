import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { ArrowRight, Check, Sparkles, X } from 'lucide-react';
import { format, formatDistanceToNow, parseISO } from 'date-fns';

import { api } from '../lib/api';
import { CARD_COLORS } from '../lib/colors';
import { formatQuantity } from '../lib/weeks';

/**
 * A card, in full, for someone who cannot change it.
 *
 * The half that earns this screen is the bottom half: what changed. A shift
 * arriving to a plan that moved overnight needs to know which line moved and
 * from what - "Previously 120 pcs, now 150" - without reading an email or
 * comparing against a printout from yesterday.
 */

function asDate(value) {
  if (!value) return null;
  const date = typeof value === 'string' ? parseISO(value) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function Field({ label, children }) {
  if (children == null || children === '') return null;
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</dt>
      <dd className="text-[15px] text-gray-800">{children}</dd>
    </div>
  );
}

const colourLabel = (key) => CARD_COLORS.find((c) => c.key === key)?.label || 'None';

/**
 * The fields of a card, as words rather than column names.
 *
 * Only the ones that actually differ are returned, so a change that moved one
 * card between shifts does not present the reader with eight identical rows to
 * scan past.
 */
function describeChange(log, shifts) {
  const before = log?.before_state;
  const after = log?.after_state;
  if (!before || !after || typeof before !== 'object' || typeof after !== 'object') return [];

  const shiftName = (id) => shifts.find((s) => s.id === id)?.name || (id ? `Shift ${id}` : 'Unassigned');
  const day = (value) => {
    const date = asDate(value);
    return date ? format(date, 'EEE d MMM') : 'Unscheduled';
  };

  const rows = [
    {
      label: 'Product',
      from: log.before_fg_number || before.custom_product_name,
      to: log.after_fg_number || after.custom_product_name
    },
    {
      label: 'Quantity',
      from: before.planned_quantity != null ? `${before.planned_quantity} pcs` : null,
      to: after.planned_quantity != null ? `${after.planned_quantity} pcs` : null
    },
    { label: 'Day', from: day(before.production_date), to: day(after.production_date) },
    { label: 'Shift', from: shiftName(before.shift_id), to: shiftName(after.shift_id) },
    { label: 'Status', from: before.status, to: after.status },
    { label: 'Priority', from: before.priority, to: after.priority },
    { label: 'Colour', from: colourLabel(before.color), to: colourLabel(after.color) },
    { label: 'Notes', from: before.notes || '—', to: after.notes || '—' }
  ];

  return rows.filter((row) => (row.from ?? null) !== (row.to ?? null));
}

function WhatChanged({ locationCode, entry, shifts }) {
  const activity = useQuery({
    queryKey: ['production', 'activity', 'entry', entry.id],
    queryFn: () => api.activity({ location: locationCode, entryId: entry.id, limit: 5 }),
    staleTime: 60 * 1000
  });

  if (activity.isPending) {
    return <p className="text-[13px] text-gray-400">Looking up what changed…</p>;
  }

  const log = (activity.data?.data || []).find(
    (row) => row.before_state && row.after_state && typeof row.before_state === 'object'
  );
  const rows = describeChange(log, shifts);
  const changedAt = asDate(log?.changed_at);

  if (!rows.length) {
    // A card can be flagged as recently touched by a change whose snapshot no
    // longer says anything useful - a bulk operation, or a log line already
    // trimmed by retention. Saying so beats an empty box.
    return (
      <p className="text-[13px] text-gray-500">
        Changed recently{changedAt ? ` (${formatDistanceToNow(changedAt, { addSuffix: true })})` : ''},
        but the detail of that change is no longer on record.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12px] text-gray-500">
        {[
          changedAt ? formatDistanceToNow(changedAt, { addSuffix: true }) : null,
          log.changed_by_name
        ].filter(Boolean).join(' · ')}
      </p>

      <dl className="flex flex-col divide-y divide-blue-100 overflow-hidden rounded-md border border-blue-100 bg-white">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center gap-2 px-2.5 py-1.5">
            <dt className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              {row.label}
            </dt>
            <dd className="flex min-w-0 flex-1 items-center gap-2 text-[14px]">
              <span className="truncate text-gray-500 line-through decoration-gray-300">
                {row.from ?? '—'}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-blue-500" aria-hidden="true" />
              <span className="truncate font-semibold text-gray-900">{row.to ?? '—'}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export default function ViewerDetail({ entry, updated, open, onOpenChange, locationCode, shifts }) {
  if (!entry) return null;

  const quantity = formatQuantity(entry);
  const productionDate = asDate(entry.production_date);
  const updatedAt = asDate(entry.updated_at);
  const isDone = entry.status === 'done';
  const isUrgent = (entry.priority || 'normal') === 'urgent';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2
                     -translate-y-1/2 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg
                     focus:outline-none"
        >
          <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-4">
            <div className="min-w-0">
              <Dialog.Title className="truncate text-[19px] font-bold text-gray-900">
                {entry.fg_number || entry.custom_product_name}
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[14px] text-gray-500">
                {entry.product_description || (entry.fg_number ? 'No description' : 'Custom production')}
              </Dialog.Description>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {isUrgent && (
                <span className="rounded bg-etilog px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
                  Urgent
                </span>
              )}
              <Dialog.Close
                className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-5 py-4">
            <Field label="Date">{productionDate ? format(productionDate, 'EEEE d MMM yyyy') : null}</Field>
            <Field label="Shift">{entry.shift_name}</Field>

            <Field label="Quantity">
              {quantity != null ? <span className="tabular-nums font-semibold">{quantity} pcs</span> : null}
            </Field>

            <Field label="Status">
              {isDone ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 py-0.5 pl-1 pr-2 text-[13px] font-semibold text-emerald-800">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={3} />
                  Done
                </span>
              ) : (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[13px] font-semibold text-gray-700">
                  Planned
                </span>
              )}
            </Field>

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
                  ].filter(Boolean).join(' · ')}
                </Field>
              </div>
            )}
          </dl>

          {updated && (
            <div className="border-t border-blue-100 bg-blue-50 px-5 py-4">
              <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-bold uppercase tracking-wide text-blue-900">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                What changed
              </h3>
              <WhatChanged locationCode={locationCode} entry={entry} shifts={shifts} />
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
