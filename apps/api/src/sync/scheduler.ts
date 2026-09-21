import type { AppDeps } from '../deps.ts'
import { syncAllUsers } from './all-users.ts'

type Logger = Pick<Console, 'info' | 'error'>

/**
 * Runs `syncAllUsers` every `intervalMs` while the API process is up, so plays are
 * recorded even with no browser open. The first run happens shortly after start, and
 * a slow run is never overlapped by the next. Returns a function that stops it.
 */
export function startSyncScheduler(
  deps: AppDeps,
  { intervalMs, firstRunAfterMs = 5_000, log = console }: { intervalMs: number; firstRunAfterMs?: number; log?: Logger },
): () => void {
  let running = false

  async function tick() {
    if (running) return
    running = true
    try {
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
  }
}
