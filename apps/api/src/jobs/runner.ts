import type { AppDeps } from '../deps.ts'
import { enqueueGenreLookups } from '../genres/jobs.ts'
import type { Api, CallBudget } from './budget.ts'
import { holdLease, PROCESS_ID, releaseLease } from './lease.ts'
import { LANES, runJobs } from './queue.ts'

type Logger = Pick<Console, 'info' | 'error'>

/** Only the process holding this lease runs Spotify jobs; see `workerLeases`. */
export const JOBS_LEASE = 'jobs'
/** Each API's jobs have their own lease (`jobs` for Spotify, as before lanes), so one lane's pause holds up no other. */
const leaseFor = (api: Api) => (api === 'spotify' ? JOBS_LEASE : `jobs:${api}`)
const NAMES: Record<Api, string> = { spotify: 'Spotify', lastfm: 'Last.fm', musicbrainz: 'MusicBrainz' }
/** How long a held lease lasts without renewal; a closed process's lease lapses after this. */
const LEASE_MS = 60_000
/** The holder renews at least this often, even while idle or rate-limited. */
const RENEW_MS = 20_000

type RunnerOptions = {
  idleMs?: number
  busyPauseMs?: number
  holder?: string
  budget?: CallBudget
  log?: Logger
  /** Runs before each round, e.g. to queue more work (the genre sweep). */
  beforeRun?: () => Promise<unknown>
}

/**
 * Keeps one API's lane of the job queue moving while the API runs: back-to-back batches while
 * there's a backlog (an import can queue thousands of tracks), a slow poll when it's empty, and
 * the API's Retry-After when rate-limited. Only one process runs a lane at a time: with
 * `pnpm dev` and the serve service both up, the other stands by and takes over if this one
 * stops. Returns a function that stops it (and hands the lease on).
 */
export function startJobRunner(
  deps: AppDeps,
  {
    api = 'spotify',
    idleMs = 60_000,
    busyPauseMs = 2_000,
    holder = PROCESS_ID,
    budget = LANES[api].budget,
    log = console,
    beforeRun,
  }: RunnerOptions & { api?: Api } = {},
): () => void {
  const lease = leaseFor(api)
  const tag = api === 'spotify' ? '[jobs]' : `[jobs:${api}]`
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let holding: boolean | undefined
  let pausedUntil = 0
  let loggedPause = 0

  async function loop() {
    let wait = idleMs
    try {
      const held = await holdLease(deps.db, lease, holder, LEASE_MS, deps.now?.())
      if (held !== holding) log.info(held ? `${tag} running background jobs` : `${tag} another process runs background jobs; standing by`)
      holding = held
      if (held && Date.now() >= pausedUntil) {
        await beforeRun?.()
        const result = await runJobs(deps, { api, budget })
        if (result.done || result.retrying || result.dropped) {
          log.info(
            `${tag} ${result.done} done, ${result.retrying} retrying, ${result.dropped} dropped, ${result.remaining} left`,
          )
        }
        // The API's Retry-After (recorded for every process), or the day's budget spent: wait it out.
        const until = result.rateLimitedUntil ?? result.budgetUntil
        if (until) {
          pausedUntil = until.getTime()
          if (result.rateLimitedUntil && loggedPause !== pausedUntil) {
            log.info(`${tag} ${NAMES[api]} asked us to wait until ${result.rateLimitedUntil.toISOString()}`)
            loggedPause = pausedUntil
          }
        } else if (result.done > 0 && (result.remaining > 0 || beforeRun)) {
          // Work left, or maybe more for `beforeRun` to queue: go again soon.
          wait = busyPauseMs
        }
      }
      if (held) wait = Math.min(Math.max(wait, pausedUntil - Date.now()), RENEW_MS)
    } catch (error) {
      log.error(`${tag} run failed`, error)
    }
    if (!stopped) timer = setTimeout(loop, wait)
  }

  timer = setTimeout(loop, busyPauseMs)
  return () => {
    stopped = true
    clearTimeout(timer)
    if (holding) void releaseLease(deps.db, lease, holder).catch(() => {})
  }
}

/**
 * Starts a runner per API: Spotify's always, and the genre lanes when their gateway is there
 * (Last.fm needs an API key). The first genre lane tops the queue up with artists that need
 * genres before each round. Returns a function that stops them all.
 */
export function startJobRunners(
  deps: AppDeps,
  { spotifyBudget, ...options }: Omit<RunnerOptions, 'budget' | 'beforeRun'> & { spotifyBudget?: CallBudget } = {},
): () => void {
  const sweep = () => enqueueGenreLookups(deps)
  const stops = [startJobRunner(deps, { ...options, api: 'spotify', budget: spotifyBudget })]
  if (deps.lastfm) stops.push(startJobRunner(deps, { ...options, api: 'lastfm', beforeRun: sweep }))
  if (deps.musicbrainz) stops.push(startJobRunner(deps, { ...options, api: 'musicbrainz', beforeRun: deps.lastfm ? undefined : sweep }))
  return () => stops.forEach((stop) => stop())
}
