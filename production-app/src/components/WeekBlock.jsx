import clsx from 'clsx';
import { AlertTriangle, Copy, Leaf, Plus } from 'lucide-react';

import ProductionCard from './ProductionCard';
import WeekDayList from './WeekDayList';
import DayMenu from './DayMenu';
import ShiftNote from './ShiftNote';
import useMediaQuery from '../lib/useMediaQuery';
import { shiftAccent } from '../lib/shifts';
import { shiftNoteKey } from '../lib/weeks';
import { DraggableCard, DroppableSlot, slotId } from './dnd';

/**
 * One calendar week: a day header row and one row per shift - the Excel layout
 * from section 4.1, as a real grid.
 *
 * Slots are already built to hold several cards, because the historical data
 * does. Nothing here assumes exactly one.
 */

const DAY_FLAG_STYLE = {
  important: 'bg-etilog-light',
  urgent: 'bg-etilog-light'
};

// Copying a whole week is built and working, but nobody has needed it yet and a
// button in every week header is a button in the way. Parked rather than
// deleted - flip this back on when the need turns up.
const SHOW_COPY_WEEK = false;

function DayHeader({ day, flag, isFree, exception, compact, canManage, onSetFlag, onAdd, onBulk }) {
  return (
    <div
      className={clsx(
        'week-cell day-sticky group/day px-2 py-1.5 text-center',
        // Exactly one background wins, chosen here rather than by layering
        // classes: two bg-* utilities on one element are decided by their order
        // in the compiled stylesheet, not by the order they are written in.
        day.isToday
          // Today is a red column head with a rule along the top, so the eye
          // lands on it before it starts reading dates.
          ? 'bg-red-50 shadow-[inset_0_2px_0_0_#D9000C]'
          : isFree
            ? 'bg-emerald-50'
            : flag && DAY_FLAG_STYLE[flag.flag]
              ? DAY_FLAG_STYLE[flag.flag]
              : 'bg-gray-50'
      )}
    >
      {canManage && <DayMenu day={day} flag={flag} onSetFlag={onSetFlag} onAdd={onAdd} onBulk={onBulk} />}

      <div className="flex items-baseline justify-center gap-1">
        <span
          className={clsx(
            'text-[11px] font-semibold uppercase tracking-wider',
            day.isToday ? 'text-etilog' : 'text-gray-600'
          )}
        >
          {day.weekday}
        </span>
        <span
          className={clsx(
            'font-semibold tabular-nums',
            compact ? 'text-[13px]' : 'text-[14px]',
            day.isToday ? 'text-etilog' : 'text-gray-900'
          )}
        >
          {day.dayOfMonth}
        </span>
      </div>

      {/* A day marked free but carrying production is not free any more. It
          reads as an ordinary day until the work is moved off it again, rather
          than claiming "FREE" over the top of a card someone has to build. */}
      {isFree && (
        <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-700">Free</div>
      )}
      {/* A flagged day has to survive being scanned at 8-week density from
          across a room, so it gets a filled badge rather than small red text. */}
      {flag && DAY_FLAG_STYLE[flag.flag] && (
        <div className="mt-0.5 flex items-center justify-center">
          <span className="inline-flex items-center gap-0.5 rounded bg-etilog px-1 py-px text-[10px] font-bold uppercase tracking-wide text-white">
            <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
            Important !
          </span>
        </div>
      )}
      {!flag && exception && (
        <div className="line-clamp-1 text-[10px] text-gray-600" title={exception.note || exception.type}>
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
  onCardMenu,
  onAddEntry,
  onSetDayFlag,
  onSetShiftNote,
  onBulk,
  canManage,
  density = 'normal'
}) {
  const isWide = useMediaQuery('(min-width: 768px)');
  const compact = density === 'compact';

  // One week on screen has room to breathe, and cells that hold three cards
  // without growing are easier to plan into than cells that resize under the
  // pointer. Eight weeks has to earn every pixel instead.
  const slotMinHeight = {
    roomy: 'min-h-[132px]',
    normal: 'min-h-[56px]',
    compact: 'min-h-[42px]'
  }[density];

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

  // Today's week gets its own treatment: at eight weeks on screen, finding
  // "which of these is now" was a matter of reading dates.
  const isCurrentWeek = week.days.some((day) => day.isToday);

  // A day counts as free only while nothing is planned on it. Saturdays are
  // worked sometimes, and a green column labelled FREE over a card someone has
  // to build is worse than no marking at all - so the moment production lands
  // there the day looks like any other, and looks free again once it is moved
  // off. The flag itself is left alone.
  const freeDays = new Set(
    week.days
      .filter((day) => dayFlags[day.iso]?.flag === 'free' && emptyDays.has(day.iso))
      .map((day) => day.iso)
  );

  /**
   * What an empty slot says, if anything. Marked once per day, on the first
   * shift row: an empty shift on an otherwise busy day is left blank, because
   * that blank is itself the information.
   */
  const emptyLabel = (day, shiftIndex, isFree) => {
    if (shiftIndex !== 0) return null;

    // A free day says so in the cell as well as in the column head: the green
    // tint alone is a colour someone has to be told the meaning of.
    if (isFree) {
      return (
        <span className="flex items-center gap-1 font-medium text-emerald-700">
          <Leaf className="h-3.5 w-3.5" aria-hidden="true" />
          {compact ? '' : 'Free day'}
        </span>
      );
    }

    if (!emptyDays.has(day.iso) || weekIsEmpty) return null;
    return compact ? '—' : 'Nothing planned yet';
  };

  return (
    <section
      className={clsx(
        // overflow-clip rather than overflow-hidden: hidden makes this a scroll
        // container, which would capture the sticky day names and pin them
        // inside the week instead of under the toolbar. clip trims the corners
        // without becoming one.
        'print-block overflow-clip rounded-lg border border-gray-300 bg-white',
        // Eight of these stacked read as one long table unless each is clearly
        // its own object: a firmer edge and a real shadow, not a hairline. The
        // current week takes no colour on its perimeter - it used to carry a
        // blue rule down its left edge, running right alongside the amber and
        // indigo bars that name the shifts, so three coloured lines met in the
        // same eight pixels and none of them read. It is marked by its header
        // instead, which is a band of its own that touches nothing.
        isCurrentWeek ? 'shadow-weekCurrent' : 'shadow-week'
      )}
    >
      {/* week header */}
      <header
        className={clsx(
          'flex items-baseline gap-2.5 border-b px-4 py-2.5',
          // The week you are in is the one you look for first, so its header is
          // filled rather than tinted: scrolling eight weeks, one solid band is
          // found without reading a single date. Blue, because red already means
          // urgent and green means free - a third meaning on either would make
          // both weaker.
          isCurrentWeek
            ? 'week-head-now border-blue-700 bg-blue-600'
            : 'border-gray-200 bg-gray-50'
        )}
      >
        <h2
          className={clsx(
            'text-[15px] font-extrabold uppercase tracking-wider',
            isCurrentWeek ? 'text-white' : 'text-gray-900'
          )}
        >
          CW {week.calendarWeek}
        </h2>
        <span className={clsx('text-[13px]', isCurrentWeek ? 'text-blue-100' : 'text-gray-600')}>
          {week.rangeLabel}
        </span>

        {isCurrentWeek && (
          <span className="week-now rounded bg-white px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-blue-700">
            This week
          </span>
        )}

        {weekIsEmpty && (
          <span className={clsx(
            'ml-auto text-[12px]',
            isCurrentWeek ? 'text-blue-100' : 'text-gray-500'
          )}>
            Nothing planned yet
          </span>
        )}

        {SHOW_COPY_WEEK && canManage && !weekIsEmpty && (
          <button
            type="button"
            onClick={() => onBulk('copyWeek', week.days[0])}
            className="no-print ml-auto flex items-center gap-1.5 rounded-md border border-gray-300
                       bg-white px-2 py-1 text-[12px] font-medium text-gray-600 shadow-xs transition
                       hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900"
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
          onCardMenu={onCardMenu}
        />
      ) : (
        <div className="print-spread">
          <div className="week-grid">
            {/* corner + day headers */}
            <div className="row-label corner-sticky bg-gray-50 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
              Day / Shift
            </div>
            {week.days.map((day) => (
              <DayHeader
                key={day.iso}
                day={day}
                flag={dayFlags[day.iso]}
                isFree={freeDays.has(day.iso)}
                exception={exceptions[day.iso]}
                compact={compact}
                canManage={canManage}
                onSetFlag={onSetDayFlag}
                onAdd={(d) => onAddEntry({ date: d.iso, shiftId: shifts[0]?.id, shiftName: shifts[0]?.name })}
                onBulk={onBulk}
              />
            ))}

            {/* one row per shift */}
            {shifts.map((shift, shiftIndex) => (
              <Row
                key={shift.id}
                label={shift.name}
                accent={shiftAccent(shiftIndex)}
                divide={shiftIndex > 0}
                compact={compact}
              >
                {week.days.map((day) => {
                  const cards = entriesByDay[day.iso]?.[shift.id] || [];
                  const isFree = freeDays.has(day.iso);

                  return (
                    <DroppableSlot
                      key={day.iso}
                      id={slotId(day.iso, shift.id)}
                      disabled={!canManage}
                      hasCards={cards.length > 0}
                      className={clsx(
                        'week-cell group/slot relative flex flex-col gap-1 p-1',
                        slotMinHeight,
                        day.isWeekend && !cards.length && !isFree && 'bg-gray-50/60',
                        isFree && 'bg-emerald-50'
                      )}
                    >
                      {cards.map((entry) => (
                        <DraggableCard key={entry.id} entry={entry} disabled={!canManage}>
                          <ProductionCard
                            entry={entry}
                            onOpen={onOpenEntry}
                            onContextMenu={onCardMenu}
                            compact={compact}
                          />
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
                                'select-none text-center leading-tight text-gray-400',
                                'group-hover/add:opacity-0',
                                compact ? 'text-[10px]' : 'text-[11px]'
                              )}
                            >
                              {emptyLabel(day, shiftIndex, isFree)}
                            </span>
                          )}
                          <span
                            className="no-print absolute flex items-center gap-1 text-[11px] font-medium
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
                              'select-none self-center pt-1 text-center leading-tight text-gray-400',
                              compact ? 'text-[10px]' : 'text-[11px]'
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
                                     border-gray-300 py-0.5 text-[11px] text-gray-500 opacity-0 transition
                                     hover:border-etilog hover:text-etilog focus-visible:opacity-100
                                     group-hover/slot:opacity-100"
                        >
                          <Plus className="h-3 w-3" aria-hidden="true" />
                          Add
                        </button>
                      )}

                      {/* The note about the shift itself, in the cell that is
                          that shift on that day. Last, so it sits under the
                          cards it qualifies. */}
                      {!compact && (
                        <ShiftNote
                          note={shiftNotes[shiftNoteKey(day.iso, shift.id)]}
                          canManage={canManage}
                          label={`${shift.name}, ${day.weekday} ${day.dayOfMonth}`}
                          onSave={(text) => onSetShiftNote(day.iso, shift.id, text)}
                        />
                      )}
                    </DroppableSlot>
                  );
                })}
              </Row>
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
function Row({ label, children, muted = false, accent = null, divide = false, compact = false }) {
  const Icon = accent?.icon;

  return (
    <>
      {/* A gutter across the whole grid rather than a heavier rule on each
          cell: whitespace separates the two shifts into two objects, where one
          more line in a grid made of lines separated nothing. */}
      {divide && <div aria-hidden="true" className={clsx('week-gutter', compact && 'week-gutter-sm')} />}

      <div
        className={clsx(
          'row-label relative flex items-center gap-1.5',
          muted && 'text-[11px] font-normal normal-case text-gray-500'
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
