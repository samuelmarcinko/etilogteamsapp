import clsx from 'clsx';
import { AlertTriangle, Leaf } from 'lucide-react';

import ViewerCard from './ViewerCard';
import useMediaQuery from '../lib/useMediaQuery';
import { shiftAccent } from '../lib/shifts';
import { shiftNoteKey } from '../lib/weeks';

/**
 * One week, to be read and not touched.
 *
 * Same shape as the planner's grid on purpose - days across, shifts down - but
 * with no drop targets, no add affordances and no day menu, and everything in
 * it set larger. On a phone the seven columns become seven sections, because
 * scrolling sideways to compare Tuesday with Thursday is not reading.
 */

function DayHeader({ day, flag, isFree }) {
  return (
    <div
      className={clsx(
        'week-cell day-sticky px-2 py-2.5 text-center',
        // Exactly one background, chosen here: two bg-* utilities on one element
        // are settled by the compiled stylesheet's order, not the source's.
        day.isToday
          ? 'bg-red-50 shadow-[inset_0_3px_0_0_#D9000C]'
          : isFree
            ? 'bg-emerald-50'
            : flag
              ? 'bg-etilog-light'
              : 'bg-gray-50'
      )}
    >
      <div className={clsx(
        'text-[13px] font-bold uppercase tracking-wider',
        day.isToday ? 'text-etilog' : 'text-gray-500'
      )}>
        {day.weekday}
      </div>
      <div className={clsx(
        'text-[20px] font-extrabold leading-tight',
        day.isToday ? 'text-etilog' : 'text-gray-900'
      )}>
        {day.dayOfMonth}
      </div>

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

function ShiftNoteBox({ note }) {
  if (!note) return null;
  return (
    <p className="mt-auto rounded border border-dashed border-gray-300 bg-gray-50 px-2 py-1.5 text-[13px] leading-snug text-gray-700">
      {note.note}
    </p>
  );
}

export default function ViewerWeek({
  week, shifts, entriesByDay, dayFlags, shiftNotes, exceptions, isUpdated, onOpenEntry
}) {
  const isWide = useMediaQuery('(min-width: 768px)');

  // A day marked free is only free while nothing is planned on it - Saturdays
  // are worked sometimes, and the plan says so before the flag does.
  const freeDays = new Set(
    week.days
      .filter((day) => {
        const flag = dayFlags[day.iso];
        if (flag?.flag !== 'free') return false;
        return !Object.values(entriesByDay[day.iso] || {}).flat().length;
      })
      .map((day) => day.iso)
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
              className={clsx('px-3 py-3', day.isToday && 'bg-red-50', isFree && 'bg-emerald-50')}
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
                            updated={isUpdated(entry)}
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
    <div className="print-spread viewer-spread">
      <div className="viewer-grid">
        <div className="row-label corner-sticky text-[12px] text-gray-400">Day / Shift</div>
        {week.days.map((day) => (
          <DayHeader
            key={day.iso}
            day={day}
            flag={flagFor(day.iso)}
            isFree={freeDays.has(day.iso)}
          />
        ))}

        {shifts.map((shift, index) => {
          const accent = shiftAccent(index);
          const Icon = accent.icon;

          return (
            <div key={shift.id} className="contents">
              <div className={clsx(
                'row-label flex items-center gap-2 text-[14px]',
                index > 0 && 'border-t-2 border-t-gray-300'
              )}>
                <span aria-hidden="true" className={clsx('h-8 w-1 rounded-sm', accent.bar)} />
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
                      'week-cell flex min-h-[110px] flex-col gap-2 p-2',
                      index > 0 && 'border-t-2 border-t-gray-300',
                      isFree && 'bg-emerald-50/60',
                      day.isToday && 'bg-red-50/40'
                    )}
                  >
                    {cards.map((entry) => (
                      <ViewerCard
                        key={entry.id}
                        entry={entry}
                        updated={isUpdated(entry)}
                        onOpen={onOpenEntry}
                      />
                    ))}

                    <ShiftNoteBox note={note} />
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
