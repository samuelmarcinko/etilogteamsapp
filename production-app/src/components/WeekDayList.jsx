import clsx from 'clsx';
import ProductionCard from './ProductionCard';
import { shiftAccent } from '../lib/shifts';
import { shiftNoteKey } from '../lib/weeks';

/**
 * The same week as a stacked day list, for phones.
 *
 * A seven-column grid on a 400px screen means scrolling sideways to read two
 * days at a time, which is no use to someone checking the plan on the shop
 * floor. Below the md breakpoint each day becomes its own section instead.
 */

const DAY_FLAG_BADGE = {
  free: 'bg-emerald-100 text-emerald-800',
  important: 'bg-etilog text-white',
  urgent: 'bg-etilog text-white'
};

const DAY_FLAG_LABEL = { free: 'Free', important: 'Important !', urgent: 'Important !' };

export default function WeekDayList({
  week, shifts, entriesByDay, dayFlags, shiftNotes, exceptions, onOpenEntry
}) {
  return (
    <div className="divide-y divide-gray-200">
      {week.days.map((day) => {
        const perShift = entriesByDay[day.iso] || {};
        const flag = dayFlags[day.iso];
        const exception = exceptions[day.iso];
        const total = Object.values(perShift).flat().length;
        const hasNote = shifts.some((shift) => shiftNotes[shiftNoteKey(day.iso, shift.id)]);

        return (
          <section key={day.iso} className={clsx('px-3 py-2.5', day.isToday && 'bg-etilog-light')}>
            <header className="mb-2 flex items-center gap-2">
              <h3
                className={clsx(
                  'text-[13px] font-bold uppercase tracking-wide',
                  day.isToday ? 'text-etilog' : 'text-gray-900'
                )}
              >
                {day.weekday} {day.dayOfMonth}
              </h3>

              {flag && (
                <span
                  className={clsx(
                    'rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide',
                    DAY_FLAG_BADGE[flag.flag]
                  )}
                >
                  {DAY_FLAG_LABEL[flag.flag] || flag.flag}
                </span>
              )}
              {!flag && exception && (
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-600">
                  {exception.note || exception.type.replace(/_/g, ' ')}
                </span>
              )}
            </header>

            {total === 0 && !hasNote ? (
              <p className="text-[12px] text-gray-300">Nothing planned yet</p>
            ) : (
              <div className="flex flex-col gap-2">
                {shifts.map((shift, shiftIndex) => {
                  const cards = perShift[shift.id] || [];
                  const note = shiftNotes[shiftNoteKey(day.iso, shift.id)];
                  const accent = shiftAccent(shiftIndex);
                  const ShiftIcon = accent.icon;
                  // A shift with only a note still earns its heading - "morning
                  // is down for maintenance" is exactly the case with no cards.
                  if (!cards.length && !note) return null;

                  return (
                    <div key={shift.id} className="flex flex-col gap-1">
                      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        <ShiftIcon className={clsx('h-3 w-3', accent.text)} aria-hidden="true" />
                        {shift.name}
                      </span>
                      {cards.map((entry) => (
                        <ProductionCard key={entry.id} entry={entry} onOpen={onOpenEntry} />
                      ))}
                      {note && (
                        <p className="rounded border border-gray-200 bg-gray-25 px-2 py-1.5 text-[11px] leading-snug text-gray-600">
                          {note.note}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
