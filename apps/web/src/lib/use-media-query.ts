import { useCallback, useSyncExternalStore } from 'react'

/** Whether a media query matches, kept up to date (e.g. `(min-width: 48rem)` for Tailwind's `md`). */
export function useMediaQuery(query: string) {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', onChange)
      return () => list.removeEventListener('change', onChange)
    },
    [query],
  )
  return useSyncExternalStore(subscribe, () => window.matchMedia(query).matches)
}
