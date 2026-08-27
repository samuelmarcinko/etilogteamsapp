import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core';
import { addWeeks, format, parseISO } from 'date-fns';
import { toast } from 'sonner';

import { api, SlotOccupiedError } from './lib/api';
import {
  buildWeeks,
  groupEntries,
  indexCalendarExceptions,
  indexDayFlags,
  indexShiftNotes,
  rangeForWeeks,
  weekStart
} from './lib/weeks';

import AppHeader from './components/AppHeader';
import PlanLegend from './components/PlanLegend';
import WeekBlock from './components/WeekBlock';
import ProductionCard from './components/ProductionCard';
import EntryDetailDialog from './components/EntryDetailDialog';
import EntryFormDialog from './components/EntryFormDialog';
import OccupiedSlotDialog from './components/OccupiedSlotDialog';
import BulkDialog from './components/BulkDialog';
import SplitDialog from './components/SplitDialog';
import UnscheduledDrawer from './components/UnscheduledDrawer';
import ActivityDrawer from './components/ActivityDrawer';
import { collisionDetection, parseSlotId } from './components/dnd';
import { EmptyRangeNote, ErrorState, NoAccess, WeekSkeleton } from './components/states';

/**
 * The planner.
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

const BULK_PAST_TENSE = {
  moveDay: 'moved',
  copyDay: 'copied',
  copyWeek: 'copied',
  swapDays: 'swapped',
  shiftRange: 'shifted'
};

const cardLabel = (entry) =>
  entry?.fg_number || entry?.custom_product_name || `#${entry?.id}`;

function slotLabel(target, shifts) {
  if (!target?.productionDate) return 'Unscheduled';
  const shift = shifts.find((s) => s.id === target.shiftId);
  return `${format(parseISO(target.productionDate), 'EEE d MMM')}${shift ? ` ${shift.name}` : ''}`;
}

export default function App() {
  const initial = useMemo(readHash, []);
  const queryClient = useQueryClient();

  const [locationCode, setLocationCode] = useState(initial.location);
  const [spanWeeks, setSpanWeeks] = useState(initial.span);
  const [anchor, setAnchor] = useState(
    Number.isNaN(initial.anchor.getTime()) ? new Date() : initial.anchor
  );

  const [openEntry, setOpenEntry] = useState(null);      // detail dialog
  const [formState, setFormState] = useState(null);      // { entry } or { slot }
  const [dragging, setDragging] = useState(null);        // entry under the pointer
  const [conflict, setConflict] = useState(null);        // occupied-slot decision
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [restoringId, setRestoringId] = useState(null);
  const [bulk, setBulk] = useState(null);          // { kind, sourceDate }
  const [splitting, setSplitting] = useState(null); // card being split

  const profile = useQuery({ queryKey: ['me'], queryFn: api.me, staleTime: 5 * 60 * 1000 });
  const canView = profile.data?.permissions?.includes('production.view');
  const canManage = profile.data?.permissions?.includes('production.manage');

  const locations = useQuery({
    queryKey: ['production', 'locations'],
    queryFn: api.locations,
    enabled: Boolean(canView),
    staleTime: 10 * 60 * 1000
  });

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
    placeholderData: (previous) => previous
  });

  const unscheduled = useQuery({
    queryKey: ['production', 'unscheduled', locationCode],
    queryFn: () => api.unscheduled(locationCode),
    enabled: Boolean(canView && locationCode)
  });

  // Paged with a keyset cursor rather than loaded whole: the log only grows,
  // and nobody needs three years of it to see what changed this morning.
  const activity = useInfiniteQuery({
    queryKey: ['production', 'activity', locationCode],
    queryFn: ({ pageParam }) => api.activity({ location: locationCode, before: pageParam }),
    initialPageParam: null,
    getNextPageParam: (lastPage) =>
      lastPage.data.length < 50 ? undefined : lastPage.data[lastPage.data.length - 1].id,
    // Only fetched while the panel is open; there is no reason to poll a log
    // nobody is looking at.
    enabled: Boolean(canView && locationCode && historyOpen)
  });

  /** Everything a write may have changed. */
  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['production', 'plan'] });
    queryClient.invalidateQueries({ queryKey: ['production', 'unscheduled'] });
    queryClient.invalidateQueries({ queryKey: ['production', 'activity'] });
  }, [queryClient]);

  // ------------------------------------------------------------------ undo
  // Every write returns a snapshot of what it touched. Undo replays that
  // snapshot rather than inverting the operation, so a swap, a replace and a
  // move to the queue all undo the same way.
  const undoRef = useRef(null);

  const offerUndo = useCallback((message, undo) => {
    undoRef.current = undo;
    toast.success(message, {
      action: {
        label: 'Undo',
        onClick: async () => {
          const snapshot = undoRef.current;
          if (!snapshot) return;
          try {
            await api.undo(snapshot);
            refresh();
            toast.success('Reverted');
          } catch (error) {
            toast.error(`Could not undo: ${error.message}`);
          }
        }
      }
    });
  }, [refresh]);

  // -------------------------------------------------------------- mutations
  const moveMutation = useMutation({
    mutationFn: ({ id, target, mode }) => api.moveEntry(id, { ...target, mode }),
    onSuccess: (result, variables) => {
      refresh();
      offerUndo(
        `${cardLabel(variables.entry)} moved to ${slotLabel(variables.target, shifts)}`,
        result.undo
      );
    },
    onError: (error, variables) => {
      if (error instanceof SlotOccupiedError) {
        setConflict({ ...variables, occupants: error.occupants });
        return;
      }
      toast.error(error.message);
      refresh();
    }
  });

  const saveMutation = useMutation({
    mutationFn: ({ entry, payload }) =>
      entry
        ? api.updateEntry(entry.id, { ...payload, version: entry.version })
        : api.createEntry(payload),
    onSuccess: (result, variables) => {
      setFormState(null);
      refresh();
      if (variables.entry) {
        toast.success('Card saved');
      } else {
        offerUndo('Production added', result.undo);
      }
    },
    onError: (error) => toast.error(error.message)
  });

  const deleteMutation = useMutation({
    mutationFn: (entry) => api.deleteEntry(entry.id),
    onSuccess: (result, entry) => {
      setFormState(null);
      refresh();
      offerUndo(`${cardLabel(entry)} removed`, result.undo);
    },
    onError: (error) => toast.error(error.message)
  });

  // One mutation for every bulk operation: they differ only in which endpoint
  // they call, and all of them come back with the same undo snapshot.
  const bulkMutation = useMutation({
    mutationFn: ({ kind, sourceDate, target, rangeTo, days, mode }) => {
      const location = locationCode;
      switch (kind) {
        case 'moveDay':
          return api.moveDay({ location, fromDate: sourceDate, toDate: target, mode });
        case 'copyDay':
          return api.copyDays({ location, fromDate: sourceDate, toDate: target, dayCount: 1, mode });
        case 'copyWeek':
          return api.copyDays({ location, fromDate: sourceDate, toDate: target, dayCount: 7, mode });
        case 'swapDays':
          return api.swapDays({ location, dateA: sourceDate, dateB: target });
        case 'shiftRange':
          return api.shiftRange({ location, fromDate: sourceDate, toDate: rangeTo, days });
        default:
          throw new Error(`Unknown bulk operation: ${kind}`);
      }
    },
    onSuccess: (result, variables) => {
      setBulk(null);
      refresh();
      const counts = result.data || {};
      const n = counts.moved ?? counts.copied ?? counts.swapped ?? counts.shifted ?? 0;
      offerUndo(`${n} card${n === 1 ? '' : 's'} ${BULK_PAST_TENSE[variables.kind]}`, result.undo);
    },
    onError: (error) => toast.error(error.message)
  });

  const splitMutation = useMutation({
    mutationFn: ({ entry, payload }) => api.splitEntry(entry.id, payload),
    onSuccess: (result, variables) => {
      setSplitting(null);
      refresh();
      offerUndo(`${cardLabel(variables.entry)} split`, result.undo);
    },
    onError: (error) => toast.error(error.message)
  });

  const dayFlagMutation = useMutation({
    mutationFn: ({ date, flag }) => api.setDayFlag({ location: locationCode, date, flag }),
    onSuccess: () => refresh(),
    onError: (error) => toast.error(error.message)
  });

  const shiftNoteMutation = useMutation({
    mutationFn: ({ date, shiftId, note }) =>
      api.setShiftNote({ location: locationCode, date, shiftId, note }),
    onSuccess: () => refresh(),
    // The cell keeps whatever was typed on failure - losing a note to a dropped
    // connection would be worse than showing it as unsaved.
    onError: (error) => toast.error(error.message)
  });

  // ------------------------------------------------------------------- drag
  /**
   * Dragging a card off the right-hand edge opens the Unscheduled queue.
   *
   * Otherwise taking something out of the plan means dropping the card,
   * opening the drawer from the toolbar, and picking the card up again - three
   * steps for one intention. Hold near the edge for a moment and the drawer
   * comes to meet the card, which is the same gesture as dragging a file onto
   * a folder that is not open yet.
   */
  useEffect(() => {
    if (!dragging || !canManage || drawerOpen) return;

    const EDGE_PX = 72;
    const DWELL_MS = 200; // long enough that crossing the edge by accident does nothing
    let timer = null;

    const cancel = () => {
      if (timer) clearTimeout(timer);
      timer = null;
    };

    const onMove = (event) => {
      const atEdge = event.clientX > window.innerWidth - EDGE_PX;
      if (atEdge && !timer) {
        timer = setTimeout(() => {
          setHistoryOpen(false);
          setDrawerOpen(true);
        }, DWELL_MS);
      } else if (!atEdge) {
        cancel();
      }
    };

    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancel();
    };
  }, [dragging, canManage, drawerOpen]);

  const sensors = useSensors(
    // A small distance threshold so a click still opens the card rather than
    // starting a drag the moment the pointer twitches.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  const handleDragEnd = ({ active, over }) => {
    setDragging(null);
    if (!over || !canManage) return;

    const entry = active.data.current?.entry;
    const target = parseSlotId(over.id);
    if (!entry || !target) return;

    const sameSlot =
      String(entry.production_date || '').slice(0, 10) === String(target.productionDate || '') &&
      (entry.shift_id || null) === (target.shiftId || null);
    if (sameSlot) return;

    moveMutation.mutate({ id: entry.id, entry, target });
  };

  const entriesByDay = useMemo(() => groupEntries(plan.data?.entries || []), [plan.data]);
  const dayFlags = useMemo(() => indexDayFlags(plan.data?.dayFlags || []), [plan.data]);
  const shiftNotes = useMemo(() => indexShiftNotes(plan.data?.shiftNotes || []), [plan.data]);
  const exceptions = useMemo(
    () => indexCalendarExceptions(plan.data?.calendarExceptions || []),
    [plan.data]
  );
  const shifts = plan.data?.shifts || [];

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
  const locationId = plan.data?.location?.id;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={({ active }) => setDragging(active.data.current?.entry || null)}
      onDragCancel={() => setDragging(null)}
      onDragEnd={handleDragEnd}
      autoScroll={{ threshold: { x: 0, y: 0.2 } }}
      // Targets are measured continuously rather than once at drag start,
      // because the Unscheduled panel slides in mid-drag: measured once, its
      // rectangle would still be the off-screen one it had while closed, and
      // the card would drop straight through it into Sunday.
      measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
    >
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
            unscheduledCount={unscheduled.data?.length || 0}
            onToggleUnscheduled={() => {
              setHistoryOpen(false);
              setDrawerOpen((v) => !v);
            }}
            onToggleHistory={() => {
              setDrawerOpen(false);
              setHistoryOpen((v) => !v);
            }}
          />
        )}

        <main className="mx-auto max-w-[1600px] px-4 py-4">
          {plan.isError ? (
            <ErrorState error={plan.error} onRetry={() => plan.refetch()} />
          ) : plan.isPending || locations.isPending ? (
            <WeekSkeleton weeks={Math.min(spanWeeks, 4)} />
          ) : (
            <div className="flex flex-col gap-4">
              {/* The calendar always renders, however far ahead you look - an
                  unplanned week is exactly what you need to see in order to plan
                  it. A note sits above the grid rather than replacing it. */}
              {!hasEntries && (
                <EmptyRangeNote locationName={activeLocation?.name || 'this location'} />
              )}

              {shifts.length > 0 && <PlanLegend shifts={shifts} canManage={canManage} />}

              {weeks.map((week) => (
                <WeekBlock
                  key={week.key}
                  week={week}
                  shifts={shifts}
                  entriesByDay={entriesByDay}
                  dayFlags={dayFlags}
                  shiftNotes={shiftNotes}
                  exceptions={exceptions}
                  onOpenEntry={setOpenEntry}
                  onAddEntry={(slot) => setFormState({ slot })}
                  onSetDayFlag={(day, flag) => dayFlagMutation.mutate({ date: day.iso, flag })}
                  onSetShiftNote={(date, shiftId, note) =>
                    shiftNoteMutation.mutate({ date, shiftId, note })}
                  onBulk={(kind, day) => setBulk({ kind, sourceDate: day.iso })}
                  canManage={canManage}
                  compact={spanWeeks === 8}
                />
              ))}
            </div>
          )}
        </main>

        <ActivityDrawer
          open={historyOpen}
          onClose={() => setHistoryOpen(false)}
          activity={activity.data?.pages.flatMap((page) => page.data)}
          restoreWindowDays={activity.data?.pages[0]?.restoreWindowDays}
          isLoading={activity.isPending}
          hasMore={activity.hasNextPage}
          isLoadingMore={activity.isFetchingNextPage}
          onLoadMore={() => activity.fetchNextPage()}
          canManage={canManage}
          restoringId={restoringId}
          onRestore={async (item) => {
            setRestoringId(item.id);
            try {
              await api.restoreFromHistory(item.id);
              refresh();
              toast.success('Restored from history');
            } catch (error) {
              toast.error(error.message);
            } finally {
              setRestoringId(null);
            }
          }}
        />

        <UnscheduledDrawer
          open={drawerOpen}
          onClose={() => setDrawerOpen(false)}
          entries={unscheduled.data || []}
          canManage={canManage}
          onOpenEntry={setOpenEntry}
          onAdd={() => setFormState({ slot: null })}
        />

        {/* Where to go to get the card out of the plan. Shown only while a drag
            is in flight and the queue is closed, so it teaches the gesture
            without occupying the screen the rest of the time. */}
        {dragging && canManage && !drawerOpen && (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed inset-y-24 right-0 z-30 flex w-14 items-center justify-center
                       rounded-l-lg border border-r-0 border-dashed border-gray-300 bg-white/85 backdrop-blur-[2px]"
          >
            <span className="rotate-90 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider text-gray-400">
              Unscheduled
            </span>
          </div>
        )}

        {/* The card that follows the pointer. Rendering it here rather than
            moving the original keeps the grid from reflowing mid-drag. */}
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
          {dragging && (
            <div className="w-52 rotate-1 cursor-grabbing opacity-95 shadow-cardHover">
              <ProductionCard entry={dragging} />
            </div>
          )}
        </DragOverlay>

        <EntryDetailDialog
          entry={openEntry}
          open={Boolean(openEntry)}
          onOpenChange={(open) => !open && setOpenEntry(null)}
          canManage={canManage}
          onEdit={(entry) => {
            setOpenEntry(null);
            setFormState({ entry });
          }}
          onSplit={(entry) => {
            setOpenEntry(null);
            setSplitting(entry);
          }}
        />

        <EntryFormDialog
          open={Boolean(formState)}
          onOpenChange={(open) => !open && setFormState(null)}
          entry={formState?.entry || null}
          slot={formState?.slot || null}
          shifts={shifts}
          saving={saveMutation.isPending}
          onDelete={(entry) => deleteMutation.mutate(entry)}
          onSubmit={(payload) =>
            saveMutation.mutate({
              entry: formState?.entry || null,
              payload: {
                ...payload,
                locationId,
                productionDate: formState?.entry
                  ? String(formState.entry.production_date || '').slice(0, 10) || null
                  : formState?.slot?.date || null
              }
            })
          }
        />

        <BulkDialog
          open={Boolean(bulk)}
          onOpenChange={(open) => !open && setBulk(null)}
          kind={bulk?.kind}
          sourceDate={bulk?.sourceDate}
          busy={bulkMutation.isPending}
          onSubmit={(payload) => bulkMutation.mutate(payload)}
        />

        <SplitDialog
          open={Boolean(splitting)}
          onOpenChange={(open) => !open && setSplitting(null)}
          entry={splitting}
          shifts={shifts}
          busy={splitMutation.isPending}
          onSubmit={(payload) => splitMutation.mutate({ entry: splitting, payload })}
        />

        <OccupiedSlotDialog
          open={Boolean(conflict)}
          onOpenChange={(open) => !open && setConflict(null)}
          moving={cardLabel(conflict?.entry)}
          occupants={conflict?.occupants}
          targetLabel={slotLabel(conflict?.target, shifts)}
          onConfirm={(mode) => {
            const pending = conflict;
            setConflict(null);
            moveMutation.mutate({ ...pending, mode });
          }}
        />
      </div>
    </DndContext>
  );
}
