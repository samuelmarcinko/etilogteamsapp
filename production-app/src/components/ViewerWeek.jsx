import clsx from 'clsx';
import { AlertTriangle, Leaf } from 'lucide-react';

import ViewerCard from './ViewerCard';
import useMediaQuery from '../lib/useMediaQuery';
import { shiftAccent } from '../lib/shifts';
import { freeDaySet, shiftNoteKey } from '../lib/weeks';

/**
 * One week, to be read and not touched.
 *
 * Same shape as the planner's grid on purpose - days across, shifts down - but
 * with no drop targets, no add affordances and no day menu. At one week
 * everything in it is set large, for a screen someone is standing in front of;
 * at four or eight it falls back to the planner's own density, because seven
 * columns of large cards eight times over is not a thing anyone can read either.
 * On a phone the seven columns become seven sections, since scrolling sideways
 * to compare Tuesday with Thursday is not reading.
 */

const DENSITY = {
  roomy:   { grid: 'viewer-grid', spread: 'viewer-spread', cell: 'min-h-[110px] gap-2 p-2',
             weekday: 'text-[13px]', dayNumber: 'text-[20px]', label: 'text-[14px]' },
  normal:  { grid: 'week-grid',   spread: '',               cell: 'min-h-[64px] gap-1.5 p-1.5',
             weekday: 'text-[11px]', dayNumber: 'text-[16px]', label: 'text-[13px]' },
  compact: { grid: 'week-grid',   spread: '',               cell: 'min-h-[46px] gap-1 p-1',
             weekday: 'text-[10px]', dayNumber: 'text-[14px]', label: 'text-[12px]' }
};

function DayHeader({ day, flag, isFree, size }) {
  return (
    <div
      className={clsx(
        'week-cell day-sticky px-2 py-2 text-center',
        // Exactly one background, chosen here: two bg-* utilities on one element
        // are settled by the compiled stylesheet's order, not the source's.
        // Today is filled, not tinted. A pale wash reads as "slightly
        // different" from three metres away; a solid block reads as "here".
        // The column edges below continue it down the whole day so the eye can
        // follow it without counting across.
        day.isToday
          ? 'bg-etilog text-white shadow-[inset_2px_0_0_0_#A00009,inset_-2px_0_0_0_#A00009]'
          : isFree
            ? 'bg-emerald-50'
            : flag
              ? 'bg-etilog-light'
              : 'bg-gray-50',
        day.isPast && !day.isToday && 'opacity-55'
      )}
    >
      <div className={clsx(
        'font-bold uppercase tracking-wider',
        size.weekday,
        day.isToday ? 'text-white/85' : 'text-gray-500'
      )}>
        {day.weekday}
      </div>
      <div className={clsx(
        'font-extrabold leading-tight',
        size.dayNumber,
        day.isToday ? 'text-white' : 'text-gray-900'
      )}>
        {day.dayOfMonth}
      </div>

      {/* Said in words as well as in colour: colour alone is not a label, and
          on a shop floor screen somebody is always looking at it sideways. */}
      {day.isToday && (
        <div className="mt-0.5 text-[10px] font-bold uppercase tracking-[0.14em] text-white/90">
          Today
        </div>
      )}

      {flag && (
        <span className="mt-1 inline-flex items-center gap-1 rounded bg-etilog px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          Important !
        </span>
      )}

      {/* A free day is a property of the day, so it is said once here rather
          than repeated in every shift cell underneath. */}
      {isFree && (
        <span className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700">
          <Leaf className="h-3.5 w-3.5" aria-hidden="true" />
          Free day
        </span>
      )}
    </div>
  );
}

function ShiftNoteBox({ note, compact }) {
  if (!note) return null;
  return (
    <p className={clsx(
      'mt-auto rounded border border-dashed border-gray-300 bg-gray-50 px-2 py-1 leading-snug text-gray-700',
      compact ? 'line-clamp-2 text-[11px]' : 'text-[13px] py-1.5'
    )}>
      {note.note}
    </p>
  );
}

export default function ViewerWeek({
  week, shifts, entriesByDay, dayFlags, shiftNotes, exceptions,
  changeKind, onOpenEntry, density = 'roomy'
}) {
  const isWide = useMediaQuery('(min-width: 768px)');
  const size = DENSITY[density] || DENSITY.roomy;

  // Weekends and flagged days, minus anything with work on it - the same rule
  // the planner's grid runs, from the same function, so the two screens can
  // never show different working weeks.
  const freeDays = freeDaySet(
    week.days, dayFlags,
    (iso) => Object.values(entriesByDay[iso] || {}).flat().length > 0
  );

  const flagFor = (iso) => {
    const flag = dayFlags[iso];
    return flag && flag.flag !== 'free' ? flag : null;
  };

  if (!isWide) {
    return (
      <div className="divide-y divide-gray-200">
        {week.days.map((day) => {
          const perShift = entriesByDay[day.iso] || {};
          const total = Object.values(perShift).flat().length;
          const isFree = freeDays.has(day.iso);
          const flag = flagFor(day.iso);
          const exception = exceptions[day.iso];

          return (
            <section
              key={day.iso}
              className={clsx(
                'px-3 py-3',
                day.isToday && 'bg-red-50/70 shadow-[inset_2px_0_0_0_#D9000C,inset_-2px_0_0_0_#D9000C]',
                isFree && 'bg-emerald-50',
                day.isPast && !day.isToday && 'opacity-60'
              )}
            >
              <header className="mb-2 flex items-center gap-2">
                <h3 className={clsx(
                  'text-[16px] font-extrabold uppercase tracking-wide',
                  day.isToday ? 'text-etilog' : 'text-gray-900'
                )}>
                  {day.weekday} {day.dayOfMonth}
                </h3>
                {flag && (
                  <span className="rounded bg-etilog px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    Important !
                  </span>
                )}
                {exception && !flag && (
                  <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-600">
                    {exception.note || exception.type.replace(/_/g, ' ')}
                  </span>
                )}
              </header>

              {isFree ? (
                <p className="flex items-center gap-1.5 text-[14px] font-semibold text-emerald-700">
                  <Leaf className="h-4 w-4" aria-hidden="true" />
                  Free day
                </p>
              ) : total === 0 ? (
                <p className="text-[14px] text-gray-400">Nothing planned</p>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {shifts.map((shift, index) => {
                    const cards = perShift[shift.id] || [];
                    const note = shiftNotes[shiftNoteKey(day.iso, shift.id)];
                    if (!cards.length && !note) return null;
                    const accent = shiftAccent(index);
                    const Icon = accent.icon;

                    return (
                      <div key={shift.id} className="flex flex-col gap-1.5">
                        <span className="flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wider text-gray-500">
                          <Icon className={clsx('h-4 w-4', accent.text)} aria-hidden="true" />
                          {shift.name}
                        </span>
                        {cards.map((entry) => (
                          <ViewerCard
                            key={entry.id}
                            entry={entry}
                            change={changeKind(entry)}
                            onOpen={onOpenEntry}
                          />
                        ))}
                        <ShiftNoteBox note={note} />
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

  return (
    <div className={clsx('print-spread', size.spread)}>
      <div className={size.grid}>
        <div className="row-label corner-sticky text-[11px] text-gray-400">Day / Shift</div>
        {week.days.map((day) => (
          <DayHeader
            key={day.iso}
            day={day}
            flag={flagFor(day.iso)}
            isFree={freeDays.has(day.iso)}
            size={size}
          />
        ))}

        {shifts.map((shift, index) => {
          const accent = shiftAccent(index);
          const Icon = accent.icon;

          return (
            <div key={shift.id} className="contents">
              {/* A gutter across the whole grid rather than a heavier rule on
                  each cell - see WeekBlock. */}
              {index > 0 && (
                <div aria-hidden="true"
                     className={clsx('week-gutter', density === 'compact' && 'week-gutter-sm')} />
              )}

              <div className={clsx(
                'row-label flex items-center gap-2',
                size.label
              )}>
                <span aria-hidden="true" className={clsx('h-7 w-1 rounded-sm', accent.bar)} />
                <Icon className={clsx('h-4 w-4', accent.text)} aria-hidden="true" />
                {shift.name}
              </div>

              {week.days.map((day) => {
                const cards = (entriesByDay[day.iso] || {})[shift.id] || [];
                const note = shiftNotes[shiftNoteKey(day.iso, shift.id)];
                const isFree = freeDays.has(day.iso);

                return (
                  <div
                    key={`${shift.id}:${day.iso}`}
                    className={clsx(
                      'week-cell flex flex-col',
                      size.cell,
                      isFree && 'bg-emerald-50/60',
                      // The same two edges as the header, so the day reads as
                      // one column from top to bottom instead of a coloured
                      // hat over ordinary cells.
                      day.isToday && 'bg-red-50/70 shadow-[inset_2px_0_0_0_#D9000C,inset_-2px_0_0_0_#D9000C]',
                      day.isPast && !day.isToday && 'opacity-60'
                    )}
                  >
                    {cards.map((entry) => (
                      <ViewerCard
                        key={entry.id}
                        entry={entry}
                        change={changeKind(entry)}
                        onOpen={onOpenEntry}
                        density={density}
                      />
                    ))}

                    <ShiftNoteBox note={note} compact={density === 'compact'} />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
