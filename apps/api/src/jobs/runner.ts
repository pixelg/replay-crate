import type { AppDeps } from '../deps.ts'
import { holdLease, PROCESS_ID, releaseLease } from './lease.ts'
import { runJobs } from './queue.ts'

type Logger = Pick<Console, 'info' | 'error'>

/** Only the process holding this lease runs jobs; see `workerLeases`. */
export const JOBS_LEASE = 'jobs'
/** How long a held lease lasts without renewal; a closed process's lease lapses after this. */
const LEASE_MS = 60_000
/** The holder renews at least this often, even while idle or rate-limited. */
const RENEW_MS = 20_000

/**
 * Keeps the job queue moving while the API runs: back-to-back batches while there's a
 * backlog (an import can queue thousands of tracks), a slow poll when it's empty, and
 * Spotify's Retry-After when rate-limited. Only one process runs jobs at a time: with
 * `pnpm dev` and the serve service both up, the other stands by and takes over if this one
 * stops. Returns a function that stops it (and hands the lease on).
 */
export function startJobRunner(
  deps: AppDeps,
  {
    idleMs = 60_000,
    busyPauseMs = 2_000,
    holder = PROCESS_ID,
    log = console,
  }: { idleMs?: number; busyPauseMs?: number; holder?: string; log?: Logger } = {},
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let holding: boolean | undefined
  let pausedUntil = 0

  async function loop() {
    let wait = idleMs
    try {
      const held = await holdLease(deps.db, JOBS_LEASE, holder, LEASE_MS, deps.now?.())
      if (held !== holding) log.info(held ? '[jobs] running background jobs' : '[jobs] another process runs background jobs; standing by')
      holding = held
      if (held && Date.now() >= pausedUntil) {
        const result = await runJobs(deps)
        if (result.done || result.retrying || result.dropped) {
          log.info(
            `[jobs] ${result.done} done, ${result.retrying} retrying, ${result.dropped} dropped, ${result.remaining} left`,
          )
        }
        if (result.rateLimitedUntil) {
          pausedUntil = result.rateLimitedUntil.getTime()
          log.info(`[jobs] Spotify asked us to wait until ${result.rateLimitedUntil.toISOString()}`)
        } else if (result.done > 0 && result.remaining > 0) wait = busyPauseMs
      }
      if (held) wait = Math.min(Math.max(wait, pausedUntil - Date.now()), RENEW_MS)
    } catch (error) {
      log.error('[jobs] run failed', error)
    }
    if (!stopped) timer = setTimeout(loop, wait)
  }

  timer = setTimeout(loop, busyPauseMs)
  return () => {
    stopped = true
    clearTimeout(timer)
    if (holding) void releaseLease(deps.db, JOBS_LEASE, holder).catch(() => {})
  }
}
