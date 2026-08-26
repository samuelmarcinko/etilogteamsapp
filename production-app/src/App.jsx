import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { addWeeks } from 'date-fns';

import { api } from './lib/api';
import {
  buildWeeks,
  groupEntries,
  indexCalendarExceptions,
  indexDayFlags,
  rangeForWeeks,
  weekStart
} from './lib/weeks';

import AppHeader from './components/AppHeader';
import WeekBlock from './components/WeekBlock';
import EntryDetailDialog from './components/EntryDetailDialog';
import { EmptyWeeks, ErrorState, NoAccess, WeekSkeleton } from './components/states';

/**
 * Read-only planner. Drag & drop, editing and draft/publish come next; the
 * layout and data model are meant to be reviewed before any of that is wired.
 *
 * The visible location and week span live in the URL hash, so a particular week
 * can be linked to or reloaded without losing your place.
 */

function readHash() {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const span = Number(params.get('span'));
  return {
    location: params.get('location') || null,
    span: [1, 4, 8].includes(span) ? span : 4,
    anchor: params.get('week') ? new Date(params.get('week')) : new Date()
  };
}

function writeHash({ location, span, anchor }) {
  const params = new URLSearchParams();
  if (location) params.set('location', location);
  params.set('span', String(span));
  params.set('week', weekStart(anchor).toISOString().slice(0, 10));
  window.history.replaceState(null, '', `#${params.toString()}`);
}

export default function App() {
  const initial = useMemo(readHash, []);
  const [locationCode, setLocationCode] = useState(initial.location);
  const [spanWeeks, setSpanWeeks] = useState(initial.span);
  const [anchor, setAnchor] = useState(
    Number.isNaN(initial.anchor.getTime()) ? new Date() : initial.anchor
  );
  const [openEntry, setOpenEntry] = useState(null);

  const profile = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 5 * 60 * 1000 });

  const canView = profile.data?.permissions?.includes('production.view');
  const canManage = profile.data?.permissions?.includes('production.manage');

  const locations = useQuery({
    queryKey: ['production', 'locations'],
    queryFn: api.locations,
    enabled: Boolean(canView),
    staleTime: 10 * 60 * 1000
  });

  // Land on the first location until one is chosen.
  useEffect(() => {
    if (!locationCode && locations.data?.length) setLocationCode(locations.data[0].code);
  }, [locationCode, locations.data]);

  const weeks = useMemo(() => buildWeeks(anchor, spanWeeks), [anchor, spanWeeks]);
  const range = useMemo(() => rangeForWeeks(weeks), [weeks]);

  useEffect(() => {
    if (locationCode) writeHash({ location: locationCode, span: spanWeeks, anchor });
  }, [locationCode, spanWeeks, anchor]);

  const plan = useQuery({
    queryKey: ['production', 'plan', locationCode, range.from, range.to],
    queryFn: () => api.plan({ location: locationCode, from: range.from, to: range.to }),
    enabled: Boolean(canView && locationCode),
    placeholderData: (previous) => previous // keep the grid up while paging weeks
  });

  const entriesByDay = useMemo(() => groupEntries(plan.data?.entries || []), [plan.data]);
  const dayFlags = useMemo(() => indexDayFlags(plan.data?.dayFlags || []), [plan.data]);
  const exceptions = useMemo(
    () => indexCalendarExceptions(plan.data?.calendarExceptions || []),
    [plan.data]
  );

  if (profile.isLoading) {
    return (
      <div className="mx-auto max-w-[1600px] px-4 py-6">
        <WeekSkeleton weeks={2} />
      </div>
    );
  }

  if (profile.isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
      </div>
    );
  }

  if (!canView) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16">
        <NoAccess />
      </div>
    );
  }

  const activeLocation = locations.data?.find((l) => l.code === locationCode);
  const hasEntries = (plan.data?.entries || []).length > 0;
  const shifts = plan.data?.shifts || [];

  return (
    <div className="min-h-screen">
      {locations.data?.length > 0 && (
        <AppHeader
          locations={locations.data}
          activeCode={locationCode}
          onSelectLocation={setLocationCode}
          weeks={weeks}
          spanWeeks={spanWeeks}
          onSpanChange={setSpanWeeks}
          onPrev={() => setAnchor((a) => addWeeks(a, -spanWeeks))}
          onNext={() => setAnchor((a) => addWeeks(a, spanWeeks))}
          onToday={() => setAnchor(new Date())}
          readOnly={!canManage}
        />
      )}

      <main className="mx-auto max-w-[1600px] px-4 py-4">
        {plan.isError ? (
          <ErrorState error={plan.error} onRetry={() => plan.refetch()} />
        ) : plan.isPending || locations.isPending ? (
          <WeekSkeleton weeks={Math.min(spanWeeks, 4)} />
        ) : !hasEntries ? (
          <EmptyWeeks locationName={activeLocation?.name || 'this location'} />
        ) : (
          <div className="flex flex-col gap-4">
            {weeks.map((week) => (
              <WeekBlock
                key={week.key}
                week={week}
                shifts={shifts}
                entriesByDay={entriesByDay}
                dayFlags={dayFlags}
                exceptions={exceptions}
                onOpenEntry={setOpenEntry}
                compact={spanWeeks === 8}
              />
            ))}
          </div>
        )}
      </main>

      <EntryDetailDialog
        entry={openEntry}
        open={Boolean(openEntry)}
        onOpenChange={(open) => !open && setOpenEntry(null)}
      />
    </div>
  );
}
