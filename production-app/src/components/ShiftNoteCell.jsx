import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Pencil } from 'lucide-react';

/**
 * The note under one shift on one day - edited where it is read.
 *
 * The Excel sheet had a notes row and people wrote in it directly, so having to
 * open a card to leave a remark was a step backwards. Click the cell and type.
 * Morning and afternoon keep separate notes, because they are often running
 * different orders and a shared line would merge two unrelated remarks.
 *
 * Notes written on individual cards still show underneath, greyed and read-only,
 * so everything said about that shift is in one place.
 */
export default function ShiftNoteCell({
  note,
  cardNotes = [],
  canManage,
  weekend,
  onSave,
  label
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const textareaRef = useRef(null);

  const text = note?.note || '';

  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const start = () => {
    if (!canManage) return;
    setDraft(text);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (draft.trim() === text.trim()) return;
    onSave(draft);
  };

  const cancel = () => setEditing(false);

  if (editing) {
    return (
      <div className={clsx('week-cell p-0.5', weekend ? 'bg-gray-50' : 'bg-gray-25')}>
        <textarea
          ref={textareaRef}
          value={draft}
          rows={2}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            // Enter saves, Shift+Enter starts a new line - the same bargain as
            // every chat box, and notes are usually one line.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              commit();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              cancel();
            }
          }}
          placeholder="Note for this shift…"
          className="h-full w-full resize-none rounded border border-etilog bg-white px-1.5 py-1
                     text-[10px] leading-snug text-gray-700 outline-none ring-1 ring-etilog/20"
        />
      </div>
    );
  }

  const empty = !text && cardNotes.length === 0;

  return (
    <div
      className={clsx(
        'week-cell group/note relative min-h-[26px] px-1.5 py-1',
        weekend ? 'bg-gray-50' : 'bg-gray-25',
        canManage && 'cursor-text transition hover:bg-white'
      )}
      onClick={start}
      role={canManage ? 'button' : undefined}
      tabIndex={canManage ? 0 : undefined}
      aria-label={canManage ? `${text ? 'Edit' : 'Add'} note, ${label}` : undefined}
      onKeyDown={(e) => {
        if (!canManage) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          start();
        }
      }}
    >
      {text && (
        <p className="whitespace-pre-line text-[10px] font-medium leading-snug text-gray-700">
          {text}
        </p>
      )}

      {cardNotes.map((entryNote, i) => (
        <p key={i} className="whitespace-pre-line text-[10px] leading-snug text-gray-400">
          {entryNote}
        </p>
      ))}

      {canManage && empty && (
        <span className="no-print flex items-center gap-1 text-[10px] text-gray-300 opacity-0
                         transition group-hover/note:opacity-100">
          <Pencil className="h-2.5 w-2.5" aria-hidden="true" />
          Note
        </span>
      )}

      {canManage && !empty && (
        <Pencil
          className="no-print absolute right-1 top-1 h-2.5 w-2.5 text-gray-300 opacity-0
                     transition group-hover/note:opacity-100"
          aria-hidden="true"
        />
      )}
    </div>
  );
}
