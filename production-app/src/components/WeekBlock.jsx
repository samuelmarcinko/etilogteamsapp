import { Fragment } from 'react';
import clsx from 'clsx';
import { AlertTriangle, Copy, Plus } from 'lucide-react';

import ProductionCard from './ProductionCard';
import WeekDayList from './WeekDayList';
import DayMenu from './DayMenu';
import ShiftNoteCell from './ShiftNoteCell';
import useMediaQuery from '../lib/useMediaQuery';
import { shiftAccent } from '../lib/shifts';
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

  /**
   * What an empty slot says, if anything. Marked once per day, on the first
   * shift row: an empty shift on an otherwise busy day is left blank, because
   * that blank is itself the information.
   */
  const emptyLabel = (day, shiftIndex, isFree) => {
    if (!emptyDays.has(day.iso) || weekIsEmpty || shiftIndex !== 0 || isFree) return null;
    return compact ? '—' : 'Nothing planned yet';
  };

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
              <Row label={shift.name} accent={shiftAccent(shiftIndex)} divide={shiftIndex > 0}>
                {week.days.map((day) => {
                  const cards = entriesByDay[day.iso]?.[shift.id] || [];
                  const flag = dayFlags[day.iso];
                  const isFree = flag?.flag === 'free';

                  return (
                    <DroppableSlot
                      key={day.iso}
                      id={slotId(day.iso, shift.id)}
                      disabled={!canManage}
                      hasCards={cards.length > 0}
                      className={clsx(
                        'week-cell group/slot relative flex flex-col gap-1 p-1',
                        compact ? 'min-h-[42px]' : 'min-h-[56px]',
                        // The rule that separates one shift block from the next.
                        shiftIndex > 0 && 'border-t-2 border-t-gray-300',
                        day.isWeekend && !cards.length && 'bg-gray-50/60',
                        isFree && 'bg-emerald-50/50'
                      )}
                    >
                      {cards.map((entry) => (
                        <DraggableCard key={entry.id} entry={entry} disabled={!canManage}>
                          <ProductionCard entry={entry} onOpen={onOpenEntry} compact={compact} />
                        </DraggableCard>
                      ))}

                      {/* An empty slot is the whole click target, not a strip
                          along its bottom edge: aiming for a 14px band inside a
                          cell is a worse job than the Excel sheet, where you
                          clicked the cell and typed. The "nothing planned"
                          label lives inside it and gives way to "Add" on hover,
                          so the two never compete for the same space. */}
                      {cards.length === 0 && canManage ? (
                        <button
                          type="button"
                          onClick={() =>
                            onAddEntry({ date: day.iso, shiftId: shift.id, shiftName: shift.name })
                          }
                          aria-label={`Add production to ${day.weekday} ${day.dayOfMonth}, ${shift.name}`}
                          className="group/add absolute inset-0 flex items-center justify-center rounded
                                     transition hover:bg-gray-100 focus-visible:outline-none
                                     focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-etilog
                                     group-data-[over]/slot:bg-transparent"
                        >
                          {emptyLabel(day, shiftIndex, isFree) && (
                            <span
                              className={clsx(
                                'select-none text-center leading-tight text-gray-300',
                                'group-hover/add:opacity-0',
                                compact ? 'text-[9px]' : 'text-[10px]'
                              )}
                            >
                              {emptyLabel(day, shiftIndex, isFree)}
                            </span>
                          )}
                          <span
                            className="no-print absolute flex items-center gap-1 text-[10px] font-medium
                                       text-gray-500 opacity-0 transition group-hover/add:opacity-100
                                       group-focus-visible/add:opacity-100"
                          >
                            <Plus className="h-3 w-3" aria-hidden="true" />
                            Add
                          </span>
                        </button>
                      ) : (
                        emptyLabel(day, shiftIndex, isFree) && (
                          <span
                            className={clsx(
                              'select-none self-center pt-1 text-center leading-tight text-gray-300',
                              compact ? 'text-[9px]' : 'text-[10px]'
                            )}
                          >
                            {emptyLabel(day, shiftIndex, isFree)}
                          </span>
                        )
                      )}

                      {/* A slot that already holds cards keeps the quiet strip:
                          the cards own the space, and this only has to say
                          "another one goes underneath". */}
                      {canManage && cards.length > 0 && !compact && (
                        <button
                          type="button"
                          onClick={() =>
                            onAddEntry({ date: day.iso, shiftId: shift.id, shiftName: shift.name })
                          }
                          aria-label={`Add production to ${day.weekday} ${day.dayOfMonth}, ${shift.name}`}
                          className="no-print mt-auto flex items-center justify-center gap-1 rounded border border-dashed
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
              <Row label="Notes" muted accent={shiftAccent(shiftIndex)}>
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

/**
 * A grid row: its sticky label, then its seven day cells.
 *
 * `accent` marks which shift the row belongs to - a colour bar down the left of
 * the label, and an icon on the shift row itself. Two rows of white cells stack
 * into one undifferentiated block otherwise, and at 8-week density it stops
 * being obvious which row is the morning.
 */
function Row({ label, children, muted = false, accent = null, divide = false }) {
  const Icon = accent?.icon;

  return (
    <>
      <div
        className={clsx(
          'row-label relative flex items-center gap-1.5',
          muted && 'text-[10px] font-normal normal-case text-gray-400',
          divide && 'border-t-2 border-t-gray-300'
        )}
      >
        {accent && (
          <span aria-hidden="true" className={clsx('absolute inset-y-0 left-0 w-[3px]', accent.bar)} />
        )}
        {Icon && !muted && <Icon className={clsx('h-3.5 w-3.5 shrink-0', accent.text)} aria-hidden="true" />}
        <span className="truncate">{label}</span>
      </div>
      {children}
    </>
  );
}
