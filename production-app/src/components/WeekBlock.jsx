import clsx from 'clsx';
import ProductionCard from './ProductionCard';
import WeekDayList from './WeekDayList';
import useMediaQuery from '../lib/useMediaQuery';

/**
 * One calendar week: a day header row, one row per shift, and a notes row -
 * the Excel layout from section 4.1, as a real grid.
 *
 * Slots are already built to hold several cards, because the historical data
 * does. Nothing here assumes exactly one.
 */

const DAY_FLAG_STYLE = {
  free: 'bg-emerald-50',
  critical: 'bg-etilog-light',
  urgent: 'bg-etilog-light'
};

function DayHeader({ day, flag, exception, compact }) {
  return (
    <div
      className={clsx(
        'week-cell sticky top-0 z-20 px-2 py-1.5 text-center',
        day.isWeekend && 'bg-gray-50',
        flag && DAY_FLAG_STYLE[flag.flag],
        day.isToday && 'shadow-[inset_0_-2px_0_0_#D9000C]'
      )}
    >
      <div className="flex items-baseline justify-center gap-1">
        <span
          className={clsx(
            'text-[10px] font-semibold uppercase tracking-wider',
            day.isToday ? 'text-etilog' : 'text-gray-400'
          )}
        >
          {day.weekday}
        </span>
        <span
          className={clsx(
            'font-semibold tabular-nums',
            compact ? 'text-[12px]' : 'text-[13px]',
            day.isToday ? 'text-etilog' : 'text-gray-800'
          )}
        >
          {day.dayOfMonth}
        </span>
      </div>

      {flag?.flag === 'free' && (
        <div className="text-[9px] font-bold uppercase tracking-wide text-emerald-700">Free</div>
      )}
      {flag && flag.flag !== 'free' && (
        <div className="text-[9px] font-bold uppercase tracking-wide text-etilog">{flag.flag}</div>
      )}
      {!flag && exception && (
        <div className="line-clamp-1 text-[9px] text-gray-500" title={exception.note || exception.type}>
          {exception.note || exception.type.replace(/_/g, ' ')}
        </div>
      )}
    </div>
  );
}

export default function WeekBlock({ week, shifts, entriesByDay, dayFlags, exceptions, onOpenEntry, compact }) {
  const isWide = useMediaQuery('(min-width: 768px)');

  const notesForDay = (iso) => {
    const perShift = entriesByDay[iso] || {};
    return Object.values(perShift)
      .flat()
      .map((e) => e.notes)
      .filter(Boolean);
  };

  return (
    <section className="print-block overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* week header */}
      <header className="flex items-baseline gap-2 border-b border-gray-200 bg-gray-25 px-4 py-2">
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-gray-900">
          CW {week.calendarWeek}
        </h2>
        <span className="text-[12px] text-gray-500">{week.rangeLabel}</span>
      </header>

      {/* phones get the stacked day list instead of a sideways-scrolling grid */}
      {!isWide ? (
        <WeekDayList
          week={week}
          shifts={shifts}
          entriesByDay={entriesByDay}
          dayFlags={dayFlags}
          exceptions={exceptions}
          onOpenEntry={onOpenEntry}
        />
      ) : (
      <div className="overflow-x-auto">
        <div className="week-grid">
          {/* corner + day headers */}
          <div className="row-label sticky top-0 z-30" />
          {week.days.map((day) => (
            <DayHeader
              key={day.iso}
              day={day}
              flag={dayFlags[day.iso]}
              exception={exceptions[day.iso]}
              compact={compact}
            />
          ))}

          {/* one row per shift */}
          {shifts.map((shift) => (
            <Row key={shift.id} label={shift.name}>
              {week.days.map((day) => {
                const cards = entriesByDay[day.iso]?.[shift.id] || [];
                const flag = dayFlags[day.iso];
                const isFree = flag?.flag === 'free';

                return (
                  <div
                    key={day.iso}
                    className={clsx(
                      'week-cell flex flex-col gap-1 p-1',
                      compact ? 'min-h-[42px]' : 'min-h-[56px]',
                      day.isWeekend && !cards.length && 'bg-gray-50/60',
                      isFree && 'bg-emerald-50/50'
                    )}
                  >
                    {cards.map((entry) => (
                      <ProductionCard
                        key={entry.id}
                        entry={entry}
                        onOpen={onOpenEntry}
                        compact={compact}
                      />
                    ))}
                  </div>
                );
              })}
            </Row>
          ))}

          {/* notes row */}
          <Row label="Notes">
            {week.days.map((day) => {
              const notes = notesForDay(day.iso);
              return (
                <div
                  key={day.iso}
                  className={clsx(
                    'week-cell min-h-[30px] bg-gray-25 px-2 py-1',
                    day.isWeekend && 'bg-gray-50'
                  )}
                >
                  {notes.map((note, i) => (
                    <p key={i} className="whitespace-pre-line text-[10px] leading-snug text-gray-600">
                      {note}
                    </p>
                  ))}
                </div>
              );
            })}
          </Row>
        </div>
      </div>
      )}
    </section>
  );
}

function Row({ label, children }) {
  return (
    <>
      <div className="row-label flex items-center">{label}</div>
      {children}
    </>
  );
}
