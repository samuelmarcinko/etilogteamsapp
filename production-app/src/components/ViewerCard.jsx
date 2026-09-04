import clsx from 'clsx';
import { Check, PencilLine, Sparkles } from 'lucide-react';

import { cardColor } from '../lib/colors';
import { formatQuantity } from '../lib/weeks';

/**
 * A production card as the shop floor reads it.
 *
 * At one week the card is read standing up, often at arm's length from a tablet
 * on a bench, so everything on it is a size or two larger than the planner's and
 * the quantity - the number the shift actually works to - carries the same
 * weight as the FG rather than being tucked underneath it. Asked for four or
 * eight weeks at once the same card has to fit seven columns of them on a
 * screen, so it steps down twice: the description goes first, then the notes,
 * and the badges shrink to their icons.
 *
 * The colour language is deliberately identical to the planner's: same stripe,
 * same tint, same red for urgent, same struck-through green for done. A
 * supervisor uses both screens and should not have to translate between them.
 */

const SIZES = {
  roomy:   { pad: 'pl-3.5 pr-2.5 py-2.5', title: 'text-[17px]', qty: 'text-[16px]', bar: 'w-1.5' },
  normal:  { pad: 'pl-3 pr-2 py-2',       title: 'text-[15px]', qty: 'text-[14px]', bar: 'w-1' },
  compact: { pad: 'pl-2.5 pr-2 py-1.5',   title: 'text-[13px]', qty: 'text-[13px]', bar: 'w-1' }
};

/**
 * A card that is new to the floor and one that was altered are different news,
 * and the badge says which in a word rather than calling both "recently
 * updated" - which made a job nobody had accounted for read exactly like a
 * quantity that moved by five.
 *
 * Both stay in the blue family: green already means done on this card, and a
 * second green would be one meaning too many. They are told apart by the word
 * and the icon, which survive being read sideways from across a room in a way
 * two shades of anything do not.
 */
const CHANGE_BADGE = {
  new: {
    label: 'New',
    icon: Sparkles,
    title: 'Added to the plan in the latest publish',
    className: 'bg-blue-700'
  },
  changed: {
    label: 'Updated',
    icon: PencilLine,
    title: 'Changed in the latest publish - tap the card to see what',
    className: 'bg-blue-500'
  }
};

export default function ViewerCard({ entry, change, onOpen, density = 'roomy' }) {
  const badge = CHANGE_BADGE[change] || null;
  const BadgeIcon = badge?.icon;
  const size = SIZES[density] || SIZES.roomy;
  const showDescription = density === 'roomy' || density === 'normal';
  const showNotes = density === 'roomy';
  const iconOnly = density === 'compact';
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
        `${isDone ? ', done' : ''}` +
        `${change === 'new' ? ', new in the latest publish'
          : change === 'changed' ? ', changed in the latest publish' : ''}`
      }
      className={clsx(
        'relative flex w-full flex-col gap-1 overflow-hidden rounded-lg border-2',
        'text-left shadow-card transition duration-150 ease-portal hover:shadow-cardHover',
        size.pad,
        colour.border,
        colour.bg,
        isDone && 'opacity-70 hover:opacity-100'
      )}
    >
      <span aria-hidden="true" className={clsx('absolute inset-y-0 left-0', size.bar, colour.bar)} />

      <div className="flex items-start justify-between gap-2">
        <span
          className={clsx(
            'min-w-0 truncate font-bold leading-tight',
            size.title,
            isDone ? 'text-gray-500 line-through decoration-gray-400 decoration-1' : 'text-gray-900'
          )}
        >
          {title}
        </span>

        <span className="flex shrink-0 flex-col items-end gap-1">
          {isUrgent && !isDone && (
            <span
              title="Urgent"
              className={clsx(
                'rounded bg-etilog py-0.5 text-[11px] font-bold uppercase tracking-wide text-white',
                iconOnly ? 'px-1' : 'px-1.5'
              )}
            >
              {iconOnly ? '!' : 'Urgent'}
            </span>
          )}
          {isDone && (
            <span
              title="Done"
              className={clsx(
                'flex items-center gap-0.5 rounded-full bg-emerald-500 text-[11px] font-bold uppercase tracking-wide text-white',
                iconOnly ? 'p-0.5' : 'py-0.5 pl-1 pr-2'
              )}
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" strokeWidth={3} />
              {!iconOnly && 'Done'}
            </span>
          )}
          {/* At eight weeks a card is barely two lines tall, so the one thing
              the shift came to find out shrinks to its icon and joins the
              others up here. */}
          {badge && iconOnly && (
            <span
              title={badge.title}
              className={clsx('flex items-center rounded-full p-0.5 text-white', badge.className)}
            >
              <BadgeIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          )}
        </span>
      </div>

      {/* Everywhere else it says so in words, on a line of its own: it is the
          longest label on the card, and the row above is the FG number's. */}
      {badge && !iconOnly && (
        <span
          title={badge.title}
          className={clsx(
            'flex w-fit items-center gap-1 rounded-full py-0.5 pl-1 pr-2',
            'text-[11px] font-bold uppercase tracking-wide text-white',
            badge.className
          )}
        >
          <BadgeIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {badge.label}
        </span>
      )}

      {subtitle && showDescription && (
        <span className="line-clamp-2 text-[14px] leading-snug text-gray-600">{subtitle}</span>
      )}

      {quantity != null && (
        <span className={clsx(
          'font-bold tabular-nums',
          size.qty,
          isDone ? 'text-gray-500' : 'text-gray-900'
        )}>
          {quantity} pcs
        </span>
      )}

      {entry.notes && showNotes && (
        <span className="whitespace-pre-line text-[13px] leading-snug text-gray-600">
          {entry.notes}
        </span>
      )}
    </button>
  );
}
