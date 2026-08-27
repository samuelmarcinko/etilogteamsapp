import { AlertTriangle, CalendarOff, Check } from 'lucide-react';
import { shiftAccent } from '../lib/shifts';
import { CARD_COLORS } from '../lib/colors';

/**
 * What the marks in the grid mean.
 *
 * The plan is read by people who did not build it - a shift supervisor looking
 * at a printout, someone covering for the planner - and a colour stripe or a
 * red badge means nothing on first sight. One quiet line, printed with the
 * plan, spares them from having to ask.
 */

// The card's colour means one of two things, and the legend says which.
const MARKS = [
  { key: 'normal', label: 'Normal', bar: 'bg-blue-400' },
  { key: 'urgent', label: 'Urgent', bar: 'bg-priority-urgent' }
];

function Divider() {
  return <span aria-hidden="true" className="h-3 w-px bg-gray-200" />;
}

export default function PlanLegend({ shifts, canManage }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 px-1 text-[12px] text-gray-600">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">Legend</span>

      {shifts.map((shift, index) => {
        const accent = shiftAccent(index);
        const Icon = accent.icon;
        return (
          <span key={shift.id} className="flex items-center gap-1">
            <Icon className={`h-3.5 w-3.5 ${accent.text}`} aria-hidden="true" />
            {shift.name}
          </span>
        );
      })}

      <Divider />

      {MARKS.map((mark) => (
        <span key={mark.key} className="flex items-center gap-1">
          <span aria-hidden="true" className={`h-3 w-1 rounded-sm ${mark.bar}`} />
          {mark.label}
        </span>
      ))}

      {/* The palette itself, so the colours on the cards are not a private
          code: same colour, related work. */}
      <span className="flex items-center gap-1">
        <span className="flex items-center gap-0.5" aria-hidden="true">
          {CARD_COLORS.map((colour) => (
            <span key={colour.key} className={`h-3 w-1 rounded-sm ${colour.bar}`} />
          ))}
        </span>
        own colours group related work
      </span>

      <Divider />

      <span className="flex items-center gap-1">
        <span
          aria-hidden="true"
          className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500 py-px pl-0.5 pr-1.5 text-[10px] font-bold uppercase tracking-wide text-white"
        >
          <Check className="h-3 w-3" strokeWidth={3} />
          Done
        </span>
        finished, struck through
      </span>

      <span className="flex items-center gap-1">
        <span className="inline-flex items-center gap-0.5 rounded bg-etilog px-1 py-px text-[10px] font-bold uppercase tracking-wide text-white">
          <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
          Important !
        </span>
        day to watch
      </span>

      <span className="flex items-center gap-1">
        <CalendarOff className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
        Free day
      </span>

      {canManage && (
        <>
          <Divider />
          <span className="no-print">Click an empty cell to add · hover a cell for its shift note</span>
        </>
      )}
    </div>
  );
}
