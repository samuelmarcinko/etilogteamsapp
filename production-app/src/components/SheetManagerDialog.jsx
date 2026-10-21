import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  AlertTriangle, ArrowDown, ArrowUp, Check, Eye, EyeOff, Loader2, Pencil, Plus, Trash2, X
} from 'lucide-react';
import { api } from '../lib/api';

/**
 * The sheets across the top of the plan, and what each one is.
 *
 * A sheet is one shift or two. That is the whole setting, and it is the one
 * thing on this screen that changes what the calendar looks like: two shifts
 * gives each day a morning row and an afternoon row, one shift gives it a
 * single field. Everything else here - the name, the order, external or not -
 * only changes the tab.
 *
 * Deleting is real deleting. There is no archive and no undo, so the button
 * leads to a confirmation that says what is on the sheet and asks for its name
 * to be typed back. All of that is checked again on the server: a dialog is a
 * courtesy, not a safeguard.
 */

const SINGLE = 'single';
const DOUBLE = 'double';

const SHIFT_LABEL = {
  [SINGLE]: 'One shift',
  [DOUBLE]: 'Two shifts'
};

/** The two-way switch that is the point of this screen. */
function ShiftModeToggle({ value, disabled, onChange }) {
  return (
    <div
      role="radiogroup"
      aria-label="Shifts"
      className="flex shrink-0 items-center gap-0.5 rounded-md border border-gray-300 bg-white p-0.5"
    >
      {[SINGLE, DOUBLE].map((mode) => (
        <button
          key={mode}
          type="button"
          role="radio"
          aria-checked={value === mode}
          disabled={disabled}
          onClick={() => value !== mode && onChange(mode)}
          className={clsx(
            'rounded px-2 py-1 text-[12px] font-medium transition disabled:opacity-50',
            value === mode
              ? 'bg-gray-900 text-white'
              : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
          )}
        >
          {SHIFT_LABEL[mode]}
        </button>
      ))}
    </div>
  );
}

/**
 * The confirmation in front of a delete.
 *
 * It names what is on the sheet rather than asking "are you sure?". A sheet
 * with nothing on it says so, and then this is a formality; a sheet with 2 840
 * cards and nineteen published revisions says that instead, which is the only
 * version of the question worth asking.
 */
function DeleteSheet({ sheet, onCancel, onDeleted }) {
  const [typed, setTyped] = useState('');
  const [error, setError] = useState(null);

  const contents = useQuery({
    queryKey: ['production', 'sheet-contents', sheet.code],
    queryFn: () => api.sheetContents(sheet.code)
  });

  const remove = useMutation({
    mutationFn: () => api.deleteSheet({ code: sheet.code, confirm: sheet.name }),
    onSuccess: onDeleted,
    onError: (err) => setError(err.message)
  });

  const counts = contents.data;
  const lines = counts && [
    [counts.entries, 'planned card'],
    [counts.unscheduled, 'card in the Unscheduled queue'],
    [counts.notes, 'shift note'],
    [counts.day_flags, 'marked day'],
    [counts.revisions, 'published revision']
  ].filter(([n]) => n > 0)
    .map(([n, noun]) => `${n} ${noun}${n === 1 ? '' : 's'}`);

  return (
    <div className="rounded-md border border-red-200 bg-red-50 p-3">
      <div className="flex gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-etilog" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-gray-900">Delete “{sheet.name}” for good?</p>

          {contents.isPending ? (
            <p className="mt-1 text-[12px] text-gray-500">Checking what is on it…</p>
          ) : counts?.isEmpty ? (
            <p className="mt-1 text-[12px] text-gray-600">
              This sheet is empty. Nothing will be lost besides the sheet itself.
            </p>
          ) : (
            <p className="mt-1 text-[12px] text-gray-700">
              This also deletes <strong>{lines?.join(', ')}</strong>. It cannot be undone.
            </p>
          )}

          <label className="mt-2.5 block text-[12px] text-gray-600">
            Type <strong className="font-semibold text-gray-900">{sheet.name}</strong> to confirm
            <input
              autoFocus
              value={typed}
              onChange={(event) => { setTyped(event.target.value); setError(null); }}
              className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-[13px]
                         focus:border-etilog focus:outline-none focus:ring-1 focus:ring-etilog"
            />
          </label>

          {error && <p className="mt-1.5 text-[12px] font-medium text-etilog">{error}</p>}

          <div className="mt-2.5 flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[13px] font-medium text-gray-700 transition hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={typed !== sheet.name || remove.isPending}
              onClick={() => remove.mutate()}
              className="rounded-md bg-etilog px-2.5 py-1 text-[13px] font-medium text-white transition
                         hover:bg-etilog-hover disabled:opacity-40"
            >
              {remove.isPending ? 'Deleting…' : 'Delete sheet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** One row of the list: the sheet, its switch, and what can be done to it. */
function SheetRow({ sheet, first, last, busy, onPatch, onMove, onShiftMode, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sheet.name);

  useEffect(() => { setName(sheet.name); }, [sheet.name]);

  const save = () => {
    const trimmed = name.trim();
    setEditing(false);
    if (trimmed && trimmed !== sheet.name) onPatch({ name: trimmed });
    else setName(sheet.name);
  };

  return (
    <li className={clsx('flex items-center gap-2 px-3 py-2', !sheet.is_active && 'bg-gray-50')}>
      <div className="flex shrink-0 flex-col">
        <button
          type="button"
          disabled={first || busy}
          onClick={() => onMove('up')}
          aria-label={`Move ${sheet.name} earlier`}
          className="rounded p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-25"
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          disabled={last || busy}
          onClick={() => onMove('down')}
          aria-label={`Move ${sheet.name} later`}
          className="rounded p-0.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-25"
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-w-0 flex-1">
        {editing ? (
          <input
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={save}
            onKeyDown={(event) => {
              if (event.key === 'Enter') save();
              if (event.key === 'Escape') { setName(sheet.name); setEditing(false); }
            }}
            className="w-full rounded border border-gray-300 px-1.5 py-0.5 text-[14px] font-medium
                       focus:border-etilog focus:outline-none focus:ring-1 focus:ring-etilog"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="group flex max-w-full items-center gap-1.5 text-left"
          >
            <span className="truncate text-[14px] font-medium text-gray-900">{sheet.name}</span>
            <Pencil className="h-3 w-3 shrink-0 text-gray-300 transition group-hover:text-gray-500" aria-hidden="true" />
          </button>
        )}

        <p className="flex items-center gap-1.5 text-[11px] text-gray-400">
          <span className="font-mono uppercase">{sheet.code}</span>
          {!sheet.is_internal && <span className="rounded bg-gray-100 px-1 font-medium text-gray-500">external</span>}
          {!sheet.is_active && <span className="rounded bg-gray-200 px-1 font-medium text-gray-600">hidden</span>}
        </p>
      </div>

      <ShiftModeToggle
        value={sheet.shift_mode}
        disabled={busy}
        onChange={(mode) => onShiftMode(mode)}
      />

      <button
        type="button"
        disabled={busy}
        onClick={() => onPatch({ isActive: !sheet.is_active })}
        aria-label={sheet.is_active ? `Hide ${sheet.name} from the tabs` : `Show ${sheet.name} in the tabs`}
        title={sheet.is_active ? 'Hide from the tabs' : 'Show in the tabs'}
        className="shrink-0 rounded p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40"
      >
        {sheet.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={onDelete}
        aria-label={`Delete ${sheet.name}`}
        className="shrink-0 rounded p-1.5 text-gray-400 transition hover:bg-red-50 hover:text-etilog disabled:opacity-40"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </li>
  );
}

/** The form for a new sheet. Closed until asked for, so the list stays the list. */
function NewSheet({ onCreate, busy, error, onDismissError }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [codeTouched, setCodeTouched] = useState(false);
  const [shiftMode, setShiftMode] = useState(DOUBLE);
  const [isInternal, setIsInternal] = useState(true);

  // The code is derived from the name until someone types one themselves -
  // it never changes afterwards and ends up in URLs, so it is offered rather
  // than demanded, and left alone once it has been edited.
  const suggested = name.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
  const effectiveCode = codeTouched ? code : suggested;

  const reset = () => {
    setOpen(false); setName(''); setCode(''); setCodeTouched(false);
    setShiftMode(DOUBLE); setIsInternal(true); onDismissError();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-gray-300
                   px-3 py-2 text-[13px] font-medium text-gray-600 transition
                   hover:border-etilog hover:bg-etilog-light hover:text-etilog"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        New sheet
      </button>
    );
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onCreate({ code: effectiveCode, name: name.trim(), isInternal, shiftMode }, reset);
      }}
      className="rounded-md border border-gray-300 bg-gray-50 p-3"
    >
      <div className="flex gap-2">
        <label className="min-w-0 flex-1 text-[12px] font-medium text-gray-600">
          Name
          <input
            autoFocus
            value={name}
            onChange={(event) => { setName(event.target.value); onDismissError(); }}
            placeholder="Assembly PO3"
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 text-[13px] font-normal text-gray-900
                       focus:border-etilog focus:outline-none focus:ring-1 focus:ring-etilog"
          />
        </label>

        <label className="w-40 shrink-0 text-[12px] font-medium text-gray-600">
          Code
          <input
            value={effectiveCode}
            onChange={(event) => {
              setCodeTouched(true);
              setCode(event.target.value.toUpperCase());
              onDismissError();
            }}
            placeholder="ASSEMBLY_PO3"
            className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1.5 font-mono text-[13px] font-normal text-gray-900
                       focus:border-etilog focus:outline-none focus:ring-1 focus:ring-etilog"
          />
        </label>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <ShiftModeToggle value={shiftMode} onChange={setShiftMode} />
          <label className="flex items-center gap-1.5 text-[12px] text-gray-600">
            <input
              type="checkbox"
              checked={!isInternal}
              onChange={(event) => setIsInternal(!event.target.checked)}
              className="h-3.5 w-3.5 rounded border-gray-300 text-etilog focus:ring-etilog"
            />
            External partner
          </label>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={reset}
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1 text-[13px] font-medium text-gray-700 transition hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim() || !effectiveCode || busy}
            className="flex items-center gap-1.5 rounded-md bg-etilog px-2.5 py-1 text-[13px] font-medium text-white
                       transition hover:bg-etilog-hover disabled:opacity-40"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            Create
          </button>
        </div>
      </div>

      {error && <p className="mt-2 text-[12px] font-medium text-etilog">{error}</p>}
    </form>
  );
}

export default function SheetManagerDialog({ open, onOpenChange, onSheetsChanged }) {
  const queryClient = useQueryClient();
  const [deleting, setDeleting] = useState(null);
  const [createError, setCreateError] = useState(null);
  const [notice, setNotice] = useState(null);

  const sheets = useQuery({
    queryKey: ['production', 'sheets'],
    queryFn: api.sheets,
    enabled: open
  });

  // Anything here can change the tabs, the active sheet's shifts, or the plan
  // itself, so the whole production cache is dropped rather than guessing
  // which parts survived.
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['production'] });
    onSheetsChanged?.();
  };

  const patch = useMutation({
    mutationFn: api.updateSheet,
    onSuccess: refresh
  });

  const move = useMutation({
    mutationFn: api.moveSheet,
    onSuccess: refresh
  });

  const shiftMode = useMutation({
    mutationFn: api.setSheetShiftMode,
    onSuccess: async (result, variables) => {
      await refresh();
      // Moving cards between shifts is the one thing here that rearranges
      // somebody's plan, so it is reported rather than done quietly.
      if (result.movedEntries > 0) {
        setNotice(
          `${result.movedEntries} card${result.movedEntries === 1 ? '' : 's'} moved onto the one shift` +
          (result.mergedNotes > 0 ? `, ${result.mergedNotes} day${result.mergedNotes === 1 ? '' : 's'} of notes joined` : '')
        );
      } else if (variables.shiftMode === DOUBLE && result.changed) {
        setNotice('Afternoon added. Existing cards stayed on the morning.');
      } else {
        setNotice(null);
      }
    }
  });

  const create = useMutation({
    mutationFn: ({ sheet }) => api.createSheet(sheet),
    onSuccess: async (_data, variables) => { variables.onDone(); await refresh(); },
    onError: (error) => setCreateError(error.message)
  });

  const rows = sheets.data || [];
  const busy = patch.isPending || move.isPending || shiftMode.isPending;

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[60] bg-gray-900/40 backdrop-blur-[2px]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] flex max-h-[85vh] w-[min(44rem,calc(100vw-2rem))]
                                   -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border border-gray-200
                                   bg-white shadow-lg focus:outline-none">
          <header className="flex items-start justify-between gap-3 border-b border-gray-200 px-5 py-3.5">
            <div>
              <Dialog.Title className="text-[15px] font-bold text-gray-900">Sheets</Dialog.Title>
              <Dialog.Description className="mt-0.5 text-[12px] leading-snug text-gray-500">
                One sheet per production line. A two-shift sheet gives each day a morning
                and an afternoon; a one-shift sheet gives it a single field.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="-mr-1 shrink-0 rounded p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Dialog.Close>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {sheets.isPending ? (
              <p className="px-5 py-8 text-center text-[13px] text-gray-400">Loading…</p>
            ) : sheets.isError ? (
              <p className="px-5 py-8 text-center text-[13px] text-etilog">{sheets.error.message}</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {rows.map((sheet, index) => (
                  <div key={sheet.code}>
                    <SheetRow
                      sheet={sheet}
                      first={index === 0}
                      last={index === rows.length - 1}
                      busy={busy}
                      onPatch={(body) => patch.mutate({ code: sheet.code, ...body })}
                      onMove={(direction) => move.mutate({ code: sheet.code, direction })}
                      onShiftMode={(mode) => shiftMode.mutate({ code: sheet.code, shiftMode: mode })}
                      onDelete={() => setDeleting(sheet.code)}
                    />
                    {deleting === sheet.code && (
                      <div className="px-3 pb-3">
                        <DeleteSheet
                          sheet={sheet}
                          onCancel={() => setDeleting(null)}
                          onDeleted={async () => { setDeleting(null); setNotice(null); await refresh(); }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </ul>
            )}
          </div>

          <footer className="border-t border-gray-200 px-3 py-3">
            {notice && (
              <p className="mb-2 rounded-md bg-blue-50 px-2.5 py-1.5 text-[12px] text-blue-900">{notice}</p>
            )}
            <NewSheet
              busy={create.isPending}
              error={createError}
              onDismissError={() => setCreateError(null)}
              onCreate={(sheet, onDone) => { setCreateError(null); create.mutate({ sheet, onDone }); }}
            />
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
