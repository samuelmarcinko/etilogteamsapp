import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { AlertTriangle, CalendarOff, Check, MoreHorizontal, Plus } from 'lucide-react';
import clsx from 'clsx';

/**
 * Per-day actions: mark the day critical or free, or add production to it.
 *
 * This replaces the coloured Excel cells - same effect, but the meaning ends up
 * in the data rather than in a fill colour nobody can query.
 */

const FLAGS = [
  { value: 'critical', label: 'Mark day as critical', icon: AlertTriangle },
  { value: 'free', label: 'Mark day as free', icon: CalendarOff }
];

export default function DayMenu({ day, flag, onSetFlag, onAdd }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={`Actions for ${day.weekday} ${day.dayOfMonth}`}
          className="absolute right-0.5 top-0.5 rounded p-0.5 text-gray-300 opacity-0 transition
                     hover:bg-gray-100 hover:text-gray-600 focus-visible:opacity-100
                     group-hover/day:opacity-100 data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={4}
          className="z-50 min-w-[13rem] rounded-md border border-gray-200 bg-white p-1 shadow-md"
        >
          <DropdownMenu.Item
            onSelect={() => onAdd(day)}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] text-gray-700 outline-none data-[highlighted]:bg-gray-100"
          >
            <Plus className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
            Add production
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-gray-200" />

          {FLAGS.map((option) => {
            const Icon = option.icon;
            const active = flag?.flag === option.value;
            return (
              <DropdownMenu.Item
                key={option.value}
                onSelect={() => onSetFlag(day, active ? null : option.value)}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[13px] text-gray-700 outline-none data-[highlighted]:bg-gray-100"
              >
                <Icon
                  className={clsx('h-3.5 w-3.5', active ? 'text-etilog' : 'text-gray-400')}
                  aria-hidden="true"
                />
                <span className="flex-1">{option.label}</span>
                {active && <Check className="h-3.5 w-3.5 text-etilog" aria-hidden="true" />}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
