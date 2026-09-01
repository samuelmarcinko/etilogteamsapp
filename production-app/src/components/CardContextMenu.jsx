import * as Menu from '@radix-ui/react-dropdown-menu';
import clsx from 'clsx';
import {
  AlertTriangle, Check, Inbox, Pencil, RotateCcw, Split, Trash2
} from 'lucide-react';

import { CARD_COLORS, DEFAULT_COLOR } from '../lib/colors';
import { formatQuantity } from '../lib/weeks';

/**
 * Right-click a card, act on it.
 *
 * Closing a job, flagging one urgent and colouring a family of related work are
 * the three things a planner does over and over, and each of them used to mean
 * opening a dialog to change one field. Here they are one gesture: the menu
 * fires the change and closes.
 *
 * Built on the dropdown menu rather than a context-menu package: the trigger is
 * a one-pixel element pinned where the pointer was, which the menu then anchors
 * to. That is the whole difference between the two primitives, and it saves a
 * dependency for it.
 *
 * The destructive and dialog-opening entries sit below a rule, away from the
 * one-click marks - a menu that appears under the pointer is a menu you can
 * misclick, and Delete should not be next to the thing you came for.
 */

function Item({ icon: Icon, children, onSelect, danger }) {
  return (
    <Menu.Item
      onSelect={onSelect}
      className={clsx(
        'flex cursor-pointer select-none items-center gap-2 rounded px-2 py-1.5 text-[13px] outline-none',
        danger
          ? 'text-gray-700 data-[highlighted]:bg-red-50 data-[highlighted]:text-etilog'
          : 'text-gray-700 data-[highlighted]:bg-gray-100 data-[highlighted]:text-gray-900'
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {children}
    </Menu.Item>
  );
}

function Separator() {
  return <Menu.Separator className="my-1 h-px bg-gray-200" />;
}

/**
 * One colour, as a menu item so the keyboard still reaches it. The swatch shows
 * both halves of what is being chosen - the stripe and the tint - because that
 * is what the card will look like.
 */
function Swatch({ colour, selected, onSelect }) {
  return (
    <Menu.Item
      onSelect={onSelect}
      title={colour.label}
      aria-label={colour.label}
      className={clsx(
        'flex h-6 w-6 cursor-pointer items-center justify-center rounded border outline-none transition',
        colour.bg,
        selected
          ? 'border-gray-900 ring-1 ring-gray-900'
          : 'border-gray-300 data-[highlighted]:border-gray-600'
      )}
    >
      {selected
        ? <Check className="h-3 w-3 text-gray-900" aria-hidden="true" strokeWidth={3} />
        : <span aria-hidden="true" className={clsx('h-3.5 w-1 rounded-sm', colour.bar)} />}
    </Menu.Item>
  );
}

export default function CardContextMenu({ target, onClose, onMark, onEdit, onSplit, onUnschedule, onDelete }) {
  if (!target) return null;

  const { entry, x, y } = target;
  const isDone = entry.status === 'done';
  const isUrgent = (entry.priority || 'normal') === 'urgent';
  const quantity = formatQuantity(entry);
  const canSplit = entry.planned_quantity != null && Number(entry.planned_quantity) > 1;

  return (
    <Menu.Root open modal={false} onOpenChange={(open) => !open && onClose()}>
      <Menu.Trigger asChild>
        <span
          aria-hidden="true"
          style={{ position: 'fixed', left: x, top: y, width: 1, height: 1 }}
        />
      </Menu.Trigger>

      <Menu.Portal>
        <Menu.Content
          align="start"
          side="bottom"
          sideOffset={2}
          collisionPadding={8}
          className="z-50 min-w-[13rem] rounded-lg border border-gray-200 bg-white p-1 shadow-lg"
        >
          {/* The menu opens away from the card, so it says which card it is for. */}
          <div className="flex items-baseline gap-1.5 px-2 pb-1.5 pt-1">
            <span className="truncate text-[13px] font-bold text-gray-900">
              {entry.fg_number || entry.custom_product_name || 'Untitled'}
            </span>
            {quantity != null && (
              <span className="shrink-0 text-[12px] tabular-nums text-gray-500">{quantity} pcs</span>
            )}
          </div>

          <Separator />

          {isDone ? (
            <Item icon={RotateCcw} onSelect={() => onMark(entry, { status: 'planned' })}>
              Reopen
            </Item>
          ) : (
            <Item icon={Check} onSelect={() => onMark(entry, { status: 'done' })}>
              Mark as Done
            </Item>
          )}

          <Item
            icon={AlertTriangle}
            onSelect={() => onMark(entry, { priority: isUrgent ? 'normal' : 'urgent' })}
          >
            {isUrgent ? 'Clear urgent' : 'Mark urgent'}
          </Item>

          {/* Urgent owns the card's colour, so the palette steps aside rather
              than offering a choice that would not be honoured. */}
          {!isUrgent && (
            <>
              <Separator />
              <div className="px-2 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Colour
              </div>
              <div className="flex flex-wrap gap-1 px-1.5 pb-1.5">
                <Swatch
                  colour={DEFAULT_COLOR}
                  selected={!entry.color}
                  onSelect={() => onMark(entry, { color: null })}
                />
                {CARD_COLORS.map((colour) => (
                  <Swatch
                    key={colour.key}
                    colour={colour}
                    selected={entry.color === colour.key}
                    onSelect={() => onMark(entry, { color: colour.key })}
                  />
                ))}
              </div>
            </>
          )}

          <Separator />

          <Item icon={Pencil} onSelect={() => onEdit(entry)}>Edit…</Item>

          {canSplit && (
            <Item icon={Split} onSelect={() => onSplit(entry)}>Split…</Item>
          )}

          {entry.production_date && (
            <Item icon={Inbox} onSelect={() => onUnschedule(entry)}>Move to Unscheduled</Item>
          )}

          <Separator />

          <Item icon={Trash2} danger onSelect={() => onDelete(entry)}>Delete</Item>
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
