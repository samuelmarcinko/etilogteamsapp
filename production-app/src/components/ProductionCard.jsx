import clsx from 'clsx';
import { Check } from 'lucide-react';
import { formatQuantity } from '../lib/weeks';
import { cardColor } from '../lib/colors';

/**
 * One production card (section 4.2).
 *
 * The FG number dominates because that is what people work from; the product
 * name is secondary and the quantity sits underneath.
 *
 * The card's colour carries two different things. Urgent is fixed and red -
 * that signal cannot be up to anyone. Everything else takes the colour the
 * planner picked, so a family of related work reads as a group across the
 * week. The colour paints the stripe and tints the card; the tint is what makes
 * the group visible from a distance, where a 4px stripe is not.
 *
 * A finished card stays where it is - the week is a record as much as a plan -
 * but says so in three quiet ways at once: a green check, a light strike
 * through the FG number, and less contrast than the work still to come. Any one
 * of them alone is missable across a printed eight-week spread; together they
 * read at a glance without shouting over the colour that groups the work.
 */

export default function ProductionCard({ entry, onOpen, compact = false }) {
  const title = entry.fg_number || entry.custom_product_name || 'Untitled';
  const subtitle = entry.fg_number ? entry.product_description : null;
  const quantity = formatQuantity(entry);
  const priority = entry.priority || 'normal';
  const isDone = entry.status === 'done';
  const colour = cardColor(entry);

  return (
    <button
      type="button"
      onClick={() => onOpen?.(entry)}
      aria-label={`${title}${quantity != null ? `, ${quantity} pieces` : ''}${isDone ? ', done' : ''}`}
      className={clsx(
        'group relative flex w-full flex-col gap-0.5 overflow-hidden rounded-md border',
        'pl-2.5 pr-2 py-1.5 text-left shadow-card',
        'transition duration-150 ease-portal hover:-translate-y-px hover:shadow-cardHover',
        colour.border,
        colour.bg,
        // Finished work steps back so the week still reads as what is left to
        // do, without the card disappearing from the record.
        isDone && 'opacity-70 hover:opacity-100'
      )}
    >
      {/* the colour: a stripe down the edge, over a tint of the same hue */}
      <span aria-hidden="true" className={clsx('absolute inset-y-0 left-0 w-1', colour.bar)} />

      <div className="flex items-start justify-between gap-1.5">
        <span
          className={clsx(
            'font-semibold leading-tight',
            compact ? 'text-[13px]' : 'text-[14px]',
            isDone
              ? 'text-gray-500 line-through decoration-gray-400 decoration-1'
              : 'text-gray-900'
          )}
        >
          {title}
        </span>

        <span className="flex shrink-0 items-center gap-1">
          {priority === 'urgent' && !isDone && (
            <span className="rounded bg-etilog px-1 py-px text-[10px] font-bold uppercase tracking-wide text-white">
              Urgent
            </span>
          )}

          {/* At 8-week density the pill is wider than the card can spare, so it
              shrinks to the check alone - which is the part that carries. */}
          {isDone && (
            <span
              title="Done"
              className={clsx(
                'flex items-center rounded-full bg-emerald-500 font-bold uppercase tracking-wide text-white',
                compact ? 'p-0.5' : 'gap-0.5 py-px pl-0.5 pr-1.5 text-[10px]'
              )}
            >
              <Check className="h-3 w-3" aria-hidden="true" strokeWidth={3} />
              {!compact && 'Done'}
            </span>
          )}
        </span>
      </div>

      {subtitle && !compact && (
        <span className="line-clamp-1 text-[12px] leading-tight text-gray-600">{subtitle}</span>
      )}

      {quantity != null && (
        <span className={clsx(
          'text-[12px] font-semibold tabular-nums',
          isDone ? 'text-gray-500' : 'text-gray-800'
        )}>
          {quantity} pcs
        </span>
      )}

      {/* The card's own note, on the card. It used to be collected into a Notes
          row under the whole shift, where it needed its FG number in front of it
          to say which card it belonged to; here that is obvious. Hidden at
          8-week density, where a card is barely two lines tall. */}
      {entry.notes && !compact && (
        <span className="line-clamp-2 whitespace-pre-line text-[11px] leading-snug text-gray-500">
          {entry.notes}
        </span>
      )}
    </button>
  );
}
