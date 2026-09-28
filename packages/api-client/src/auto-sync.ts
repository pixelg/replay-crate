/**
 * When to sync history without being asked. Spotify can't say when a play is recorded, so the app
 * reacts to what it already sees instead of polling harder: a new item playing means the last one
 * has probably finished, and coming back to the app after a while means plays may have piled up.
 */
export type SyncTiming = {
  /** Wait this long after the item changes: recently played takes a moment to list the last one. */
  afterTrackChangeMs: number
  /** Coming back to the app syncs if nothing has synced for this long. */
  staleAfterMs: number
}

export const SYNC_TIMING: SyncTiming = { afterTrackChangeMs: 15_000, staleAfterMs: 2 * 60_000 }

export type SyncScheduler = {
  /** Syncs now. */
  syncNow(): void
  /** What's playing now (its uri, or null for nothing), from each playback answer. */
  itemChanged(uri: string | null): void
  /** The app is in view again. */
  returned(): void
  /** A sync started elsewhere (Sync now) succeeded. */
  synced(): void
  /** Drops a pending sync. */
  stop(): void
}

/**
 * Calls `sync` when history is likely to have something new: once, `afterTrackChangeMs` after the
 * playing item changes (a further change starts the wait again, so skipping through tracks costs
 * one sync), and on coming back when the last sync is older than `staleAfterMs`. The first item
 * seen is where things stand, not a change; nor is something starting after nothing played.
 */
export function createSyncScheduler(sync: () => void, timing: SyncTiming = SYNC_TIMING): SyncScheduler {
  let timer: ReturnType<typeof setTimeout> | undefined
  // undefined until the first playback answer.
  let current: string | null | undefined
  // When a sync last started or succeeded; a failed one also waits out `staleAfterMs`.
  let lastSync = Number.NEGATIVE_INFINITY

  // A pending track-change sync stays: a sync just now may be too early to list that track.
  const syncNow = () => {
    lastSync = Date.now()
    sync()
  }

  return {
    syncNow,
    itemChanged(uri) {
      const previous = current
      current = uri
      if (previous === undefined || previous === null || previous === uri) return
      clearTimeout(timer)
      timer = setTimeout(syncNow, timing.afterTrackChangeMs)
    },
    returned() {
      if (Date.now() - lastSync >= timing.staleAfterMs) syncNow()
    },
    synced() {
      lastSync = Date.now()
    },
    stop() {
      clearTimeout(timer)
      timer = undefined
    },
  }
}
