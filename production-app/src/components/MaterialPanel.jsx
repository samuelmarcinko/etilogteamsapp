import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Check, ChevronDown, ChevronRight, CircleHelp, Clock, CloudOff,
  CornerDownRight, Loader2, RefreshCw, Wifi
} from 'lucide-react';
import clsx from 'clsx';

import { api } from '../lib/api';

/**
 * What SAP says about the materials for the batch being planned.
 *
 * This panel never blocks anything. The boss plans what he decides to plan -
 * he can put 200 pieces on Tuesday with nothing at all in stock, and this only
 * tells him what he will have to chase. There is no state of this panel in
 * which Save is disabled, and there is deliberately no code here that could
 * introduce one.
 *
 * Four states, not three. "SAP has nothing about the construction" is an
 * absence of information, not a shortage: the customer may be supplying the
 * box, or the job is a repair. It reads grey and asks for a look, because
 * colouring it red would bury the real shortages among things that are fine.
 */

const STATE_STYLE = {
  ok: {
    chip: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
    dot: 'bg-emerald-500',
    Icon: Check,
    label: 'In stock'
  },
  coming: {
    chip: 'bg-amber-50 text-amber-800 ring-amber-200',
    dot: 'bg-amber-500',
    Icon: Clock,
    label: 'On the way'
  },
  short: {
    chip: 'bg-red-50 text-etilog ring-red-200',
    dot: 'bg-etilog',
    Icon: AlertTriangle,
    label: 'Missing'
  },
  unknown: {
    chip: 'bg-gray-100 text-gray-600 ring-gray-300',
    dot: 'bg-gray-400',
    Icon: CircleHelp,
    label: 'Check by hand'
  },
  // No quantity typed yet. Deliberately not green: with nothing to compare
  // against, every component would read "in stock, nothing needed", which looks
  // like an all-clear for a batch nobody has sized.
  pending: {
    chip: 'bg-gray-100 text-gray-500 ring-gray-300',
    dot: 'bg-gray-300',
    Icon: CircleHelp,
    label: 'Not checked'
  }
};

const number = (value) => Number(value || 0).toLocaleString('sk-SK');

/**
 * The sentence under a component.
 *
 * Written out rather than reduced to a number because the whole point is that
 * the planner can act on it: "nobody has started making it" and "122 on order
 * from the supplier" call for two completely different phone calls.
 */
function explain(component, pending) {
  const { state, needed, inStock, orderedFromVendors, openOrderQty, procurement } = component;
  const made = procurement === 'bom_Make';

  // Still worth saying what is on the shelf - it just is not a verdict yet.
  if (pending) {
    return made
      ? `${number(inStock)} in stock. Enter a quantity to check it.`
      : `${number(inStock)} in stock, ${number(orderedFromVendors)} on order. Enter a quantity to check it.`;
  }

  if (state === 'unknown') return 'SAP has no item master for this code.';
  if (needed <= 0) return 'Nothing needed for this batch.';
  if (state === 'ok') return `${number(inStock)} in stock, ${number(needed)} needed.`;

  if (made) {
    if (openOrderQty > 0) {
      return state === 'coming'
        ? `${number(inStock)} in stock and ${number(openOrderQty)} already on a production order — enough for ${number(needed)}.`
        : `${number(inStock)} in stock plus ${number(openOrderQty)} being made is ${number(inStock + openOrderQty)}, and ${number(needed)} are needed.`;
    }
    return `${number(inStock)} in stock and nobody has started making it. ${number(needed)} needed.`;
  }

  if (orderedFromVendors > 0) {
    return state === 'coming'
      ? `${number(inStock)} in stock and ${number(orderedFromVendors)} on order from the supplier — enough for ${number(needed)}.`
      : `${number(inStock)} in stock plus ${number(orderedFromVendors)} on order is ${number(inStock + orderedFromVendors)}, and ${number(needed)} are needed.`;
  }
  return `${number(inStock)} in stock and nothing on order. ${number(needed)} needed.`;
}

function StateChip({ state }) {
  const style = STATE_STYLE[state] || STATE_STYLE.unknown;
  const { Icon } = style;
  return (
    <span className={clsx(
      'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1',
      style.chip
    )}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {style.label}
    </span>
  );
}

/**
 * One component.
 *
 * A level-2 row is indented under the group it belongs to: the group says "a
 * construction is supposed to be made here", the box inside it says "and this
 * is what we actually have on the shelf". Both matter and they are not the
 * same statement.
 */
function ComponentRow({ component, pending }) {
  const nested = component.level > 1;

  return (
    <li className={clsx('py-2', nested && 'pl-4')}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            {nested && <CornerDownRight className="h-3 w-3 shrink-0 text-gray-300" aria-hidden="true" />}
            <span className="truncate text-[13px] font-semibold text-gray-900">{component.itemName}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 pl-[18px] text-[11px] text-gray-400">
            <span className="font-mono">{component.itemCode}</span>
            <span>·</span>
            <span>{component.perPiece} per piece</span>
            {component.kindSource === 'manual' && (
              <>
                <span>·</span>
                <span className="font-medium text-gray-500">marked by hand</span>
              </>
            )}
            {/* A part keeps the name it was given when it was created, so one
                shared between two projects carries the OTHER project's number.
                Saying where else it is used turns a row that looks like a
                mistake into a fact about the part. */}
            {component.sharedWith?.length > 0 && (
              <>
                <span>·</span>
                <span
                  className="font-medium text-gray-500"
                  title={component.sharedWith.join(', ')}
                >
                  also used in {component.sharedWith.slice(0, 2).join(', ')}
                  {component.sharedWith.length > 2 && ` +${component.sharedWith.length - 2}`}
                </span>
              </>
            )}
          </div>
        </div>
        <StateChip state={pending ? 'pending' : component.state} />
      </div>
      <p className={clsx('mt-1 text-[12px] leading-snug text-gray-600', nested ? 'pl-[22px]' : 'pl-[18px]')}>
        {explain(component, pending)}
      </p>
    </li>
  );
}

/** A section with its own heading, or the grey box explaining why it is empty. */
function Section({ title, components, emptyTitle, emptyBody, pending }) {
  if (!components.length) {
    return (
      <section>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{title}</h4>
        <div className="mt-1.5 rounded-md border border-gray-200 bg-gray-50 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-gray-700">
            <CircleHelp className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
            {emptyTitle}
          </p>
          <p className="mt-1 text-[12px] leading-snug text-gray-500">{emptyBody}</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{title}</h4>
      <ul className="divide-y divide-gray-100">
        {components.map((component) => (
          <ComponentRow key={component.itemCode} component={component} pending={pending} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Everything under this FG that the rules did not treat as a construction or a
 * bag, with the reason.
 *
 * This is what makes a grey answer useful instead of a dead end. FG100782's
 * frame is cut from ALU profiles rather than bought as a piece, so the rules
 * would not call it a construction - but the profiles are right here, and one
 * click settles them for every project they appear in.
 */
function OtherFindings({ items, onMark, marking }) {
  const [open, setOpen] = useState(false);
  if (!items.length) return null;

  return (
    <section className="rounded-md border border-gray-200">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[12px] font-semibold text-gray-600 transition hover:bg-gray-50"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          : <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />}
        What else is under this FG ({items.length})
      </button>

      {open && (
        <ul className="divide-y divide-gray-100 border-t border-gray-200">
          {items.map((item) => (
            <li key={item.itemCode} className="px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-gray-800">{item.itemName}</p>
                  <p className="mt-0.5 text-[11px] text-gray-400">
                    <span className="font-mono">{item.itemCode}</span>
                    {item.groupName ? ` · ${item.groupName}` : ''}
                    {item.price != null ? ` · ${item.price.toFixed(2)} €` : ''}
                    {item.kindReason ? ` · ${item.kindReason}` : ' · not classified'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    disabled={marking}
                    onClick={() => onMark(item.itemCode, 'konstrukcia')}
                    className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 transition hover:border-etilog hover:text-etilog disabled:opacity-50"
                  >
                    Construction
                  </button>
                  <button
                    type="button"
                    disabled={marking}
                    onClick={() => onMark(item.itemCode, 'taska')}
                    className="rounded border border-gray-300 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 transition hover:border-etilog hover:text-etilog disabled:opacity-50"
                  >
                    Bag
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The banner saying which data is on screen.
 *
 * Never left to guess. Either SAP answered just now, or it did not and this is
 * the saved copy - and in the second case the reason is spelled out, because
 * "the numbers are from twenty past four" is something a planner can weigh,
 * while a silently stale figure is not.
 */
function LiveBanner({ busy, live, syncedAt, onRefresh }) {
  const when = syncedAt
    ? new Date(syncedAt).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' })
    : null;

  if (busy) {
    return (
      <div className="flex items-center gap-2 rounded-md bg-gray-100 px-2.5 py-1.5 text-[12px] text-gray-600">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden="true" />
        Reading this project live from SAP…
      </div>
    );
  }

  const failed = live && live.ok === false;

  return (
    <div className={clsx(
      'flex items-start gap-2 rounded-md px-2.5 py-1.5 text-[12px]',
      failed ? 'bg-amber-50 text-amber-900' : 'bg-emerald-50 text-emerald-800'
    )}>
      {failed
        ? <CloudOff className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        : <Wifi className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <span className="min-w-0 flex-1">
        {failed ? (
          <>
            <span className="font-semibold">SAP did not answer — showing saved data{when ? ` from ${when}` : ''}.</span>
            {live.reason && <span className="block opacity-80">{live.reason}</span>}
          </>
        ) : (
          <span className="font-semibold">
            Live from SAP{live?.ms ? ` · read in ${(live.ms / 1000).toFixed(1)} s` : ''}
          </span>
        )}
      </span>
      <button
        type="button"
        onClick={onRefresh}
        className="shrink-0 rounded p-0.5 opacity-70 transition hover:bg-white/60 hover:opacity-100"
        title="Read from SAP again"
        aria-label="Read from SAP again"
      >
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  );
}

export default function MaterialPanel({ sapOrderEntry, sapItemCode, quantity, projectType }) {
  const queryClient = useQueryClient();
  const qty = Number(quantity) || 0;

  // Addressed by order when there is one, by the FG number when there is not.
  const key = sapOrderEntry ? { order: sapOrderEntry } : { item: sapItemCode };
  const target = sapOrderEntry || sapItemCode;

  // What the live read did, or null before it has been tried.
  const [live, setLive] = useState(null);
  const [reading, setReading] = useState(false);

  /**
   * Re-read this project from SAP, then let the ordinary query pick the fresh
   * rows up out of the mirror.
   *
   * Deliberately not tied to the quantity: changing the batch size changes only
   * what is compared, never what SAP holds, so typing in the quantity box must
   * not send a request per keystroke down the tunnel.
   */
  const readLive = useCallback(async () => {
    if (!target) return;
    setReading(true);
    try {
      const data = await api.sapAvailability(key, 0, { live: true });
      setLive(data.live || { ok: false, reason: 'SAP was not asked' });
      queryClient.invalidateQueries({ queryKey: ['sap', 'availability', target] });
    } catch (error) {
      // The mirror is still there; this only decides what the banner says.
      setLive({ ok: false, reason: error.message });
    } finally {
      setReading(false);
    }
  }, [target, sapOrderEntry, sapItemCode, queryClient]);

  // Once per project, as it is chosen.
  useEffect(() => {
    if (!target) return undefined;
    let cancelled = false;
    setLive(null);
    (async () => { if (!cancelled) await readLive(); })();
    return () => { cancelled = true; };
  }, [target, readLive]);

  const availability = useQuery({
    queryKey: ['sap', 'availability', target, qty],
    queryFn: () => api.sapAvailability(key, qty),
    enabled: Boolean(target),
    staleTime: 30 * 1000
  });

  const mark = useMutation({
    mutationFn: ({ itemCode, kind }) => api.setSapKind(itemCode, kind),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sap', 'availability'] })
  });

  if (!target) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center">
        <p className="text-[13px] leading-relaxed text-gray-400">
          Pick an FG project from SAP and its constructions and bags appear here.
        </p>
      </div>
    );
  }

  if (availability.isLoading || (reading && !availability.data)) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
        <Loader2 className="h-4 w-4 animate-spin text-gray-400" aria-hidden="true" />
        <p className="text-[13px] text-gray-500">Reading this project live from SAP…</p>
        <p className="text-[11px] text-gray-400">
          A project being loaded for the first time has its whole bill of materials read,
          which can take half a minute. After that it is quick.
        </p>
      </div>
    );
  }

  if (availability.isError) {
    // Two different situations, and the planner needs to tell them apart: SAP
    // has never heard of this number, or SAP could not be reached just now.
    const unknown = availability.error?.status === 404;
    return (
      <div className="px-4 py-4">
        <p className="text-[13px] font-semibold text-gray-700">
          {unknown ? 'Nothing in SAP for this number' : 'The material check is unavailable'}
        </p>
        <p className="mt-1 text-[12px] leading-snug text-gray-500">
          {availability.error?.message}
        </p>
        <p className="mt-2 text-[12px] leading-snug text-gray-500">
          {unknown
            ? 'It may be an old number from the Excel sheets, or one SAP has never had a bill of materials for. The card saves as normal — it just gets no material check.'
            : 'Planning is unaffected — you can save this card as normal, and the check returns once SAP can be read again.'}
        </p>
        {!unknown && (
          <button
            type="button"
            onClick={readLive}
            className="mt-2 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[12px] font-semibold text-gray-700 transition hover:border-etilog hover:text-etilog"
          >
            Try again
          </button>
        )}
      </div>
    );
  }

  const data = availability.data;
  const isTxt = (projectType || data.order.projectType) === 'TXT';

  return (
    <div className="flex h-full flex-col gap-3.5 px-4 py-4">
      <header>
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[13px] font-bold text-gray-900">Materials in SAP</h3>
          <span className="text-[11px] text-gray-400">
            {qty > 0 ? `for ${number(qty)} pcs` : 'enter a quantity'}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-gray-400">
          {data.hasOpenOrder ? (
            <>
              Order {data.order.absoluteEntry} · {number(data.order.remainingQty)} of{' '}
              {number(data.order.plannedQty)} still to make.
            </>
          ) : (
            <>
              No open order in SAP for this project — loaded on request, so there is no
              order quantity to compare against.
            </>
          )}
          {' '}This is a guide, not a limit — you can plan whatever you decide to plan.
        </p>
      </header>

      <LiveBanner busy={reading} live={live} syncedAt={data.syncedAt} onRefresh={readLive} />

      <div className="flex flex-1 flex-col gap-3.5 overflow-y-auto">
        <Section
          pending={qty <= 0}
          title="Constructions"
          components={data.constructions}
          emptyTitle={isTxt ? 'A TXT project has no construction' : 'SAP has nothing about a construction here'}
          emptyBody={isTxt
            ? 'Bags sewn into a container the customer already owns, so there is nothing to check.'
            : 'That is often correct — the customer supplies the box, or this is a repair. Open “What else is under this FG” below to see what the BOM does contain, and mark it if the construction is in there.'}
        />

        <Section
          pending={qty <= 0}
          title="Bags"
          components={data.bags}
          emptyTitle="No sewn parts found"
          emptyBody="Nothing under this FG carries the sewing operation. If a bag belongs here, it will be in the list below."
        />

        <OtherFindings
          items={data.other}
          marking={mark.isPending}
          onMark={(itemCode, kind) => mark.mutate({ itemCode, kind })}
        />
      </div>

      <footer className="border-t border-gray-100 pt-2 text-[11px] text-gray-400">
        {/* The background copy's age, which is what a failed live read falls
            back on. Shown even when the live read worked, so the difference
            between the two is visible rather than implied. */}
        {data.syncedAt
          ? `Background copy last filled at ${new Date(data.syncedAt).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' })}`
          : 'The background copy has not been filled yet'}
      </footer>
    </div>
  );
}
