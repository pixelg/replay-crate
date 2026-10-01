import { useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'
import { getMode, setMode, type Mode } from './mode.ts'

/**
 * Where to go when switching to `mode` on `pathname`: the other mode's counterpart, or null to
 * stay (the page itself follows the mode, or doesn't depend on it, like the player).
 *
 * - The library swaps: Tracks for Episodes, and a track, episode or show page for the other list.
 * - History stays, keeping its date range and page size; a genre or show filter, a jump into the
 *   past and the page number belong to the mode left behind.
 */
export function counterpart(pathname: string, search: Record<string, unknown>, mode: Mode) {
  if (mode === 'podcasts' && /^\/tracks(\/|$)/.test(pathname)) return { to: '/episodes' } as const
  if (mode === 'music' && /^\/(episodes|shows)(\/|$)/.test(pathname)) return { to: '/tracks' } as const
  if (pathname === '/history') {
    const { size, when } = search
    return { to: '/history', search: { ...(size !== undefined && { size }), ...(when !== undefined && { when }) }, replace: true } as const
  }
  return null
}

/**
 * Switches the mode and moves to the counterpart of the page on screen (see `counterpart`), so the
 * screens follow at once. Playback carries on untouched.
 */
export function useSwitchMode() {
  const router = useRouter()
  return useCallback(
    (mode: Mode) => {
      if (mode === getMode()) return
      const { pathname, search } = router.state.location
      setMode(mode)
      const target = counterpart(pathname, search as Record<string, unknown>, mode)
      // Loaders read the mode: run them again for the half of the library now on screen.
      if (target) void router.navigate(target as Parameters<typeof router.navigate>[0]).then(() => router.invalidate())
      else void router.invalidate()
    },
    [router],
  )
}
