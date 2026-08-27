import { pointerWithin, rectIntersection, useDraggable, useDroppable } from '@dnd-kit/core';
import clsx from 'clsx';

/**
 * Collision detection.
 *
 * closestCenter compares the dragged card's centre against each target's
 * centre, which works for a grid of same-sized cells but fails badly for the
 * Unscheduled drawer: it is tall and narrow, so its centre sits far to the
 * right and a card had to be dragged almost onto it before the drawer won.
 *
 * Whatever is under the pointer is what the user means. Fall back to rectangle
 * overlap only when the pointer is outside every target, so a drag that leaves
 * the window still resolves sensibly.
 *
 * The drawer needs one more rule. It is an overlay: the grid cells it covers
 * are still under the pointer and still collide, and pointerWithin ranks by
 * distance to each rectangle's centre - which a small day cell always wins
 * against a panel the height of the window. So a card dropped onto the open
 * drawer landed in whatever cell happened to be behind it. What is drawn on
 * top is what the user is aiming at.
 */
export function collisionDetection(args) {
  const byPointer = pointerWithin(args);
  if (byPointer.length === 0) return rectIntersection(args);

  const drawer = byPointer.find((collision) => collision.id === UNSCHEDULED_ID);
  return drawer ? [drawer] : byPointer;
}

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
      // Only wear the drag affordances when dragging is actually on. The
      // attributes carry role="button" and aria-disabled, which around a card
      // that is still a perfectly clickable button would announce a nested
      // button that is disabled - and it is neither.
      {...(disabled ? {} : listeners)}
      {...(disabled ? {} : attributes)}
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
export function DroppableSlot({
  id,
  disabled,
  hasCards,
  className,
  as: Element = 'div',
  children,
  ...rest
}) {
  const { setNodeRef, isOver, active } = useDroppable({ id, disabled });
  const dragging = Boolean(active);

  return (
    <Element
      ref={setNodeRef}
      data-over={isOver || undefined}
      className={clsx(
        // No positioning here on purpose: adding `relative` overrode the
        // drawer's `fixed` and dropped it into the middle of the page. Callers
        // that need the insertion indicator position themselves.
        className,
        'transition-colors duration-150',
        // Faint outline on every valid target while a drag is in flight, so it
        // is obvious where a card may go before hovering anything.
        dragging && !disabled && 'ring-1 ring-inset ring-gray-200',
        isOver && !disabled && 'bg-etilog-light ring-2 ring-inset ring-etilog'
      )}
      {...rest}
    >
      {children}

      {isOver && !disabled && hasCards && (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-1 bottom-0.5 h-0.5 rounded-full bg-etilog"
        />
      )}
    </Element>
  );
}
