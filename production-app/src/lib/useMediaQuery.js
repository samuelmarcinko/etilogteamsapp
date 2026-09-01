import { useSyncExternalStore } from 'react';

/**
 * Subscribe to a media query.
 *
 * Used to pick between the week grid and the stacked day list. Rendering both
 * and hiding one with CSS would build every card twice, which at 8-week density
 * is a lot of DOM for nothing.
 */
export default function useMediaQuery(query) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    // Server snapshot; there is no SSR here, but useSyncExternalStore wants it.
    () => false
  );
}
