import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  AlertTriangle, ArrowLeftRight, CalendarArrowDown, CalendarOff, Check, Copy,
  MoreHorizontal, MoveRight, Plus
} from 'lucide-react';
import clsx from 'clsx';

/**
 * Per-day actions: mark the day important or free, or add production to it.
 *
 * This replaces the coloured Excel cells - same effect, but the meaning ends up
 * in the data rather than in a fill colour nobody can query.
 */

const FLAGS = [
  { value: 'important', label: 'Mark day as IMPORTANT !', icon: AlertTriangle },
  { value: 'free', label: 'Mark day as free', icon: CalendarOff }
];

export default function DayMenu({ day, flag, onSetFlag, onAdd, onBulk }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        {/* A grey glyph fading in over a grey header was hard to find even
            once it was there. It arrives as an actual button instead - a white
            chip with a real edge - and turns ETILOG red under the pointer, the
            same as every other action in the portal. `day-menu-trigger` keeps
            it visible where there is no pointer to hover with; see styles.css. */}
        <button
          type="button"
          aria-label={`Actions for ${day.weekday} ${day.dayOfMonth}`}
          title="Day actions"
          className="day-menu-trigger absolute right-1 top-1 flex h-6 w-6 items-center justify-center
                     rounded-full border border-gray-300 bg-white text-gray-600 opacity-0 shadow-xs
                     transition duration-150 ease-portal
                     hover:border-etilog hover:bg-etilog hover:text-white
                     focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2
                     focus-visible:ring-etilog/40
                     group-hover/day:opacity-100
                     data-[state=open]:border-etilog data-[state=open]:bg-etilog
                     data-[state=open]:text-white data-[state=open]:opacity-100"
        >
          <MoreHorizontal className="h-4 w-4" />
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
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[14px] text-gray-700 outline-none data-[highlighted]:bg-gray-100"
          >
            <Plus className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
            Add production
          </DropdownMenu.Item>

          <DropdownMenu.Separator className="my-1 h-px bg-gray-200" />

          {/* Section 4.5 - rearranging by the day rather than card by card. */}
          {[
            ['moveDay', MoveRight, 'Move day to…'],
            ['copyDay', Copy, 'Copy day to…'],
            ['swapDays', ArrowLeftRight, 'Swap day with…'],
            ['shiftRange', CalendarArrowDown, 'Shift range from here…']
          ].map(([kind, Icon, label]) => (
            <DropdownMenu.Item
              key={kind}
              onSelect={() => onBulk(kind, day)}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[14px] text-gray-700 outline-none data-[highlighted]:bg-gray-100"
            >
              <Icon className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
              {label}
            </DropdownMenu.Item>
          ))}

          <DropdownMenu.Separator className="my-1 h-px bg-gray-200" />

          {FLAGS.map((option) => {
            const Icon = option.icon;
            const active = flag?.flag === option.value;
            return (
              <DropdownMenu.Item
                key={option.value}
                onSelect={() => onSetFlag(day, active ? null : option.value)}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[14px] text-gray-700 outline-none data-[highlighted]:bg-gray-100"
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
