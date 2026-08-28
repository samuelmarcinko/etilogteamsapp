import { useEffect, useMemo, useState } from 'react';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { addWeeks } from 'date-fns';

import { api } from './lib/api';
import {
  buildWeeks,
  groupEntries,
  indexCalendarExceptions,
  indexDayFlags,
  indexShiftNotes,
  rangeForWeeks,
  weekStart
} from './lib/weeks';

import ViewerHeader from './components/ViewerHeader';
import ViewerWeek from './components/ViewerWeek';
import ViewerDetail from './components/ViewerDetail';
import { ErrorState, NoAccess, WeekSkeleton } from './components/states';

/**
 * The production view: this week's plan, read-only.
 *
 * A different job from the planner and so a different screen, rather than the
 * planner with its buttons disabled. One week by default, because a shift works
 * to one week, at a size that reads standing up - but four and eight are there
 * too, because "what is coming" is a question the floor asks as well. It
 * refreshes itself, because a plan on a bench tablet that quietly went stale is
 * worse than no plan at all.
 *
 * The location is in the path (/production/view/PO1) rather than a hash, so a
 * tablet can be pinned to one line and a bookmark survives; the span sits in
 * the hash beside it, so a chosen layout survives a reload too.
 */

function readSpan() {
  const span = Number(new URLSearchParams(window.location.hash.replace(/^#/, '')).get('span'));
  return [1, 4, 8].includes(span) ? span : 1;
}

// A card touched within a shift's memory is one the shift needs to look at
// twice. A day is the honest window: anything longer and every card is
// "updated" after a busy afternoon of planning.
const UPDATED_WINDOW_MS = 24 * 60 * 60 * 1000;

// The plan changes when a planner moves something, which they do without
// telling this page. A minute is often enough to be useful and rare enough to
// be invisible.
const REFRESH_MS = 60 * 1000;

export default function Viewer({ initialLocation }) {
  const [locationCode, setLocationCode] = useState(initialLocation);
  const [spanWeeks, setSpanWeeks] = useState(readSpan);
  const [anchor, setAnchor] = useState(() => weekStart(new Date()));
  const [openEntry, setOpenEntry] = useState(null);

  const profile = useQuery({ queryKey: ['production', 'me'], queryFn: api.me });
  const locations = useQuery({
    queryKey: ['production', 'locations'],
    queryFn: api.locations,
    enabled: Boolean(profile.data)
  });

  // No location in the path: show the first one rather than an empty screen.
  useEffect(() => {
    if (!locationCode && locations.data?.length) setLocationCode(locations.data[0].code);
  }, [locationCode, locations.data]);

  // Keep the URL honest when someone switches line or layout, so the tab can be
  // bookmarked or handed to the next shift as it stands.
  useEffect(() => {
    if (!locationCode) return;
    const url = `/production/view/${locationCode}` + (spanWeeks === 1 ? '' : `#span=${spanWeeks}`);
    if (window.location.pathname + window.location.hash !== url) {
      window.history.replaceState(null, '', url);
    }
  }, [locationCode, spanWeeks]);

  const weeks = useMemo(() => buildWeeks(anchor, spanWeeks), [anchor, spanWeeks]);
  const range = useMemo(() => rangeForWeeks(weeks), [weeks]);

  const plan = useQuery({
    queryKey: ['production', 'plan', locationCode, range.from, range.to],
    queryFn: () => api.plan({ location: locationCode, from: range.from, to: range.to }),
    enabled: Boolean(locationCode),
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false
  });

  const shifts = plan.data?.shifts || [];
  const entriesByDay = useMemo(() => groupEntries(plan.data?.entries || []), [plan.data]);
  const dayFlags = useMemo(() => indexDayFlags(plan.data?.dayFlags || []), [plan.data]);
  const shiftNotes = useMemo(() => indexShiftNotes(plan.data?.shiftNotes || []), [plan.data]);
  const exceptions = useMemo(
    () => indexCalendarExceptions(plan.data?.calendarExceptions || []), [plan.data]
  );

  const isUpdated = (entry) => {
    if (!entry?.updated_at) return false;
    const at = new Date(entry.updated_at).getTime();
    return Number.isFinite(at) && Date.now() - at < UPDATED_WINDOW_MS;
  };

  const updatedCount = (plan.data?.entries || []).filter(isUpdated).length;

  // One week is read from a bench; eight is scanned for what is coming. The
  // card has to shrink for the second, or seven columns of it eight times over
  // is not something anyone can take in either.
  const density = spanWeeks === 1 ? 'roomy' : spanWeeks === 8 ? 'compact' : 'normal';

  if (profile.isPending) {
    return <div className="p-5"><WeekSkeleton weeks={1} /></div>;
  }
  if (!profile.data?.permissions?.includes('production.view')) {
    return <div className="p-5"><NoAccess /></div>;
  }

  const canManage = profile.data.permissions.includes('production.manage');

  return (
    <div className="min-h-screen bg-gray-25">
      <ViewerHeader
        locations={locations.data || []}
        activeCode={locationCode}
        onSelectLocation={setLocationCode}
        weeks={weeks}
        spanWeeks={spanWeeks}
        onSpanChange={setSpanWeeks}
        onPrev={() => setAnchor((a) => addWeeks(a, -spanWeeks))}
        onNext={() => setAnchor((a) => addWeeks(a, spanWeeks))}
        onToday={() => setAnchor(weekStart(new Date()))}
        updatedAt={plan.dataUpdatedAt ? new Date(plan.dataUpdatedAt) : null}
        isFetching={plan.isFetching}
        onRefresh={() => plan.refetch()}
        canManage={canManage}
      />

      <main className="px-4 py-4 sm:px-5">
        {plan.isError ? (
          <ErrorState error={plan.error} onRetry={() => plan.refetch()} />
        ) : plan.isPending ? (
          <WeekSkeleton weeks={spanWeeks} />
        ) : (
          <div className="flex flex-col gap-3">
            {/* Said once at the top, so nobody has to scan seven columns to
                find out whether anything moved. */}
            {updatedCount > 0 && (
              <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-[14px] text-blue-900">
                <span className="font-bold">
                  {updatedCount} {updatedCount === 1 ? 'card' : 'cards'} changed
                </span>
                {' '}in the last 24 hours. Tap one to see what changed.
              </p>
            )}

            {weeks.map((week) => {
              const isCurrentWeek = week.days.some((day) => day.isToday);
              return (
              <section
                key={week.key}
                className={clsx(
                  'overflow-clip rounded-lg border border-gray-200 bg-white',
                  // Marked by its header, not its perimeter - see WeekBlock.
                  isCurrentWeek ? 'shadow-weekCurrent' : 'shadow-sm'
                )}
              >
                {/* One week needs no heading - the toolbar above already names
                    it. Several do, or the blocks run together. */}
                {spanWeeks > 1 && (
                  <header className={clsx(
                    'flex items-baseline gap-2.5 border-b px-4 py-2',
                    isCurrentWeek
                      ? 'week-head-now border-blue-700 bg-blue-600'
                      : 'border-gray-200 bg-gray-50'
                  )}>
                    <h2 className={clsx(
                      'text-[15px] font-extrabold uppercase tracking-wider',
                      isCurrentWeek ? 'text-white' : 'text-gray-900'
                    )}>
                      CW {week.calendarWeek}
                    </h2>
                    <span className={clsx('text-[13px]', isCurrentWeek ? 'text-blue-100' : 'text-gray-600')}>
                      {week.rangeLabel}
                    </span>
                    {isCurrentWeek && (
                      <span className="rounded bg-white px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-blue-700">
                        This week
                      </span>
                    )}
                  </header>
                )}

                <ViewerWeek
                  week={week}
                  shifts={shifts}
                  entriesByDay={entriesByDay}
                  dayFlags={dayFlags}
                  shiftNotes={shiftNotes}
                  exceptions={exceptions}
                  isUpdated={isUpdated}
                  onOpenEntry={setOpenEntry}
                  density={density}
                />
              </section>
              );
            })}
          </div>
        )}
      </main>

      <ViewerDetail
        entry={openEntry}
        updated={isUpdated(openEntry)}
        open={Boolean(openEntry)}
        onOpenChange={(open) => !open && setOpenEntry(null)}
        locationCode={locationCode}
        shifts={shifts}
      />
    </div>
  );
}
