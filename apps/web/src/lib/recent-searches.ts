const KEY = 'rc:recent-searches'
const MAX = 6

/** Searches that led somewhere (a result opened, or all results shown), newest first. This browser only. */
export function recentSearches(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(stored) ? stored.filter((item): item is string => typeof item === 'string').slice(0, MAX) : []
  } catch {
    return []
  }
}

export function rememberSearch(q: string) {
  const query = q.trim()
  if (!query) return
  try {
    localStorage.setItem(KEY, JSON.stringify([query, ...recentSearches().filter((item) => item !== query)].slice(0, MAX)))
  } catch {
    // Storage blocked: no history, nothing else lost.
  }
}

export function forgetSearches() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // Nothing stored anyway.
  }
}
