/**
 * The colour a planner can put on a card.
 *
 * Ten fixed choices rather than a colour wheel: they have to stay apart from
 * each other at a glance across a whole week, keep dark text readable on their
 * tint, and mean the same thing on every screen. Free-form hex gives you none
 * of that - and lets someone pick a shade that swallows its own card.
 *
 * Red is deliberately absent. Red is urgent, and a "related work" colour that
 * looked urgent would cost the one signal that has to be unmistakable.
 *
 * Written as whole class names because Tailwind reads the source: a class
 * assembled at runtime (`bg-${key}-50`) is never compiled into the stylesheet.
 */
export const CARD_COLORS = [
  { key: 'sky',     label: 'Sky',     bar: 'bg-sky-500',     bg: 'bg-sky-50',     border: 'border-sky-200' },
  { key: 'cyan',    label: 'Cyan',    bar: 'bg-cyan-500',    bg: 'bg-cyan-50',    border: 'border-cyan-200' },
  { key: 'teal',    label: 'Teal',    bar: 'bg-teal-500',    bg: 'bg-teal-50',    border: 'border-teal-200' },
  { key: 'emerald', label: 'Green',   bar: 'bg-emerald-500', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  { key: 'lime',    label: 'Lime',    bar: 'bg-lime-500',    bg: 'bg-lime-50',    border: 'border-lime-200' },
  { key: 'amber',   label: 'Amber',   bar: 'bg-amber-500',   bg: 'bg-amber-50',   border: 'border-amber-200' },
  { key: 'orange',  label: 'Orange',  bar: 'bg-orange-500',  bg: 'bg-orange-50',  border: 'border-orange-200' },
  { key: 'pink',    label: 'Pink',    bar: 'bg-pink-500',    bg: 'bg-pink-50',    border: 'border-pink-200' },
  { key: 'violet',  label: 'Violet',  bar: 'bg-violet-500',  bg: 'bg-violet-50',  border: 'border-violet-200' },
  { key: 'slate',   label: 'Slate',   bar: 'bg-slate-500',   bg: 'bg-slate-50',   border: 'border-slate-200' }
];

export const COLOR_KEYS = CARD_COLORS.map((colour) => colour.key);

/** No colour chosen: the neutral card the plan is mostly made of. */
export const DEFAULT_COLOR = {
  key: null, label: 'None', bar: 'bg-blue-400', bg: 'bg-white', border: 'border-gray-200'
};

/** Urgent overrides any colour - it is the one thing that must not be missed. */
export const URGENT_COLOR = {
  key: 'urgent', label: 'Urgent', bar: 'bg-priority-urgent', bg: 'bg-red-50', border: 'border-red-200'
};

export function cardColor(entry) {
  if ((entry?.priority || 'normal') === 'urgent') return URGENT_COLOR;
  return CARD_COLORS.find((colour) => colour.key === entry?.color) || DEFAULT_COLOR;
}
