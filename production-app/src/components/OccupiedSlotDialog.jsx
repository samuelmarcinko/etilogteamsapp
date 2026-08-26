import * as Dialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import clsx from 'clsx';
import { ArrowLeftRight, Inbox, Layers, Replace, X } from 'lucide-react';

/**
 * Asked when a card is dropped on a slot that already holds production
 * (section 4.3). The planner decides; the app never guesses, and whichever
 * option is chosen the whole move is one server transaction.
 */

const OPTIONS = [
  {
    value: 'swap',
    icon: ArrowLeftRight,
    label: 'Swap productions',
    hint: 'The two cards exchange places'
  },
  {
    value: 'add_below',
    icon: Layers,
    label: 'Add below existing',
    hint: 'Both run in this shift'
  },
  {
    value: 'replace',
    icon: Replace,
    label: 'Replace existing',
    hint: 'The current card is removed',
    destructive: true
  },
  {
    value: 'unschedule_existing',
    icon: Inbox,
    label: 'Move existing to Unscheduled',
    hint: 'It returns to the queue, undated'
  }
];

export default function OccupiedSlotDialog({ open, onOpenChange, moving, occupants, targetLabel, onConfirm }) {
  const [choice, setChoice] = useState('swap');

  const occupantNames = (occupants || [])
    .map((o) => o.fg_number || o.custom_product_name || `#${o.id}`)
    .join(', ');

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-[2px]" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2
                     rounded-lg border border-gray-200 bg-white shadow-lg focus:outline-none"
          onOpenAutoFocus={(e) => {
            // Focus the choices rather than the close button, so Enter confirms.
            e.preventDefault();
            e.currentTarget.querySelector('input[type="radio"]')?.focus();
          }}
        >
          <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-3.5">
            <div className="min-w-0">
              <Dialog.Title className="text-[15px] font-bold text-gray-900">
                {targetLabel} already has production
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[12px] leading-relaxed text-gray-500">
                Moving <span className="font-medium text-gray-700">{moving}</span> onto{' '}
                <span className="font-medium text-gray-700">{occupantNames}</span>. What should happen?
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
              aria-label="Cancel"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <div
            role="radiogroup"
            aria-label="How to resolve the conflict"
            className="flex flex-col gap-1 px-3 py-3"
          >
            {OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = choice === option.value;
              return (
                <label
                  key={option.value}
                  className={clsx(
                    'flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 transition',
                    active
                      ? 'border-etilog bg-etilog-light'
                      : 'border-transparent hover:border-gray-200 hover:bg-gray-50'
                  )}
                >
                  <input
                    type="radio"
                    name="resolution"
                    value={option.value}
                    checked={active}
                    onChange={() => setChoice(option.value)}
                    className="sr-only"
                  />
                  <Icon
                    className={clsx(
                      'h-4 w-4 shrink-0',
                      active ? 'text-etilog' : option.destructive ? 'text-gray-400' : 'text-gray-400'
                    )}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span
                      className={clsx(
                        'block text-[13px] font-medium',
                        active ? 'text-gray-900' : 'text-gray-700'
                      )}
                    >
                      {option.label}
                    </span>
                    <span className="block text-[11px] text-gray-500">{option.hint}</span>
                  </span>
                </label>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 border-t border-gray-200 px-5 py-3">
            <Dialog.Close className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[13px] font-medium text-gray-700 transition hover:bg-gray-50">
              Cancel
            </Dialog.Close>
            <button
              type="button"
              onClick={() => onConfirm(choice)}
              className="rounded-md bg-etilog px-3 py-1.5 text-[13px] font-medium text-white transition hover:bg-etilog-hover"
            >
              Move
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
