import { useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { useQuery } from '@tanstack/react-query';
import { addWeeks } from 'date-fns';
import { RefreshCw } from 'lucide-react';

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
    queryKey: ['production', 'plan', 'published', locationCode, range.from, range.to],
    // published: the last revision of each week, not the live rows a planner
    // may still be moving around. That is the whole point of the viewer.
    queryFn: () => api.plan({ location: locationCode, from: range.from, to: range.to, published: true }),
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

  /**
   * What the last publish brought.
   *
   * This is the reading the floor needs, and it is not the same as "edited
   * recently": a card corrected on Monday and published on Thursday is new to
   * the floor on Thursday, and one edited an hour ago but never published is
   * not news at all. The server compares the two newest revisions, so what is
   * marked here is exactly what changed in the plan people are being shown.
   *
   * The 24-hour rule remains the fallback for a week published for the very
   * first time, where there is no earlier revision to compare against.
   */
  const published = plan.data?.changes;
  const addedIds = useMemo(() => new Set(published?.added || []), [published]);
  const changedIds = useMemo(() => new Set(published?.changed || []), [published]);
  const removed = published?.removed || [];

  const isUpdated = (entry) => {
    if (!entry) return false;
    if (published) return addedIds.has(entry.id) || changedIds.has(entry.id);
    if (!entry.updated_at) return false;
    const at = new Date(entry.updated_at).getTime();
    return Number.isFinite(at) && Date.now() - at < UPDATED_WINDOW_MS;
  };

  const updatedCount = (plan.data?.entries || []).filter(isUpdated).length;

  /**
   * A publish that lands while somebody is watching the screen.
   *
   * The view already refreshes itself every minute, quietly - which is right
   * for a wall display but means a change can appear with nobody noticing it
   * did. The newest publish time is remembered, and when it moves the screen
   * says so until someone acknowledges it.
   */
  const latestPublish = useMemo(() => {
    const times = (plan.data?.revisions || [])
      .map((revision) => revision.publishedAt)
      .filter(Boolean)
      .map((at) => new Date(at).getTime())
      .filter(Number.isFinite);
    return times.length ? Math.max(...times) : null;
  }, [plan.data]);

  const seenPublish = useRef(null);
  const [justPublished, setJustPublished] = useState(null);

  useEffect(() => {
    if (!latestPublish) return;
    // The first load is the baseline, not an announcement.
    if (seenPublish.current === null) {
      seenPublish.current = latestPublish;
      return;
    }
    if (latestPublish > seenPublish.current) {
      seenPublish.current = latestPublish;
      setJustPublished(new Date(latestPublish));
    }
  }, [latestPublish]);

  // A week with no revision has never been published. Rendering it as an empty
  // week would be a lie - there may be a full week of work sitting in the
  // planner - so it says so instead.
  const revisionByWeek = {};
  for (const revision of plan.data?.revisions || []) {
    revisionByWeek[revision.weekStart] = revision;
  }

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
            {/* A publish that landed while this screen was open. Louder than
                the summary below it, because it is news rather than context,
                and it stays until somebody dismisses it. */}
            {justPublished && (
              <div className="flex items-start gap-3 rounded-lg border-2 border-blue-600 bg-blue-600 px-4 py-3 text-white">
                <RefreshCw className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p className="flex-1 text-[14px]">
                  <span className="font-bold">The plan was just updated</span>
                  {' · '}
                  {justPublished.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' })}
                  {'. '}
                  What changed is marked below.
                </p>
                <button
                  type="button"
                  onClick={() => setJustPublished(null)}
                  className="shrink-0 rounded px-2 py-0.5 text-[13px] font-semibold text-white/90 transition hover:bg-white/15 hover:text-white"
                >
                  Got it
                </button>
              </div>
            )}

            {updatedCount > 0 && (
              <p className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2.5 text-[14px] text-blue-900">
                <span className="font-bold">
                  {updatedCount} {updatedCount === 1 ? 'card' : 'cards'} changed
                </span>
                {published
                  ? ' in the latest publish. Tap one to see what changed.'
                  : ' in the last 24 hours. Tap one to see what changed.'}
              </p>
            )}

            {/* Cards that were taken out have nothing left on screen to mark,
                so they are named here or they vanish silently - and a job
                somebody was expecting to make is exactly the kind of change
                that must not vanish silently. */}
            {removed.length > 0 && (
              <p className="rounded-lg border border-gray-300 bg-gray-50 px-4 py-2.5 text-[14px] text-gray-700">
                <span className="font-bold">
                  {removed.length} {removed.length === 1 ? 'card was' : 'cards were'} removed
                </span>
                {': '}
                {removed.slice(0, 6).map((card) => card.label).join(', ')}
                {removed.length > 6 && ` and ${removed.length - 6} more`}
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

                {plan.data?.published && !revisionByWeek[week.key]?.revision ? (
                  <p className="px-4 py-6 text-center text-[14px] text-gray-500">
                    <span className="font-semibold text-gray-700">Not published yet.</span>{' '}
                    This week is still being planned.
                  </p>
                ) : (
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
                )}
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
