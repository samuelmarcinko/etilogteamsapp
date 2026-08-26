import { Fragment } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Copy, Plus } from 'lucide-react';

import ProductionCard from './ProductionCard';
import WeekDayList from './WeekDayList';
import DayMenu from './DayMenu';
import ShiftNoteCell from './ShiftNoteCell';
import useMediaQuery from '../lib/useMediaQuery';
import { shiftNoteKey } from '../lib/weeks';
import { DraggableCard, DroppableSlot, slotId } from './dnd';

/**
 * One calendar week: a day header row, one row per shift, and a notes row -
 * the Excel layout from section 4.1, as a real grid.
 *
 * Slots are already built to hold several cards, because the historical data
 * does. Nothing here assumes exactly one.
 */

const DAY_FLAG_STYLE = {
  free: 'bg-emerald-50',
  important: 'bg-etilog-light',
  urgent: 'bg-etilog-light'
};

function DayHeader({ day, flag, exception, compact, canManage, onSetFlag, onAdd, onBulk }) {
  return (
    <div
      className={clsx(
        'week-cell group/day sticky top-0 z-20 px-2 py-1.5 text-center',
        day.isWeekend && 'bg-gray-50',
        flag && DAY_FLAG_STYLE[flag.flag],
        day.isToday && 'shadow-[inset_0_-2px_0_0_#D9000C]'
      )}
    >
      {canManage && <DayMenu day={day} flag={flag} onSetFlag={onSetFlag} onAdd={onAdd} onBulk={onBulk} />}

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
      {/* A flagged day has to survive being scanned at 8-week density from
          across a room, so it gets a filled badge rather than small red text. */}
      {flag && flag.flag !== 'free' && (
        <div className="mt-0.5 flex items-center justify-center">
          <span className="inline-flex items-center gap-0.5 rounded bg-etilog px-1 py-px text-[9px] font-bold uppercase tracking-wide text-white">
            <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
            Important !
          </span>
        </div>
      )}
      {!flag && exception && (
        <div className="line-clamp-1 text-[9px] text-gray-500" title={exception.note || exception.type}>
          {exception.note || exception.type.replace(/_/g, ' ')}
        </div>
      )}
    </div>
  );
}

export default function WeekBlock({
  week,
  shifts,
  entriesByDay,
  dayFlags,
  shiftNotes,
  exceptions,
  onOpenEntry,
  onAddEntry,
  onSetDayFlag,
  onSetShiftNote,
  onBulk,
  canManage,
  compact
}) {
  const isWide = useMediaQuery('(min-width: 768px)');

  /** Notes written on the cards in one slot - shown under the shift note. */
  const cardNotesFor = (iso, shiftId) =>
    (entriesByDay[iso]?.[shiftId] || [])
      .filter((entry) => entry.notes)
      .map((entry) => `${entry.fg_number || entry.custom_product_name}: ${entry.notes}`);

  // Days with no production at all, across every shift.
  const emptyDays = new Set(
    week.days
      .filter((day) => Object.values(entriesByDay[day.iso] || {}).flat().length === 0)
      .map((day) => day.iso)
  );

  // When nothing at all is planned, the week is labelled once in its header
  // rather than seven times across the row - the per-day note earns its place
  // by contrast with the days around it, and there is no contrast here.
  const weekIsEmpty = emptyDays.size === week.days.length;

  return (
    <section className="print-block overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      {/* week header */}
      <header className="flex items-baseline gap-2 border-b border-gray-200 bg-gray-25 px-4 py-2">
        <h2 className="text-[13px] font-bold uppercase tracking-wider text-gray-900">
          CW {week.calendarWeek}
        </h2>
        <span className="text-[12px] text-gray-500">{week.rangeLabel}</span>
        {weekIsEmpty && (
          <span className="ml-auto text-[11px] text-gray-400">Nothing planned yet</span>
        )}

        {canManage && !weekIsEmpty && (
          <button
            type="button"
            onClick={() => onBulk('copyWeek', week.days[0])}
            className="no-print ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]
                       font-medium text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
          >
            <Copy className="h-3 w-3" aria-hidden="true" />
            Copy week
          </button>
        )}
      </header>

      {/* phones get the stacked day list instead of a sideways-scrolling grid */}
      {!isWide ? (
        <WeekDayList
          week={week}
          shifts={shifts}
          entriesByDay={entriesByDay}
          dayFlags={dayFlags}
          shiftNotes={shiftNotes}
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
                canManage={canManage}
                onSetFlag={onSetDayFlag}
                onAdd={(d) => onAddEntry({ date: d.iso, shiftId: shifts[0]?.id, shiftName: shifts[0]?.name })}
                onBulk={onBulk}
              />
            ))}

            {/* one row per shift, each with its own notes row underneath */}
            {shifts.map((shift, shiftIndex) => (
              <Fragment key={shift.id}>
              <Row label={shift.name}>
                {week.days.map((day) => {
                  const cards = entriesByDay[day.iso]?.[shift.id] || [];
                  const flag = dayFlags[day.iso];
                  const isFree = flag?.flag === 'free';
                  const dayIsEmpty = emptyDays.has(day.iso);

                  return (
                    <DroppableSlot
                      key={day.iso}
                      id={slotId(day.iso, shift.id)}
                      disabled={!canManage}
                      hasCards={cards.length > 0}
                      className={clsx(
                        'week-cell group/slot relative flex flex-col gap-1 p-1',
                        compact ? 'min-h-[42px]' : 'min-h-[56px]',
                        day.isWeekend && !cards.length && 'bg-gray-50/60',
                        isFree && 'bg-emerald-50/50'
                      )}
                    >
                      {cards.map((entry) => (
                        <DraggableCard key={entry.id} entry={entry} disabled={!canManage}>
                          <ProductionCard entry={entry} onOpen={onOpenEntry} compact={compact} />
                        </DraggableCard>
                      ))}

                      {/* Marked once per day, on the first shift row, so a day
                          with nothing planned reads as deliberate rather than as
                          a rendering gap. An empty shift on an otherwise busy day
                          is left blank - that blank is itself the information. */}
                      {dayIsEmpty && !weekIsEmpty && shiftIndex === 0 && !isFree && (
                        <span
                          className={clsx(
                            'select-none self-center pt-1 text-center leading-tight text-gray-300',
                            compact ? 'text-[9px]' : 'text-[10px]'
                          )}
                        >
                          {compact ? '—' : 'Nothing planned yet'}
                        </span>
                      )}

                      {/* Appears on hover, so an empty slot is a place to click
                          rather than dead space. */}
                      {canManage && !compact && (
                        <button
                          type="button"
                          onClick={() =>
                            onAddEntry({ date: day.iso, shiftId: shift.id, shiftName: shift.name })
                          }
                          aria-label={`Add production to ${day.weekday} ${day.dayOfMonth}, ${shift.name}`}
                          className="mt-auto flex items-center justify-center gap-1 rounded border border-dashed
                                     border-gray-300 py-0.5 text-[10px] text-gray-400 opacity-0 transition
                                     hover:border-etilog hover:text-etilog focus-visible:opacity-100
                                     group-hover/slot:opacity-100"
                        >
                          <Plus className="h-3 w-3" aria-hidden="true" />
                          Add
                        </button>
                      )}
                    </DroppableSlot>
                  );
                })}
              </Row>

              {/* Notes for this shift, directly under it - a note about the
                  morning belongs next to the morning, not in one shared row at
                  the bottom that says nothing about which shift it means. */}
              <Row label="Notes" muted>
                {week.days.map((day) => (
                  <ShiftNoteCell
                    key={day.iso}
                    note={shiftNotes[shiftNoteKey(day.iso, shift.id)]}
                    cardNotes={cardNotesFor(day.iso, shift.id)}
                    canManage={canManage}
                    weekend={day.isWeekend}
                    label={`${shift.name}, ${day.weekday} ${day.dayOfMonth}`}
                    onSave={(text) => onSetShiftNote(day.iso, shift.id, text)}
                  />
                ))}
              </Row>
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Row({ label, children, muted = false }) {
  return (
    <>
      <div
        className={clsx(
          'row-label flex items-center',
          muted && 'text-[10px] font-normal normal-case text-gray-400'
        )}
      >
        {label}
      </div>
      {children}
    </>
  );
}
