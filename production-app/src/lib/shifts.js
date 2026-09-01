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
