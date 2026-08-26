import clsx from 'clsx';
import ProductionCard from './ProductionCard';

/**
 * The same week as a stacked day list, for phones.
 *
 * A seven-column grid on a 400px screen means scrolling sideways to read two
 * days at a time, which is no use to someone checking the plan on the shop
 * floor. Below the md breakpoint each day becomes its own section instead.
 */

const DAY_FLAG_BADGE = {
  free: 'bg-emerald-100 text-emerald-800',
  critical: 'bg-etilog text-white',
  urgent: 'bg-etilog text-white'
};

export default function WeekDayList({ week, shifts, entriesByDay, dayFlags, exceptions, onOpenEntry }) {
  return (
    <div className="divide-y divide-gray-200">
      {week.days.map((day) => {
        const perShift = entriesByDay[day.iso] || {};
        const flag = dayFlags[day.iso];
        const exception = exceptions[day.iso];
        const notes = Object.values(perShift).flat().map((e) => e.notes).filter(Boolean);
        const total = Object.values(perShift).flat().length;

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
                  {flag.flag}
                </span>
              )}
              {!flag && exception && (
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-gray-600">
                  {exception.note || exception.type.replace(/_/g, ' ')}
                </span>
              )}
            </header>

            {total === 0 ? (
              <p className="text-[12px] text-gray-400">Nothing planned</p>
            ) : (
              <div className="flex flex-col gap-2">
                {shifts.map((shift) => {
                  const cards = perShift[shift.id] || [];
                  if (!cards.length) return null;

                  return (
                    <div key={shift.id} className="flex flex-col gap-1">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        {shift.name}
                      </span>
                      {cards.map((entry) => (
                        <ProductionCard key={entry.id} entry={entry} onOpen={onOpenEntry} />
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {notes.length > 0 && (
              <div className="mt-2 rounded border border-gray-200 bg-gray-25 px-2 py-1.5">
                {notes.map((note, i) => (
                  <p key={i} className="whitespace-pre-line text-[11px] leading-snug text-gray-600">
                    {note}
                  </p>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
