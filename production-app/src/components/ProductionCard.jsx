import clsx from 'clsx';
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
 */

const STATUS_LABEL = {
  in_progress: 'In progress',
  done: 'Done',
  cancelled: 'Cancelled'
};

export default function ProductionCard({ entry, onOpen, compact = false }) {
  const title = entry.fg_number || entry.custom_product_name || 'Untitled';
  const subtitle = entry.fg_number ? entry.product_description : null;
  const quantity = formatQuantity(entry);
  const priority = entry.priority || 'normal';
  const isCancelled = entry.status === 'cancelled';
  const colour = cardColor(entry);

  return (
    <button
      type="button"
      onClick={() => onOpen?.(entry)}
      aria-label={`${title}${quantity?.main != null ? `, ${quantity.main} pieces` : ''}`}
      className={clsx(
        'group relative flex w-full flex-col gap-0.5 overflow-hidden rounded-md border',
        'pl-2.5 pr-2 py-1.5 text-left shadow-card',
        'transition duration-150 ease-portal hover:-translate-y-px hover:shadow-cardHover',
        colour.border,
        colour.bg,
        isCancelled && 'opacity-55'
      )}
    >
      {/* the colour: a stripe down the edge, over a tint of the same hue */}
      <span aria-hidden="true" className={clsx('absolute inset-y-0 left-0 w-1', colour.bar)} />

      <div className="flex items-start justify-between gap-1.5">
        <span
          className={clsx(
            'font-semibold leading-tight text-gray-900',
            compact ? 'text-[13px]' : 'text-[14px]',
            isCancelled && 'line-through'
          )}
        >
          {title}
        </span>

        {priority === 'urgent' && (
          <span className="shrink-0 rounded bg-etilog px-1 py-px text-[10px] font-bold uppercase tracking-wide text-white">
            Urgent
          </span>
        )}
      </div>

      {subtitle && !compact && (
        <span className="line-clamp-1 text-[12px] leading-tight text-gray-600">{subtitle}</span>
      )}

      <div className="flex items-baseline gap-1.5">
        {quantity?.main != null && (
          <span className="text-[12px] font-semibold tabular-nums text-gray-800">
            {quantity.main} pcs
          </span>
        )}
        {quantity?.breakdown && (
          <span className="text-[11px] tabular-nums text-gray-500">{quantity.breakdown}</span>
        )}
        {STATUS_LABEL[entry.status] && (
          <span className="text-[11px] text-gray-600">· {STATUS_LABEL[entry.status]}</span>
        )}
      </div>
    </button>
  );
}
