import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Pencil } from 'lucide-react';

/**
 * The note belonging to one shift on one day - written inside the cell it
 * describes.
 *
 * It used to live in a Notes row of its own under each shift. That row also
 * had to carry the notes written on individual cards, which meant prefixing
 * each with its FG number to say which card it belonged to - three cards on a
 * day produced three prefixed lines in a cell nowhere near them. Card notes now
 * sit on their own cards, and what is left here is the one thing that has no
 * card: a remark about the shift itself. "Line down for service at 8:00" is
 * true of the morning, not of any job in it - and has to be writable on a day
 * with nothing planned at all.
 *
 * A cell is exactly one day and one shift, so this is where that note belongs.
 */
export default function ShiftNote({ note, canManage, onSave, label }) {
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

  const start = (event) => {
    if (!canManage) return;
    // The empty slot behind this is one big "add production" button.
    event?.stopPropagation();
    setDraft(text);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (draft.trim() === text.trim()) return;
    onSave(draft);
  };

  if (editing) {
    return (
      <textarea
        ref={textareaRef}
        value={draft}
        rows={2}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // Enter saves, Shift+Enter starts a new line - the same bargain as
          // every chat box, and notes are usually one line.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            commit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setEditing(false);
          }
        }}
        placeholder="Note for this shift…"
        className="relative z-10 mt-auto w-full resize-none rounded border border-etilog bg-white px-1.5 py-1
                   text-[11px] leading-snug text-gray-900 outline-none ring-1 ring-etilog/20"
      />
    );
  }

  if (!text) {
    if (!canManage) return null;
    return (
      <button
        type="button"
        onClick={start}
        aria-label={`Add note, ${label}`}
        className="no-print relative z-10 mt-auto flex items-center gap-1 self-start rounded px-1 py-0.5
                   text-[11px] text-gray-400 opacity-0 transition hover:bg-gray-100 hover:text-gray-700
                   focus-visible:opacity-100 group-hover/slot:opacity-100"
      >
        <Pencil className="h-2.5 w-2.5" aria-hidden="true" />
        Note
      </button>
    );
  }

  return (
    <div
      onClick={start}
      role={canManage ? 'button' : undefined}
      tabIndex={canManage ? 0 : undefined}
      aria-label={canManage ? `Edit note, ${label}` : undefined}
      onKeyDown={(e) => {
        if (!canManage) return;
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          start(e);
        }
      }}
      className={clsx(
        'relative z-10 mt-auto rounded border border-dashed border-gray-300 bg-gray-50 px-1.5 py-1',
        'text-[11px] font-medium leading-snug text-gray-700',
        canManage && 'cursor-text transition hover:border-gray-400 hover:bg-white'
      )}
    >
      <span className="whitespace-pre-line">{text}</span>
    </div>
  );
}
