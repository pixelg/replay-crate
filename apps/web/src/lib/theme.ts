import { useSyncExternalStore } from 'react'

/**
 * Light/dark theme.
 *
 * The preference (`system`, `light` or `dark`) lives in localStorage under `rc:theme`. The theme
 * actually shown is the `data-theme` attribute on <html>, which styles.css keys the dark tokens
 * off. The inline script in index.html sets it before first paint so the page never flashes the
 * wrong theme; after that only this module changes it. Storybook sets it from its toolbar.
 */
export type ThemePreference = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

// Keep in step with the inline script in index.html.
const STORAGE_KEY = 'rc:theme'
const THEME_COLORS: Record<Theme, string> = { light: '#faf8f5', dark: '#161412' }
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

const preferenceListeners = new Set<() => void>()

function readPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored === 'light' || stored === 'dark' ? stored : 'system'
  } catch {
    return 'system'
  }
}

function resolve(preference: ThemePreference): Theme {
  if (preference !== 'system') return preference
  return darkQuery().matches ? 'dark' : 'light'
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme])
}

export function setThemePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Storage blocked (private window): the choice lasts until the page reloads.
  }
  current = preference
  applyTheme(resolve(preference))
  for (const listener of preferenceListeners) listener()
}

// The preference as last set, so a page whose storage is blocked still remembers it until reload.
let current: ThemePreference | undefined

function getPreference(): ThemePreference {
  return (current ??= readPreference())
}

/**
 * Follows the OS while the preference is `system`, and other tabs' changes. Call once at startup;
 * returns a stop function.
 */
export function startThemeSync(): () => void {
  const query = darkQuery()
  const onSystemChange = () => {
    if (getPreference() === 'system') applyTheme(resolve('system'))
  }
  const onStorage = (event: StorageEvent) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return
    current = readPreference()
    applyTheme(resolve(current))
    for (const listener of preferenceListeners) listener()
  }
  query.addEventListener('change', onSystemChange)
  window.addEventListener('storage', onStorage)
  return () => {
    query.removeEventListener('change', onSystemChange)
    window.removeEventListener('storage', onStorage)
  }
}

function subscribePreference(listener: () => void) {
  preferenceListeners.add(listener)
  return () => preferenceListeners.delete(listener)
}

function subscribeTheme(listener: () => void) {
  const observer = new MutationObserver(listener)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  return () => observer.disconnect()
}

function getTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

/** The saved preference, the theme on screen, and ways to change them. */
export function useTheme() {
  const preference = useSyncExternalStore(subscribePreference, getPreference)
  const theme = useSyncExternalStore(subscribeTheme, getTheme)
  return {
    preference,
    theme,
    setPreference: setThemePreference,
    /** Switches to the other theme from the one on screen, and keeps it (no longer following the OS). */
    toggle: () => setThemePreference(theme === 'dark' ? 'light' : 'dark'),
  }
}
