import clsx from 'clsx';
import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { History, RotateCcw, X } from 'lucide-react';

/**
 * The change log (section 5).
 *
 * Every edit, move and deletion is recorded append-only, and anything that
 * recorded a previous state can be put back from here. That matters because the
 * Undo toast lives for a few seconds: without this, a deletion nobody caught in
 * time was gone for good.
 *
 * Readable by anyone who can see the plan; restoring needs edit rights.
 */

const ACTION_STYLE = {
  created: 'bg-emerald-50 text-emerald-700',
  updated: 'bg-blue-50 text-blue-700',
  moved: 'bg-gray-100 text-gray-700',
  deleted: 'bg-red-50 text-etilog',
  restored: 'bg-amber-50 text-amber-800',
  unscheduled: 'bg-gray-100 text-gray-700',
  scheduled: 'bg-gray-100 text-gray-700',
  day_flag_set: 'bg-gray-100 text-gray-700',
  day_flag_cleared: 'bg-gray-100 text-gray-700'
};

function when(value) {
  const date = typeof value === 'string' ? parseISO(value) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return {
    relative: formatDistanceToNow(date, { addSuffix: true }),
    exact: format(date, 'd MMM yyyy HH:mm')
  };
}

export default function ActivityDrawer({ open, onClose, activity, isLoading, canManage, onRestore, restoringId }) {
  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-gray-900/20 md:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        aria-label="Change history"
        aria-hidden={!open}
        className={clsx(
          'no-print fixed right-0 top-0 z-40 flex h-full w-[min(24rem,100vw)] flex-col',
          'border-l border-gray-200 bg-white shadow-lg transition-transform duration-200 ease-portal',
          open ? 'translate-x-0' : 'translate-x-full'
        )}
      >
        <header className="flex items-center justify-between gap-2 border-b border-gray-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-gray-400" aria-hidden="true" />
            <h2 className="text-[13px] font-bold uppercase tracking-wide text-gray-900">History</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close history"
            className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="flex flex-col gap-2 p-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-14 animate-pulse rounded-md bg-gray-100" />
              ))}
            </div>
          ) : !activity?.length ? (
            <p className="px-4 py-8 text-center text-[12px] leading-relaxed text-gray-400">
              Nothing has changed here yet.
            </p>
          ) : (
            <ol className="divide-y divide-gray-100">
              {activity.map((item) => {
                const time = when(item.changed_at);
                // Only a change that recorded a previous state can be replayed,
                // and only while the card still exists to replay it onto.
                const canRestore =
                  canManage && Boolean(item.before_state?.id) && item.entry_exists;
                const isGone = Boolean(item.before_state?.id) && !item.entry_exists;

                return (
                  <li key={item.id} className="flex flex-col gap-1.5 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span
                        className={clsx(
                          'rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                          ACTION_STYLE[item.action] || 'bg-gray-100 text-gray-700'
                        )}
                      >
                        {item.action.replace(/_/g, ' ')}
                      </span>
                      {item.entry_label && (
                        <span className="truncate text-[13px] font-semibold text-gray-900">
                          {item.entry_label}
                        </span>
                      )}
                      {item.entry_deleted && item.action !== 'deleted' && (
                        <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-etilog">
                          deleted
                        </span>
                      )}
                    </div>

                    {item.summary && (
                      <p className="text-[12px] leading-snug text-gray-600">{item.summary}</p>
                    )}

                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] text-gray-400" title={time?.exact}>
                        {time?.relative}
                        {item.changed_by_name ? ` · ${item.changed_by_name}` : ''}
                      </span>

                      {canRestore && (
                        <button
                          type="button"
                          onClick={() => onRestore(item)}
                          disabled={restoringId === item.id}
                          className="flex shrink-0 items-center gap-1 rounded border border-gray-300 px-1.5 py-0.5
                                     text-[11px] font-medium text-gray-600 transition
                                     hover:border-etilog hover:text-etilog disabled:opacity-50"
                        >
                          <RotateCcw className="h-3 w-3" aria-hidden="true" />
                          {restoringId === item.id ? 'Restoring…' : 'Restore'}
                        </button>
                      )}

                      {isGone && (
                        <span className="shrink-0 text-[11px] text-gray-300">permanently removed</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </aside>
    </>
  );
}
