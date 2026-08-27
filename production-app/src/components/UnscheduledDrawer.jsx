import clsx from 'clsx';
import { useDroppable } from '@dnd-kit/core';
import { format, isBefore, parseISO, startOfDay } from 'date-fns';
import { Inbox, MoveDown, Plus, X } from 'lucide-react';

import ProductionCard from './ProductionCard';
import { DraggableCard, UNSCHEDULED_ID } from './dnd';

/**
 * The Unscheduled queue (section 4.4): work that has to be produced but has no
 * date yet. Drag a card out onto a day, or drop one back in to take it off the
 * plan without losing it.
 *
 * A side panel rather than a modal, because it is dragged out of while the grid
 * stays visible.
 *
 * useDroppable is wired up here rather than through DroppableSlot so the drop
 * state can be drawn as an overlay. A background utility on the panel itself
 * would have to out-rank its own `bg-white`, and which of two equal-specificity
 * classes wins depends on their order in the compiled stylesheet - not
 * something to leave to chance for the main drop affordance.
 */

function DueBadge({ dueDate }) {
  if (!dueDate) return null;
  const due = parseISO(String(dueDate).slice(0, 10));
  const overdue = isBefore(due, startOfDay(new Date()));

  return (
    <span
      className={clsx(
        'shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold',
        overdue ? 'bg-etilog text-white' : 'bg-gray-100 text-gray-600'
      )}
    >
      Due {format(due, 'd MMM')}
    </span>
  );
}

export default function UnscheduledDrawer({ open, onClose, entries, canManage, onOpenEntry, onAdd }) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: UNSCHEDULED_ID,
    disabled: !canManage || !open
  });

  // A card is in flight and this panel can take it.
  const armed = Boolean(active) && canManage && open;

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
        ref={setNodeRef}
        data-over={isOver || undefined}
        aria-label="Unscheduled production"
        aria-hidden={!open}
        className={clsx(
          'no-print fixed right-0 top-0 z-40 flex h-full w-[min(20rem,100vw)] flex-col',
          'bg-white shadow-lg transition-all duration-200 ease-portal',
          open ? 'translate-x-0' : 'translate-x-full',
          // Armed: a dashed red edge says "this will take the card".
          // Over: solid, thicker, and the whole panel tints.
          isOver
            ? 'border-l-4 border-etilog'
            : armed
              ? 'border-l-4 border-dashed border-etilog/50'
              : 'border-l border-gray-200'
        )}
      >
        {/* Tint drawn as an overlay so it never has to out-rank bg-white. */}
        {isOver && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-10 bg-etilog-medium"
          />
        )}

        <header className="relative z-20 flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <Inbox
              className={clsx('h-4 w-4 transition-colors', isOver ? 'text-etilog' : 'text-gray-400')}
              aria-hidden="true"
            />
            <h2
              className={clsx(
                'text-[14px] font-bold uppercase tracking-wide transition-colors',
                isOver ? 'text-etilog' : 'text-gray-900'
              )}
            >
              Unscheduled
            </h2>
            <span
              className={clsx(
                'rounded px-1.5 py-0.5 text-[12px] font-semibold tabular-nums transition-colors',
                isOver ? 'bg-etilog text-white' : 'bg-gray-100 text-gray-600'
              )}
            >
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

        {/* Says plainly what letting go will do. */}
        {armed && (
          <div
            className={clsx(
              'relative z-20 flex items-center justify-center gap-1.5 border-b px-4 py-2 text-[13px] font-semibold transition-colors',
              isOver
                ? 'border-etilog bg-etilog text-white'
                : 'border-dashed border-etilog/40 bg-etilog-light text-etilog'
            )}
          >
            <MoveDown className="h-3.5 w-3.5" aria-hidden="true" />
            {isOver ? 'Release to unschedule' : 'Drop here to unschedule'}
          </div>
        )}

        <div className="relative z-20 flex-1 overflow-y-auto p-3">
          {entries.length === 0 ? (
            <p className="px-1 py-6 text-center text-[13px] leading-relaxed text-gray-400">
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
        </div>

        {canManage && (
          <div className="relative z-20 border-t border-gray-200 bg-white p-3">
            <button
              type="button"
              onClick={onAdd}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-300 py-2 text-[14px] font-medium text-gray-600 transition hover:border-etilog hover:text-etilog"
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
