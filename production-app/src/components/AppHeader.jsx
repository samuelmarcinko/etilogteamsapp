import clsx from 'clsx';
import { format } from 'date-fns';
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Eye, History, Inbox, Printer } from 'lucide-react';
import { WEEK_SPANS } from '../lib/weeks';

/**
 * Header: location tabs, week navigation and the 1/4/8-week switch.
 *
 * Location tabs scroll horizontally rather than wrapping, so twelve locations
 * do not push the grid down the page on a tablet.
 */

function LocationTabs({ locations, activeCode, onSelect }) {
  return (
    <div className="no-print -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <div role="tablist" aria-label="Production locations" className="flex min-w-max gap-1 pb-0.5">
        {locations.map((location) => {
          const active = location.code === activeCode;
          return (
            <button
              key={location.code}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(location.code)}
              className={clsx(
                'whitespace-nowrap rounded-md px-3 py-1.5 text-[13px] font-medium transition duration-150 ease-portal',
                active
                  ? 'bg-etilog text-white shadow-xs'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              {location.name}
              {!location.is_internal && (
                <span className={clsx('ml-1.5 text-[10px]', active ? 'text-white/70' : 'text-gray-400')}>
                  ext
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function AppHeader({
  locations,
  activeCode,
  onSelectLocation,
  weeks,
  spanWeeks,
  onSpanChange,
  onPrev,
  onNext,
  onToday,
  readOnly,
  unscheduledCount,
  onToggleUnscheduled,
  onToggleHistory
}) {
  const first = weeks[0];
  const last = weeks[weeks.length - 1];

  return (
    <header className="sticky top-0 z-30 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-2.5 px-4 py-3">
        {/* title row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <a
              href="/portal/"
              className="no-print flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-gray-500 transition hover:bg-gray-100 hover:text-gray-900"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Portal</span>
            </a>
            <h1 className="truncate text-[15px] font-bold uppercase tracking-wide text-gray-900">
              Production Plan
            </h1>
            {readOnly && (
              <span className="no-print inline-flex shrink-0 items-center gap-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
                <Eye className="h-3 w-3" aria-hidden="true" />
                View only
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onToggleUnscheduled}
              className="no-print flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[12px] font-medium text-gray-700 transition hover:bg-gray-50"
            >
              <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Unscheduled</span>
              {unscheduledCount > 0 && (
                <span className="rounded bg-etilog px-1.5 py-px text-[10px] font-bold tabular-nums text-white">
                  {unscheduledCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onToggleHistory}
              className="no-print flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[12px] font-medium text-gray-700 transition hover:bg-gray-50"
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">History</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="no-print flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[12px] font-medium text-gray-700 transition hover:bg-gray-50"
            >
              <Printer className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Print</span>
            </button>
          </div>
        </div>

        <LocationTabs locations={locations} activeCode={activeCode} onSelect={onSelectLocation} />

        {/* week navigation */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="no-print flex items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              aria-label="Previous weeks"
              className="rounded-md border border-gray-300 bg-white p-1.5 text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onToday}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[12px] font-medium text-gray-700 transition hover:bg-gray-50"
            >
              <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
              Today
            </button>
            <button
              type="button"
              onClick={onNext}
              aria-label="Next weeks"
              className="rounded-md border border-gray-300 bg-white p-1.5 text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>

          <p className="order-last w-full text-[12px] text-gray-500 sm:order-none sm:w-auto">
            {spanWeeks === 1 ? (
              <>
                <span className="font-semibold text-gray-700">CW {first.calendarWeek}</span>
                {' · '}
                {first.rangeLabel}
              </>
            ) : (
              <>
                <span className="font-semibold text-gray-700">
                  CW {first.calendarWeek}–{last.calendarWeek}
                </span>
                {' · '}
                {format(first.start, 'd MMM')} – {format(last.end, 'd MMM yyyy')}
              </>
            )}
          </p>

          <div className="no-print flex items-center gap-0.5 rounded-md border border-gray-300 bg-white p-0.5">
            {WEEK_SPANS.map((span) => (
              <button
                key={span}
                type="button"
                aria-pressed={span === spanWeeks}
                onClick={() => onSpanChange(span)}
                className={clsx(
                  'rounded px-2.5 py-1 text-[12px] font-medium transition',
                  span === spanWeeks
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                )}
              >
                {span}w
              </button>
            ))}
          </div>
        </div>
      </div>
    </header>
  );
}
