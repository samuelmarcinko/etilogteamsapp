import { useDraggable, useDroppable } from '@dnd-kit/core';
import clsx from 'clsx';

/**
 * Drag & drop wiring for the planner.
 *
 * dnd-kit is doing the work here - pointer and keyboard sensors, collision
 * detection, the drag overlay. These wrappers only supply the identity of what
 * is being dragged and what it can be dropped on.
 *
 * A slot id encodes where it is: "slot:2026-08-24:3", or "unscheduled" for the
 * queue. That keeps the drop handler a parse rather than a lookup.
 */

export const UNSCHEDULED_ID = 'unscheduled';

export const slotId = (date, shiftId) => `slot:${date}:${shiftId}`;

export function parseSlotId(id) {
  if (id === UNSCHEDULED_ID) return { productionDate: null, shiftId: null };
  const match = /^slot:(\d{4}-\d{2}-\d{2}):(\d+)$/.exec(String(id));
  if (!match) return null;
  return { productionDate: match[1], shiftId: Number(match[2]) };
}

/**
 * Makes a card draggable. The whole card is the handle - a small grip target
 * would be fiddly at 8-week density and on a touch screen.
 */
export function DraggableCard({ entry, disabled, children }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `entry:${entry.id}`,
    data: { entry },
    disabled
  });

  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      className={clsx(
        'touch-none',
        !disabled && 'cursor-grab active:cursor-grabbing',
        // The original stays in place but recedes, so the row does not reflow
        // while dragging; the DragOverlay is what follows the pointer.
        isDragging && 'opacity-30'
      )}
    >
      {children}
    </div>
  );
}

/**
 * A drop target. `isOver` highlights it, and when it already holds cards an
 * insertion line shows where the dropped card would land.
 */
export function DroppableSlot({ id, disabled, hasCards, className, children }) {
  const { setNodeRef, isOver, active } = useDroppable({ id, disabled });
  const dragging = Boolean(active);

  return (
    <div
      ref={setNodeRef}
      data-over={isOver || undefined}
      className={clsx(
        className,
        'relative transition-colors duration-150',
        // Faint outline on every valid target while a drag is in flight, so it
        // is obvious where a card may go before hovering anything.
        dragging && !disabled && 'ring-1 ring-inset ring-gray-200',
        isOver && !disabled && 'bg-etilog-light ring-2 ring-inset ring-etilog'
      )}
    >
      {children}

      {isOver && !disabled && hasCards && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1 bottom-0.5 h-0.5 rounded-full bg-etilog"
        />
      )}
    </div>
  );
}
