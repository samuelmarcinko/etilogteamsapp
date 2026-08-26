import clsx from 'clsx';
import { format, isBefore, parseISO, startOfDay } from 'date-fns';
import { Inbox, Plus, X } from 'lucide-react';

import ProductionCard from './ProductionCard';
import { DraggableCard, DroppableSlot, UNSCHEDULED_ID } from './dnd';

/**
 * The Unscheduled queue (section 4.4): work that has to be produced but has no
 * date yet. Drag a card out onto a day, or drop one back in to take it off the
 * plan without losing it.
 *
 * A side panel rather than a modal, because it is dragged out of while the grid
 * stays visible.
 */

function DueBadge({ dueDate }) {
  if (!dueDate) return null;
  const due = parseISO(String(dueDate).slice(0, 10));
  const overdue = isBefore(due, startOfDay(new Date()));

  return (
    <span
      className={clsx(
        'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold',
        overdue ? 'bg-etilog text-white' : 'bg-gray-100 text-gray-600'
      )}
    >
      Due {format(due, 'd MMM')}
    </span>
  );
}

export default function UnscheduledDrawer({ open, onClose, entries, canManage, onOpenEntry, onAdd }) {
  return (
    <>
      {/* Dimming only on small screens, where the panel covers the grid. */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-gray-900/20 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Unscheduled production"
        aria-hidden={!open}
        className={clsx(
          'no-print fixed right-0 top-0 z-40 flex h-full w-[min(20rem,100vw)] flex-col',
          'border-l border-gray-200 bg-white shadow-lg transition-transform duration-200 ease-portal',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <header className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-gray-400" aria-hidden="true" />
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-gray-900">Unscheduled</h2>
            <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-gray-600">
              {entries.length}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close unscheduled queue"
            className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <DroppableSlot
          id={UNSCHEDULED_ID}
          disabled={!canManage}
          hasCards={entries.length > 0}
          className="flex-1 overflow-y-auto p-3"
        >
          {entries.length === 0 ? (
            <p className="px-1 py-6 text-center text-[12px] leading-relaxed text-gray-400">
              Nothing waiting.
              <br />
              Drag a card here to take it off the plan without losing it.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {entries.map((entry) => (
                <div key={entry.id} className="flex flex-col gap-1">
                  <DraggableCard entry={entry} disabled={!canManage}>
                    <ProductionCard entry={entry} onOpen={onOpenEntry} />
                  </DraggableCard>
                  {entry.due_date && (
                    <div className="flex justify-end">
                      <DueBadge dueDate={entry.due_date} />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </DroppableSlot>

        {canManage && (
          <div className="border-t border-gray-200 p-3">
            <button
              type="button"
              onClick={onAdd}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-300 py-2 text-[13px] font-medium text-gray-600 transition hover:border-etilog hover:text-etilog"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add to queue
            </button>
          </div>
        )}
      </aside>
    </>
  );
}
