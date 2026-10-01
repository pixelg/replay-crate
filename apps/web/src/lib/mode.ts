import { useSyncExternalStore } from 'react'

/**
 * Music or podcasts: which half of the library the screens show. It's only a view: the player
 * plays and shows whatever is on, in either mode, and switching never touches playback.
 *
 * Kept per device in localStorage under `rc:mode` (music when unset), like the theme. Nothing
 * looks different before the app renders, so unlike the theme there's no inline script for it.
 */
export type Mode = 'music' | 'podcasts'

const STORAGE_KEY = 'rc:mode'

const listeners = new Set<() => void>()

function readMode(): Mode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'podcasts' ? 'podcasts' : 'music'
  } catch {
    return 'music'
  }
}

// The mode as last set, so a page whose storage is blocked still remembers it until reload.
let current: Mode | undefined

/** The mode now; loaders read it to fetch the right half of the library. */
export function getMode(): Mode {
  return (current ??= readMode())
}

export function setMode(mode: Mode) {
  try {
    if (mode === 'music') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    // Storage blocked (private window): the choice lasts until the page reloads.
  }
  if (mode === current) return
  current = mode
  for (const listener of listeners) listener()
}

/** Follows another tab's switch. Call once at startup; returns a stop function. */
export function startModeSync(onChange?: (mode: Mode) => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return
    const next = readMode()
    if (next === current) return
    current = next
    for (const listener of listeners) listener()
    onChange?.(next)
  }
  window.addEventListener('storage', onStorage)
  return () => window.removeEventListener('storage', onStorage)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The mode on screen; re-renders when it's switched (here or in another tab). */
export function useMode(): Mode {
  return useSyncExternalStore(subscribe, getMode)
}
