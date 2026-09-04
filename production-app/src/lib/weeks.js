import {
  startOfISOWeek,
  endOfISOWeek,
  addWeeks,
  addDays,
  format,
  getISOWeek,
  isBefore,
  isSameMonth,
  isToday,
  startOfDay,
  parseISO
} from 'date-fns';

/**
 * Week maths for the planner grid.
 *
 * ISO weeks throughout: the Excel sheets label weeks KW/WK with Monday as day
 * one, and getISOWeek matches that. Dates are handled as plain YYYY-MM-DD
 * strings at the API boundary so a timezone never shifts a production day.
 */

export const WEEK_SPANS = [1, 4, 8];

export function toISODate(date) {
  return format(date, 'yyyy-MM-dd');
}

/** Monday of the week containing `date`. */
export function weekStart(date) {
  return startOfISOWeek(date);
}

/**
 * `spanWeeks` consecutive weeks starting from the week containing `anchor`.
 * Each entry carries the seven days plus the label the header shows.
 */
export function buildWeeks(anchor, spanWeeks) {
  const first = startOfISOWeek(anchor);
  // Computed once for the whole grid rather than per cell: it is the same
  // answer 56 times, and it must not change halfway down the page.
  const today = startOfDay(new Date());

  return Array.from({ length: spanWeeks }, (_, i) => {
    const start = addWeeks(first, i);
    const end = endOfISOWeek(start);
    const days = Array.from({ length: 7 }, (_, d) => {
      const date = addDays(start, d);
      return {
        date,
        iso: toISODate(date),
        weekday: format(date, 'EEE').toUpperCase(),
        dayOfMonth: format(date, 'd'),
        isWeekend: d >= 5,
        isToday: isToday(date),
        // Days already behind us. The shop floor screen dims them so the eye
        // falls on the day being worked rather than searching for it.
        isPast: isBefore(date, today)
      };
    });

    return {
      key: toISODate(start),
      calendarWeek: getISOWeek(start),
      start,
      end,
      days,
      // "17-23 Aug 2026", or "29 Sep - 5 Oct 2026" across a month boundary
      rangeLabel: isSameMonth(start, end)
        ? `${format(start, 'd')}–${format(end, 'd MMM yyyy')}`
        : `${format(start, 'd MMM')} – ${format(end, 'd MMM yyyy')}`
    };
  });
}

/** The from/to the API should be asked for, covering every visible week. */
export function rangeForWeeks(weeks) {
  return {
    from: toISODate(weeks[0].start),
    to: toISODate(weeks[weeks.length - 1].end)
  };
}

/**
 * Group flat plan rows into { [isoDate]: { [shiftId]: entries[] } }.
 *
 * The API returns rows already ordered by date, shift and card order, so this
 * only buckets them - it never re-sorts.
 */
export function groupEntries(entries) {
  const byDay = {};
  for (const entry of entries) {
    const iso = typeof entry.production_date === 'string'
      ? entry.production_date.slice(0, 10)
      : toISODate(parseISO(entry.production_date));

    byDay[iso] = byDay[iso] || {};
    const shiftKey = entry.shift_id ?? 'unassigned';
    byDay[iso][shiftKey] = byDay[iso][shiftKey] || [];
    byDay[iso][shiftKey].push(entry);
  }
  return byDay;
}

/** Day flags keyed by date, for the FREE / IMPORTANT column treatment. */
export function indexDayFlags(dayFlags) {
  const map = {};
  for (const flag of dayFlags) {
    const iso = typeof flag.production_date === 'string'
      ? flag.production_date.slice(0, 10)
      : toISODate(parseISO(flag.production_date));
    map[iso] = flag;
  }
  return map;
}

/**
 * Shift notes keyed by "date|shiftId", since a note belongs to one shift on one
 * day rather than to the day as a whole - the morning and the afternoon shift
 * are often running different orders.
 */
export function shiftNoteKey(iso, shiftId) {
  return `${iso}|${shiftId}`;
}

export function indexShiftNotes(notes) {
  const map = {};
  for (const note of notes) {
    const iso = typeof note.production_date === 'string'
      ? note.production_date.slice(0, 10)
      : toISODate(parseISO(note.production_date));
    map[shiftNoteKey(iso, note.shift_id)] = note;
  }
  return map;
}

export function indexCalendarExceptions(exceptions) {
  const map = {};
  for (const item of exceptions) {
    const iso = typeof item.exception_date === 'string'
      ? item.exception_date.slice(0, 10)
      : toISODate(parseISO(item.exception_date));
    map[iso] = item;
  }
  return map;
}

/**
 * Quantity as the card shows it: a whole number of pieces, or null.
 *
 * It used to also carry a breakdown, for the "130+22" cells the Excel sheet
 * held. Those are gone (migration 029) - two deliveries are two cards.
 */
export function formatQuantity(entry) {
  if (entry.planned_quantity == null) return null;
  const quantity = Number(entry.planned_quantity);
  return Number.isFinite(quantity) ? quantity : null;
}
