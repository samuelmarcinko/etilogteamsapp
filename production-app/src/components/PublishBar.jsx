import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { CheckCircle2, Send, Upload, X } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { getISOWeek } from 'date-fns';
import clsx from 'clsx';

/**
 * What the shop floor has not been told yet.
 *
 * The planner works on the live plan, as always. The floor reads the last
 * published revision. This is the one place that says the two have drifted
 * apart, and the one button that closes the gap.
 *
 * It appears only when there is something to publish. A bar that is always
 * there is a bar nobody sees, and a plan with nothing outstanding should look
 * finished rather than nag.
 *
 * Publishing is confirmed rather than immediate, because it is the moment the
 * change becomes something other people act on - and because the confirmation
 * is the only place the planner gets to see, in one list, exactly which weeks
 * are about to move under the floor's feet.
 */

const weekLabel = (weekStart) => {
  const monday = parseISO(weekStart);
  return `CW ${getISOWeek(monday)} · ${format(monday, 'd MMM')}`;
};

export default function PublishBar({ pending, onPublish, publishing, lastPublishedAt }) {
  const [confirming, setConfirming] = useState(false);

  const weeks = pending?.weeks || [];
  const changes = pending?.changes || 0;

  if (!weeks.length) {
    // Nothing outstanding. Said quietly, and only once something has ever been
    // published - before that it would be claiming a fact it does not have.
    if (!lastPublishedAt) return null;
    return (
      <div className="no-print flex items-center gap-1.5 px-1 text-[12px] text-gray-500">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
        Published — the floor is seeing this plan.
      </div>
    );
  }

  return (
    <>
      <div
        className="no-print flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-300
                   bg-amber-50 px-4 py-2.5"
      >
        <Upload className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />

        <p className="text-[14px] text-amber-900">
          <span className="font-bold">
            {changes} unpublished {changes === 1 ? 'change' : 'changes'}
          </span>
          {' · '}
          <span className="text-amber-800">
            {weeks.map((week) => weekLabel(week.weekStart)).join(' · ')}
          </span>
        </p>

        <p className="w-full text-[12px] text-amber-800 sm:w-auto sm:flex-1">
          The production view still shows the last published plan.
        </p>

        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="ml-auto flex shrink-0 items-center gap-1.5 rounded-md bg-amber-600 px-3.5 py-1.5
                     text-[14px] font-semibold text-white shadow-sm transition hover:bg-amber-700"
        >
          <Send className="h-3.5 w-3.5" aria-hidden="true" />
          Publish changes
        </button>
      </div>

      <Dialog.Root open={confirming} onOpenChange={setConfirming}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-[2px]" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 w-[min(30rem,calc(100vw-2rem))] -translate-x-1/2
                       -translate-y-1/2 rounded-lg border border-gray-200 bg-white shadow-lg focus:outline-none"
          >
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-3.5">
              <div>
                <Dialog.Title className="text-[16px] font-bold text-gray-900">
                  Publish to the production view
                </Dialog.Title>
                <Dialog.Description className="mt-0.5 text-[13px] text-gray-500">
                  These weeks become what the shop floor reads.
                </Dialog.Description>
              </div>
              <Dialog.Close
                className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>

            <ul className="flex flex-col divide-y divide-gray-100 px-5 py-2">
              {weeks.map((week) => (
                <li key={week.weekStart} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="text-[14px] font-semibold text-gray-900">
                    {weekLabel(week.weekStart)}
                  </span>
                  <span className="text-[13px] tabular-nums text-gray-500">
                    {week.changes} {week.changes === 1 ? 'change' : 'changes'}
                    {week.revision
                      ? ` · was Rev ${week.revision}`
                      : ' · never published'}
                  </span>
                </li>
              ))}
            </ul>

            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <Dialog.Close
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[14px] font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Cancel
              </Dialog.Close>
              <button
                type="button"
                disabled={publishing}
                onClick={() => onPublish(weeks.map((week) => week.weekStart))}
                className={clsx(
                  'flex items-center gap-1.5 rounded-md bg-amber-600 px-3.5 py-1.5 text-[14px]',
                  'font-semibold text-white transition hover:bg-amber-700 disabled:opacity-60'
                )}
              >
                <Send className="h-3.5 w-3.5" aria-hidden="true" />
                {publishing ? 'Publishing…' : `Publish ${changes} ${changes === 1 ? 'change' : 'changes'}`}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
