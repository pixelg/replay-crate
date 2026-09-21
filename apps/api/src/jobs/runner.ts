import type { AppDeps } from '../deps.ts'
import { runJobs } from './queue.ts'

type Logger = Pick<Console, 'info' | 'error'>

/**
 * Keeps the job queue moving while the API runs: back-to-back batches while there's a
 * backlog (an import can queue thousands of tracks), a slow poll when it's empty, and
 * Spotify's Retry-After when rate-limited. Returns a function that stops it.
 */
export function startJobRunner(
  deps: AppDeps,
  { idleMs = 60_000, busyPauseMs = 2_000, log = console }: { idleMs?: number; busyPauseMs?: number; log?: Logger } = {},
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  async function loop() {
    let wait = idleMs
    try {
      const result = await runJobs(deps)
      if (result.done || result.retrying || result.dropped) {
        log.info(
          `[jobs] ${result.done} done, ${result.retrying} retrying, ${result.dropped} dropped, ${result.remaining} left`,
        )
      }
      if (result.rateLimitedUntil) wait = Math.max(result.rateLimitedUntil.getTime() - Date.now(), busyPauseMs)
      else if (result.done > 0 && result.remaining > 0) wait = busyPauseMs
    } catch (error) {
      log.error('[jobs] run failed', error)
    }
    if (!stopped) timer = setTimeout(loop, wait)
  }

  timer = setTimeout(loop, busyPauseMs)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}
