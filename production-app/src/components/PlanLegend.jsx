import { shiftAccent } from '../lib/shifts';
import { CARD_COLORS } from '../lib/colors';

/**
 * What the colours in the grid mean.
 *
 * Only the marks that are genuinely a private code: which row is which shift,
 * what a red card means, and that the ten colours are the planner's own
 * grouping. A struck-through card with a green DONE badge, a red IMPORTANT !
 * banner and a green "Free day" already say what they are on the face of them,
 * and a legend that explains the obvious teaches people to stop reading it.
 */

// The card's colour means one of two things, and the legend says which.
const MARKS = [
  { key: 'normal', label: 'Normal', bar: 'bg-blue-400' },
  { key: 'urgent', label: 'Urgent', bar: 'bg-priority-urgent' }
];

function Divider() {
  return <span aria-hidden="true" className="h-3 w-px bg-gray-200" />;
}

export default function PlanLegend({ shifts }) {
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
    </div>
  );
}
