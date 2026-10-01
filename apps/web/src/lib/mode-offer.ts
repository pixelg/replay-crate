import { useSyncExternalStore } from 'react'

/**
 * Whether to offer switching mode when what's playing is the other kind (a podcast in music
 * mode, music in podcast mode). On unless turned off in Settings (`rc:mode-offer`, per device);
 * "Not now" holds for that item until the tab closes (`rc:mode-offer-dismissed`). It only ever
 * offers: switching is always the user's click.
 */
const OFF_KEY = 'rc:mode-offer'
const DISMISSED_KEY = 'rc:mode-offer-dismissed'

const listeners = new Set<() => void>()
const notify = () => {
  for (const listener of listeners) listener()
}

let enabled: boolean | undefined
let dismissed: string[] | undefined

function readEnabled() {
  try {
    return localStorage.getItem(OFF_KEY) !== 'off'
  } catch {
    return true
  }
}

function readDismissed(): string[] {
  try {
    const stored = JSON.parse(sessionStorage.getItem(DISMISSED_KEY) ?? '[]') as unknown
    return Array.isArray(stored) ? stored.filter((uri): uri is string => typeof uri === 'string') : []
  } catch {
    return []
  }
}

const getEnabled = () => (enabled ??= readEnabled())
const getDismissed = () => (dismissed ??= readDismissed())

export function setModeOffers(on: boolean) {
  try {
    if (on) localStorage.removeItem(OFF_KEY)
    else localStorage.setItem(OFF_KEY, 'off')
  } catch {
    // Storage blocked: the choice lasts until the page reloads.
  }
  enabled = on
  notify()
}

/** "Not now" for this item (a Spotify URI). */
export function dismissModeOffer(uri: string) {
  // Only the latest few matter: an item comes round again rarely.
  dismissed = [...getDismissed().filter((known) => known !== uri), uri].slice(-20)
  try {
    sessionStorage.setItem(DISMISSED_KEY, JSON.stringify(dismissed))
  } catch {
    // Storage blocked: it holds until the page reloads.
  }
  notify()
}

/** Forgets both, for tests. */
export function resetModeOffers() {
  try {
    localStorage.removeItem(OFF_KEY)
    sessionStorage.removeItem(DISMISSED_KEY)
  } catch {
    // Nothing stored.
  }
  enabled = undefined
  dismissed = undefined
  notify()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useModeOffers() {
  const on = useSyncExternalStore(subscribe, getEnabled)
  const notNow = useSyncExternalStore(subscribe, getDismissed)
  return { enabled: on, isDismissed: (uri: string) => notNow.includes(uri) }
}
