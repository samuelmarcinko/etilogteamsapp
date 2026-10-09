import { Moon, Sun, Sunset } from 'lucide-react';

/**
 * How each shift is marked in the grid.
 *
 * Two rows of white cells one above the other read as one block, and at
 * 8-week density it stops being obvious which row is which shift - so each
 * gets an icon and a colour bar on its label, and the second shift onwards
 * opens with a heavier rule.
 *
 * Keyed by position rather than by name: the shift names come from the
 * database and a location may call them something else.
 */
const ACCENTS = [
  { icon: Sun, bar: 'bg-amber-400', text: 'text-amber-500' },
  { icon: Moon, bar: 'bg-indigo-400', text: 'text-indigo-500' },
  { icon: Sunset, bar: 'bg-slate-400', text: 'text-slate-500' }
];

export function shiftAccent(index) {
  return ACCENTS[index % ACCENTS.length];
}

/**
 * Is this sheet a one-shift operation?
 *
 * A sheet is one shift or two - the admin sets it per sheet - and the shift
 * rows are what say which, so this counts them rather than reading a flag.
 *
 * On a one-shift sheet the day is a single field and nothing on screen names
 * the shift: the label column, the icon and the colour bar all exist to tell
 * two rows apart, and with one row they are decoration that says nothing. The
 * grid drops the label column entirely and the day cells take the width back.
 *
 * Lives here next to the accents so there is one answer to the question, and
 * the four places that draw shifts cannot drift apart over it.
 */
export function isSingleShift(shifts) {
  return (shifts?.length ?? 0) <= 1;
}
