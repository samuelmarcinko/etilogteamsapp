import clsx from 'clsx';
import { Check, Sparkles } from 'lucide-react';

import { cardColor } from '../lib/colors';
import { formatQuantity } from '../lib/weeks';

/**
 * A production card as the shop floor reads it.
 *
 * The planner's card is sized for someone sitting at a desk arranging a
 * quarter's work. This one is read standing up, often at arm's length from a
 * tablet on a bench, so everything on it is a size or two larger and the
 * quantity - the number the shift actually works to - is given the same weight
 * as the FG rather than being tucked underneath it.
 *
 * The colour language is deliberately identical to the planner's: same stripe,
 * same tint, same red for urgent, same struck-through green for done. A
 * supervisor uses both screens and should not have to translate between them.
 */

export default function ViewerCard({ entry, updated, onOpen }) {
  const title = entry.fg_number || entry.custom_product_name || 'Untitled';
  const subtitle = entry.fg_number ? entry.product_description : null;
  const quantity = formatQuantity(entry);
  const isDone = entry.status === 'done';
  const isUrgent = (entry.priority || 'normal') === 'urgent';
  const colour = cardColor(entry);

  return (
    <button
      type="button"
      onClick={() => onOpen?.(entry)}
      aria-label={
        `${title}${quantity != null ? `, ${quantity} pieces` : ''}` +
        `${isDone ? ', done' : ''}${updated ? ', changed recently' : ''}`
      }
      className={clsx(
        'relative flex w-full flex-col gap-1 overflow-hidden rounded-lg border-2 pl-3.5 pr-2.5 py-2.5',
        'text-left shadow-card transition duration-150 ease-portal hover:shadow-cardHover',
        colour.border,
        colour.bg,
        isDone && 'opacity-70 hover:opacity-100'
      )}
    >
      <span aria-hidden="true" className={clsx('absolute inset-y-0 left-0 w-1.5', colour.bar)} />

      <div className="flex items-start justify-between gap-2">
        <span
          className={clsx(
            'text-[17px] font-bold leading-tight',
            isDone ? 'text-gray-500 line-through decoration-gray-400 decoration-1' : 'text-gray-900'
          )}
        >
          {title}
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1">
          {isUrgent && !isDone && (
            <span className="rounded bg-etilog px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
              Urgent
            </span>
          )}
          {isDone && (
            <span
              title="Done"
              className="flex items-center gap-0.5 rounded-full bg-emerald-500 py-0.5 pl-1 pr-2 text-[11px] font-bold uppercase tracking-wide text-white"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={3} />
              Done
            </span>
          )}
          {/* What the shift came here to find out: which cards are not the ones
              they saw yesterday. Worth a badge of its own, next to the others
              rather than instead of them. */}
          {updated && (
            <span
              title="Changed in the last 24 hours - tap the card to see what"
              className="flex items-center gap-0.5 rounded-full bg-blue-600 py-0.5 pl-1 pr-2 text-[11px] font-bold uppercase tracking-wide text-white"
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              Updated
            </span>
          )}
        </span>
      </div>

      {subtitle && (
        <span className="line-clamp-2 text-[14px] leading-snug text-gray-600">{subtitle}</span>
      )}

      {quantity != null && (
        <span className={clsx(
          'text-[16px] font-bold tabular-nums',
          isDone ? 'text-gray-500' : 'text-gray-900'
        )}>
          {quantity} pcs
        </span>
      )}

      {entry.notes && (
        <span className="whitespace-pre-line text-[13px] leading-snug text-gray-600">
          {entry.notes}
        </span>
      )}
    </button>
  );
}
