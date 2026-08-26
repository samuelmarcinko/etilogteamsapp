import clsx from 'clsx';
import { formatQuantity } from '../lib/weeks';

/**
 * One production card (section 4.2).
 *
 * The FG number dominates because that is what people work from; the product
 * name is secondary and the quantity sits underneath. Priority reads as a
 * colour stripe rather than a filled background, so a wall of urgent cards at
 * 8-week density stays legible.
 */

const PRIORITY_STRIPE = {
  urgent: 'bg-priority-urgent',
  high: 'bg-priority-high',
  blocked: 'bg-priority-blocked',
  normal: 'bg-transparent'
};

const PRIORITY_BADGE = {
  urgent: 'bg-etilog text-white',
  high: 'bg-orange-100 text-orange-800',
  blocked: 'bg-amber-100 text-amber-900'
};

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

  return (
    <button
      type="button"
      onClick={() => onOpen?.(entry)}
      aria-label={`${title}${quantity?.main != null ? `, ${quantity.main} pieces` : ''}`}
      className={clsx(
        'group relative flex w-full flex-col gap-0.5 overflow-hidden rounded-md border border-gray-200',
        'bg-white pl-2.5 pr-2 py-1.5 text-left shadow-card',
        'transition duration-150 ease-portal hover:-translate-y-px hover:shadow-cardHover hover:border-gray-300',
        isCancelled && 'opacity-55'
      )}
    >
      {/* priority accent */}
      <span
        aria-hidden="true"
        className={clsx('absolute inset-y-0 left-0 w-1', PRIORITY_STRIPE[priority] || PRIORITY_STRIPE.normal)}
      />

      <div className="flex items-start justify-between gap-1.5">
        <span
          className={clsx(
            'font-semibold leading-tight text-gray-900',
            compact ? 'text-[12px]' : 'text-[13px]',
            isCancelled && 'line-through'
          )}
        >
          {title}
        </span>

        {PRIORITY_BADGE[priority] && (
          <span
            className={clsx(
              'shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide',
              PRIORITY_BADGE[priority]
            )}
          >
            {priority}
          </span>
        )}
      </div>

      {subtitle && !compact && (
        <span className="line-clamp-1 text-[11px] leading-tight text-gray-500">{subtitle}</span>
      )}

      <div className="flex items-baseline gap-1.5">
        {quantity?.main != null && (
          <span className="text-[11px] font-medium tabular-nums text-gray-700">
            {quantity.main} pcs
          </span>
        )}
        {quantity?.breakdown && (
          <span className="text-[10px] tabular-nums text-gray-400">{quantity.breakdown}</span>
        )}
        {STATUS_LABEL[entry.status] && (
          <span className="text-[10px] text-gray-400">· {STATUS_LABEL[entry.status]}</span>
        )}
      </div>
    </button>
  );
}
