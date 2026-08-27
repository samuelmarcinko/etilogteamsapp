import { useEffect, useRef } from 'react';
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
                'whitespace-nowrap rounded-md px-3 py-1.5 text-[14px] font-medium transition duration-150 ease-portal',
                active
                  ? 'bg-etilog text-white shadow-xs'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              )}
            >
              {location.name}
              {!location.is_internal && (
                <span className={clsx('ml-1.5 text-[11px]', active ? 'text-white/70' : 'text-gray-400')}>
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
  const ref = useRef(null);

  // The week grid parks its day names directly under this header, so it has to
  // know how tall the header actually is - which changes when the location tabs
  // wrap or the window narrows.
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
    // Opaque, not translucent: the grid scrolls underneath it, and 5% of a
    // production card bleeding through the toolbar reads as a rendering fault.
    <header ref={ref} className="sticky top-0 z-30 border-b border-gray-200 bg-white shadow-xs">
      <div className="flex flex-col gap-2.5 px-5 py-3">
        {/* title row */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <a
              href="/portal/"
              className="no-print group flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-white
                         px-2.5 py-1.5 text-[13px] font-medium text-gray-700 shadow-xs transition
                         hover:border-etilog hover:bg-etilog-light hover:text-etilog"
            >
              <ArrowLeft
                className="h-3.5 w-3.5 transition-transform duration-150 ease-portal group-hover:-translate-x-0.5"
                aria-hidden="true"
              />
              <span className="hidden sm:inline">Portal</span>
            </a>

            <img
              src="/assets/images/logo.png"
              alt="ETILOG"
              className="h-6 w-auto shrink-0 sm:h-7"
            />

            <span aria-hidden="true" className="hidden h-6 w-px shrink-0 bg-gray-200 sm:block" />

            <h1 className="truncate text-[16px] font-bold uppercase tracking-wide text-gray-900">
              Production Plan
            </h1>

            {/* Paper has no location tabs, so the printout has to name its own
                location - otherwise two sheets on a wall are indistinguishable. */}
            <span className="print-only text-[14px] font-semibold text-gray-700">
              {locations.find((location) => location.code === activeCode)?.name || activeCode}
            </span>
            {/* Someone who cannot change anything is on the wrong screen: the
                viewer is the same plan, read the way they need to read it. So
                the badge that told them their limits is now the way out of
                it. */}
            {readOnly && (
              <a
                href={`/production/view/${activeCode || ''}`}
                className="no-print inline-flex shrink-0 items-center gap-1 rounded border border-gray-200 bg-gray-50
                           px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 transition
                           hover:border-etilog hover:bg-etilog-light hover:text-etilog"
              >
                <Eye className="h-3 w-3" aria-hidden="true" />
                View only
              </a>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onToggleUnscheduled}
              className="no-print flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-gray-700 transition hover:bg-gray-50"
            >
              <Inbox className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Unscheduled</span>
              {unscheduledCount > 0 && (
                <span className="rounded bg-etilog px-1.5 py-px text-[11px] font-bold tabular-nums text-white">
                  {unscheduledCount}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onToggleHistory}
              className="no-print flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-gray-700 transition hover:bg-gray-50"
            >
              <History className="h-3.5 w-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">History</span>
            </button>

            <button
              type="button"
              onClick={() => window.print()}
              className="no-print flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-gray-700 transition hover:bg-gray-50"
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
              className="flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-[13px] font-medium text-gray-700 transition hover:bg-gray-50"
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

          {/* What you are looking at, and the thing the arrows either side of it
              change - so it carries the same blue as the CW blocks and the THIS
              WEEK badge in the grid rather than sitting in the toolbar as grey
              text you have to hunt for. */}
          <p
            className="order-last flex w-full items-baseline justify-center gap-2 rounded-full border
                       border-blue-200 bg-blue-50 px-4 py-1.5 sm:order-none sm:w-auto"
          >
            <span className="text-[14px] font-bold tracking-wide text-blue-900">
              {spanWeeks === 1
                ? `CW ${first.calendarWeek}`
                : `CW ${first.calendarWeek}–${last.calendarWeek}`}
            </span>
            <span className="text-[13px] text-blue-700">
              {spanWeeks === 1
                ? first.rangeLabel
                : `${format(first.start, 'd MMM')} – ${format(last.end, 'd MMM yyyy')}`}
            </span>
          </p>

          <div className="no-print flex items-center gap-0.5 rounded-md border border-gray-300 bg-white p-0.5">
            {WEEK_SPANS.map((span) => (
              <button
                key={span}
                type="button"
                aria-pressed={span === spanWeeks}
                onClick={() => onSpanChange(span)}
                className={clsx(
                  'rounded px-2.5 py-1 text-[13px] font-medium transition',
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
