import { AlertTriangle, CalendarOff } from 'lucide-react';
import { shiftAccent } from '../lib/shifts';

/**
 * What the marks in the grid mean.
 *
 * The plan is read by people who did not build it - a shift supervisor looking
 * at a printout, someone covering for the planner - and a colour stripe or a
 * red badge means nothing on first sight. One quiet line, printed with the
 * plan, spares them from having to ask.
 */

const PRIORITIES = [
  { key: 'urgent', label: 'Urgent', bar: 'bg-priority-urgent' },
  { key: 'high', label: 'High', bar: 'bg-priority-high' },
  { key: 'blocked', label: 'Blocked', bar: 'bg-priority-blocked' }
];

function Divider() {
  return <span aria-hidden="true" className="h-3 w-px bg-gray-200" />;
}

export default function PlanLegend({ shifts, canManage }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5 px-1 text-[11px] text-gray-500">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Legend</span>

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

      {PRIORITIES.map((priority) => (
        <span key={priority.key} className="flex items-center gap-1">
          <span aria-hidden="true" className={`h-3 w-1 rounded-sm ${priority.bar}`} />
          {priority.label}
        </span>
      ))}

      <Divider />

      <span className="flex items-center gap-1">
        <span className="inline-flex items-center gap-0.5 rounded bg-etilog px-1 py-px text-[9px] font-bold uppercase tracking-wide text-white">
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
          <span className="no-print">Click an empty cell to add · click a Notes cell to write</span>
        </>
      )}
    </div>
  );
}
