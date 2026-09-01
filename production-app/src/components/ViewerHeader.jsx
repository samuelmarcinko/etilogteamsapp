import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { format } from 'date-fns';
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, Pencil, RefreshCw } from 'lucide-react';
import { WEEK_SPANS } from '../lib/weeks';

/**
 * The viewer's toolbar: where you are, which week, and how fresh it is.
 *
 * Everything the planner's header carries that changes something is absent.
 * What replaces it is the time of the last refresh - a plan on a bench tablet
 * that quietly went stale an hour ago is worse than no plan at all, so the page
 * says out loud when it last heard from the server.
 */

export default function ViewerHeader({
  locations, activeCode, onSelectLocation,
  weeks, spanWeeks, onSpanChange, onPrev, onNext, onToday,
  updatedAt, isFetching, onRefresh, canManage
}) {
  const first = weeks[0];
  const last = weeks[weeks.length - 1];
  const ref = useRef(null);

  // The week grid parks its day names under this header, so it has to know how
  // tall the header actually is - which changes when the tabs wrap.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const publish = () =>
      document.documentElement.style.setProperty('--plan-header-h', `${node.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <header ref={ref} className="sticky top-0 z-30 border-b border-gray-200 bg-white shadow-xs">
      <div className="flex flex-col gap-2.5 px-5 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <a
              href="/portal/"
              className="group flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-white
                         px-2.5 py-1.5 text-[13px] font-medium text-gray-700 shadow-xs transition
                         hover:border-etilog hover:bg-etilog-light hover:text-etilog"
            >
              <ArrowLeft
                className="h-3.5 w-3.5 transition-transform duration-150 ease-portal group-hover:-translate-x-0.5"
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Portal</span>
            </a>

            <img src="/assets/images/logo.png" alt="ETILOG" className="h-6 w-auto shrink-0 sm:h-7" />
            <span aria-hidden="true" className="hidden h-6 w-px shrink-0 bg-gray-200 sm:block" />
            <h1 className="truncate text-[17px] font-bold uppercase tracking-wide text-gray-900">
              Production
            </h1>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {/* When it last heard from the server, not when the page opened. */}
            <button
              type="button"
              onClick={onRefresh}
              title="Refresh now"
              className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5
                         text-[13px] font-medium text-gray-600 transition hover:bg-gray-50"
            >
              <RefreshCw
                className={clsx('h-3.5 w-3.5', isFetching && 'animate-spin')}
                aria-hidden="true"
              />
              <span className="hidden sm:inline tabular-nums">
                {updatedAt ? format(updatedAt, 'HH:mm') : '—'}
              </span>
            </button>

            {/* Someone who can plan should not have to remember the other URL. */}
            {canManage && (
              <a
                href="/production/"
                className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5
                           text-[13px] font-medium text-gray-700 transition hover:bg-gray-50"
              >
                <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Planner</span>
              </a>
            )}
          </div>
        </div>

        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <div role="tablist" aria-label="Production locations" className="flex min-w-max gap-1 pb-0.5">
            {locations.map((location) => {
              const active = location.code === activeCode;
              return (
                <button
                  key={location.code}
                  role="tab"
                  aria-selected={active}
                  onClick={() => onSelectLocation(location.code)}
                  className={clsx(
                    'whitespace-nowrap rounded-md px-3 py-1.5 text-[15px] font-medium transition duration-150 ease-portal',
                    active
                      ? 'bg-etilog text-white shadow-xs'
                      : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  )}
                >
                  {location.name}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onPrev}
              aria-label="Previous weeks"
              className="rounded-md border border-gray-300 bg-white p-2 text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={onToday}
              className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-2 text-[14px] font-medium text-gray-700 transition hover:bg-gray-50"
            >
              <CalendarDays className="h-4 w-4" aria-hidden="true" />
              This week
            </button>
            <button
              type="button"
              onClick={onNext}
              aria-label="Next weeks"
              className="rounded-md border border-gray-300 bg-white p-2 text-gray-600 transition hover:bg-gray-50 hover:text-gray-900"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          <p className="order-last flex w-full items-baseline justify-center gap-2 rounded-full border
                        border-blue-200 bg-blue-50 px-4 py-1.5 sm:order-none sm:w-auto">
            <span className="text-[16px] font-bold tracking-wide text-blue-900">
              {spanWeeks === 1
                ? `CW ${first.calendarWeek}`
                : `CW ${first.calendarWeek}–${last.calendarWeek}`}
            </span>
            <span className="text-[14px] text-blue-700">
              {spanWeeks === 1
                ? first.rangeLabel
                : `${format(first.start, 'd MMM')} – ${format(last.end, 'd MMM yyyy')}`}
            </span>
          </p>

          {/* One week to work a shift by, four or eight to see what is coming.
              The location already names itself in the selected tab above, so
              this corner is better spent on the one control the viewer has. */}
          <div className="flex items-center gap-0.5 rounded-md border border-gray-300 bg-white p-0.5">
            {WEEK_SPANS.map((span) => (
              <button
                key={span}
                type="button"
                aria-pressed={span === spanWeeks}
                onClick={() => onSpanChange(span)}
                className={clsx(
                  'rounded px-2.5 py-1 text-[14px] font-medium transition',
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
