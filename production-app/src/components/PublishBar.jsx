import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, CheckCircle2, Send, Trash2, Upload, X } from 'lucide-react';
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

/**
 * What discarding one week would do, in the words a planner would use.
 *
 * Deliberately says "delete" rather than anything softer. This is the only
 * control in the module that destroys work, and a dialog that reads gently is
 * a dialog people click through.
 */
function DiscardWeek({ week }) {
  const parts = [
    week.willDelete && `${week.willDelete} card${week.willDelete === 1 ? '' : 's'} deleted`,
    week.willRestore && `${week.willRestore} put back`,
    week.willRevert && `${week.willRevert} reverted`,
    week.dayMarksChange && 'day marks',
    week.shiftNotesChange && 'shift notes'
  ].filter(Boolean);

  const neverPublished = !week.revision;

  return (
    <li className="flex flex-col gap-0.5 py-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[14px] font-semibold text-gray-900">{weekLabel(week.weekStart)}</span>
        {neverPublished ? (
          <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-etilog">
            never published
          </span>
        ) : (
          <span className="shrink-0 text-[12px] tabular-nums text-gray-500">back to Rev {week.revision}</span>
        )}
      </div>

      <p className="text-[13px] text-gray-600">
        {/* A week that was never published has nothing to go back to, so
            "discard" there means "delete the lot". Said in those words, because
            it is the one case where the button does not mean rollback. */}
        {neverPublished
          ? `Everything in this week is deleted — ${week.willDelete} card${week.willDelete === 1 ? '' : 's'}.`
          : parts.join(' · ')}
      </p>

      {week.touchedBy.length > 0 && (
        <p className="text-[12px] text-gray-500">
          Changed by {week.touchedBy.join(', ')}
        </p>
      )}
    </li>
  );
}

export default function PublishBar({
  pending, onPublish, publishing, lastPublishedAt,
  discardPreview, onDiscard, discarding, onOpenDiscard
}) {
  const [confirming, setConfirming] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);

  const weeks = pending?.weeks || [];
  const changes = pending?.changes || 0;

  if (!weeks.length) {
    // Nothing outstanding. Said quietly, and only once something has ever been
    // published - before that it would be claiming a fact it does not have.
    if (!lastPublishedAt) return null;
    return (
      <div className="no-print flex items-center gap-1.5 px-1 text-[12px] text-gray-500">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
        Published — everyone sees the current plan.
      </div>
    );
  }

  return (
    <>
      {/* Loud on purpose. This is the one thing on the screen that says the
          floor is looking at something older than what is in front of you, and
          it should be impossible to miss - it was quietened once and the
          planner could no longer see it. What must not interrupt is a dialog;
          a banner that sits there and waits is not an interruption. */}
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

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* Outlined rather than filled. It sits beside the button people
              actually mean to press, and two solid blocks of colour side by
              side is how the wrong one gets hit. */}
          <button
            type="button"
            onClick={() => { onOpenDiscard?.(); setDiscardOpen(true); }}
            className="flex items-center gap-1.5 rounded-md border border-etilog bg-white px-3 py-1.5
                       text-[14px] font-semibold text-etilog transition hover:bg-red-50"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            Discard changes
          </button>

          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="flex items-center gap-1.5 rounded-md bg-amber-600 px-3.5 py-1.5
                       text-[14px] font-semibold text-white shadow-sm transition hover:bg-amber-700"
          >
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            Publish changes
          </button>
        </div>
      </div>

      <Dialog.Root open={discardOpen} onOpenChange={setDiscardOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-gray-900/40 backdrop-blur-[2px]" />
          <Dialog.Content
            className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-[min(32rem,calc(100vw-2rem))] -translate-x-1/2
                       -translate-y-1/2 flex-col rounded-lg border border-gray-200 bg-white shadow-lg focus:outline-none"
          >
            <div className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-3.5">
              <div className="flex gap-2.5">
                <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-etilog" aria-hidden="true" />
                <div>
                  <Dialog.Title className="text-[16px] font-bold text-gray-900">
                    Discard everything unpublished?
                  </Dialog.Title>
                  <Dialog.Description className="mt-0.5 text-[13px] text-gray-500">
                    These weeks go back to the plan as it was last published. This
                    includes changes made by other people.
                  </Dialog.Description>
                </div>
              </div>
              <Dialog.Close
                className="rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Dialog.Close>
            </div>

            <ul className="flex flex-col divide-y divide-gray-100 overflow-y-auto px-5 py-1">
              {discardPreview === null ? (
                <li className="py-3 text-[13px] text-gray-400">Working out what would be lost…</li>
              ) : discardPreview.length === 0 ? (
                <li className="py-3 text-[13px] text-gray-500">Nothing to discard.</li>
              ) : (
                discardPreview.map((week) => <DiscardWeek key={week.weekStart} week={week} />)
              )}
            </ul>

            <div className="flex items-center justify-end gap-2 border-t border-gray-200 px-5 py-3">
              <p className="mr-auto text-[12px] text-gray-500">You can undo this straight after.</p>
              <Dialog.Close className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-[14px] font-medium text-gray-700 transition hover:bg-gray-50">
                Keep them
              </Dialog.Close>
              <button
                type="button"
                disabled={discarding || !discardPreview?.length}
                onClick={() => {
                  onDiscard(discardPreview.map((week) => week.weekStart));
                  setDiscardOpen(false);
                }}
                className={clsx(
                  'flex items-center gap-1.5 rounded-md bg-etilog px-3.5 py-1.5 text-[14px]',
                  'font-semibold text-white transition hover:bg-etilog-hover disabled:opacity-60'
                )}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                {discarding ? 'Discarding…' : 'Discard changes'}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

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
                  These weeks become what everyone sees in the production view.
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
