import type { AppDeps } from '../deps.ts'
import { pausedUntil } from '../jobs/budget.ts'
import { holdLease, PROCESS_ID, releaseLease } from '../jobs/lease.ts'
import { syncAllUsers } from './all-users.ts'

/** Only the process holding this lease runs the scheduled sync; see `workerLeases`. */
export const SYNC_LEASE = 'sync'

type Logger = Pick<Console, 'info' | 'error'>

/**
 * Runs `syncAllUsers` every `intervalMs` while the API process is up, so plays are
 * recorded even with no browser open. The first run happens shortly after start, and
 * a slow run is never overlapped by the next. With `pnpm dev` and the serve service both up,
 * only the process holding the sync lease syncs; it renews the lease each run, and it lapses
 * after two intervals without one, so the other takes over. Returns a function that stops it.
 */
export function startSyncScheduler(
  deps: AppDeps,
  {
    intervalMs,
    firstRunAfterMs = 5_000,
    holder = PROCESS_ID,
    log = console,
  }: { intervalMs: number; firstRunAfterMs?: number; holder?: string; log?: Logger },
): () => void {
  let running = false
  let holding: boolean | undefined

  async function tick() {
    if (running) return
    running = true
    try {
      const held = await holdLease(deps.db, SYNC_LEASE, holder, intervalMs * 2, deps.now?.())
      if (held !== holding && !held) log.info('[sync] another process runs the scheduled sync; standing by')
      holding = held
      if (!held) return
      // Spotify asked for a pause (it can be most of a day): the next run after it catches up.
      const paused = await pausedUntil(deps.db, deps.now?.())
      if (paused) {
        log.info(`[sync] skipped: Spotify asked us to wait until ${paused.toISOString()}`)
        return
      }
      const results = await syncAllUsers(deps)
      const inserted = results.reduce((sum, result) => sum + ('inserted' in result ? result.inserted : 0), 0)
      const failed = results.filter((result) => 'error' in result).length
      log.info(`[sync] ${results.length} user(s), ${inserted} new play(s)${failed ? `, ${failed} failed` : ''}`)
    } catch (error) {
      log.error('[sync] scheduled sync failed', error)
    } finally {
      running = false
    }
  }

  const first = setTimeout(tick, firstRunAfterMs)
  const timer = setInterval(tick, intervalMs)
  return () => {
    clearTimeout(first)
    clearInterval(timer)
    if (holding) void releaseLease(deps.db, SYNC_LEASE, holder).catch(() => {})
  }
}
