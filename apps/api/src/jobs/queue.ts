import { schema, type Db, type Job } from '@replay-crate/db'
import { MetadataApiError } from '@replay-crate/metadata'
import { pickImage, SpotifyApiError } from '@replay-crate/spotify'
import { and, asc, count, eq, gt, inArray, lte, notInArray, sql, type SQL } from 'drizzle-orm'
import { genreHandlers } from '../genres/jobs.ts'
import { getAccessToken, ReauthRequiredError } from '../spotify/access-token.ts'
import { discardTrack, promote } from '../imports/service.ts'
import { upsertCatalog } from '../sync/catalog.ts'
import { DEFAULT_BUDGET, pauseApi, pausedUntil, takeCall, type Api, type CallBudget } from './budget.ts'
import type { JobKind } from './enqueue.ts'
import type { Handler } from './handler.ts'
import type { AppDeps } from '../deps.ts'

export { enqueue, type JobKind } from './enqueue.ts'

const { artists, jobs } = schema

const handlers: Record<JobKind, Handler> = {
  /**
   * Fetch a track (e.g. one named in an import) into the catalog, then move any imported
   * plays that were waiting for it into history.
   */
  track: {
    api: 'spotify',
    run: async (deps, id, { accessToken }) => {
      await upsertCatalog(deps.db, [await deps.spotify.getTrack(await accessToken(), id)])
      await promote(deps.db, [id])
    },
    gone: (deps, id) => discardTrack(deps.db, id),
  },
  /** Fetch an artist for its image (artists in plays come without one). */
  artist: {
    api: 'spotify',
    run: async (deps, id, { accessToken }) => {
      const artist = await deps.spotify.getArtist(await accessToken(), id)
      await deps.db
        .insert(artists)
        .values({ id: artist.id, name: artist.name, imageUrl: pickImage(artist.images, 300) })
        .onConflictDoUpdate({
          target: artists.id,
          set: { name: sql`excluded.name`, imageUrl: sql`excluded.image_url`, updatedAt: sql`now()` },
        })
    },
  },
  ...genreHandlers,
}

/**
 * How hard each API is worked: at most one call per `intervalMs`, and `budget` a day. Spotify's
 * budget comes from `JOB_CALLS_PER_DAY` (see index.ts) and is what really limits it. Last.fm asks
 * for no more than about five calls a second, MusicBrainz for one a second at most: their pace is
 * the interval, and the budget only a cap, with a burst big enough for a first run through a
 * library of thousands of artists (the refill alone is one call every few seconds).
 */
export const LANES: Record<Api, { intervalMs: number; budget: CallBudget }> = {
  spotify: { intervalMs: 300, budget: DEFAULT_BUDGET },
  lastfm: { intervalMs: 500, budget: { perDay: 50_000, burst: 10_000 } },
  musicbrainz: { intervalMs: 1_100, budget: { perDay: 40_000, burst: 5_000 } },
}

/** The jobs a lane runs. Spotify's also takes any kind no handler claims, which then fails loudly. */
function laneFilter(api: Api): SQL {
  const kinds = Object.keys(handlers) as JobKind[]
  return api === 'spotify'
    ? notInArray(jobs.kind, kinds.filter((kind) => handlers[kind].api !== 'spotify'))
    : inArray(jobs.kind, kinds.filter((kind) => handlers[kind].api === api))
}

const MINUTE = 60_000
/** 1, 2, 4… minutes, capped at 6 hours. */
const backoff = (attempts: number) => Math.min(2 ** (attempts - 1) * MINUTE, 6 * 60 * MINUTE)

export type RunResult = {
  done: number
  /** Jobs that failed and will be retried later. */
  retrying: number
  /** Jobs dropped because there's nothing to fetch (the API says 404/400). */
  dropped: number
  /** The API asked us to slow down (now or earlier, as recorded for every process); when to try again. */
  rateLimitedUntil: Date | null
  /** The day's call budget ran out; when the next call is allowed. */
  budgetUntil: Date | null
  /** The lane's jobs still queued (due now or later). */
  remaining: number
}

/** At most one Spotify call per this long: a steady ~3 a second, well inside Spotify's limits. */
export const CALL_INTERVAL_MS = LANES.spotify.intervalMs
/** Jobs reserved per round trip; unreached ones are handed back when a run stops early. */
const CLAIM_BATCH = 20
/** A reserved job that's neither done nor handed back (the process died) is due again after this. */
const CLAIM_MS = 5 * MINUTE

/**
 * Works through one API's due jobs (its lane; Spotify's unless `api` says) one at a time until
 * the time budget or `limit` runs out, one call per `intervalMs` at most, each taken from the
 * API's shared daily `budget`. Doesn't start while the API's Retry-After (recorded for every
 * process) is running, and records a new one. Jobs are reserved before they're worked on (their
 * `run_after` pushed out in the same statement that picks them), so two runners can never take
 * the same job.
 */
export async function runJobs(
  deps: AppDeps,
  {
    api = 'spotify',
    budgetMs = 20_000,
    limit = 500,
    intervalMs = LANES[api].intervalMs,
    budget = LANES[api].budget,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: {
    api?: Api
    budgetMs?: number
    limit?: number
    intervalMs?: number
    budget?: CallBudget
    sleep?: (ms: number) => Promise<void>
  } = {},
): Promise<RunResult> {
  const { db } = deps
  const now = () => deps.now?.() ?? new Date()
  const startedAt = Date.now()
  const result: RunResult = { done: 0, retrying: 0, dropped: 0, rateLimitedUntil: null, budgetUntil: null, remaining: 0 }
  result.rateLimitedUntil = await pausedUntil(db, now(), api)
  const lane = laneFilter(api)
  const tokens = new Map<string, Promise<string>>()
  let taken = 0
  let lastCall = Number.NEGATIVE_INFINITY

  run: while (!result.rateLimitedUntil && taken < limit && Date.now() - startedAt <= budgetMs) {
    const batch = await claim(db, Math.min(CLAIM_BATCH, limit - taken), now(), lane)
    if (!batch.length) break
    taken += batch.length
    for (const [i, job] of batch.entries()) {
      if (Date.now() - startedAt > budgetMs) {
        await release(db, batch.slice(i), now())
        break run
      }
      const allowed = await takeCall(db, budget, now(), api)
      if (!allowed.ok) {
        await release(db, batch.slice(i), now())
        result.budgetUntil = allowed.nextAt
        break run
      }
      const wait = lastCall + intervalMs - Date.now()
      if (wait > 0) await sleep(wait)
      lastCall = Date.now()
      const handler = handlers[job.kind as JobKind]
      try {
        if (!handler) throw new Error(`Unknown job kind "${job.kind}"`)
        const { userId } = job
        const accessToken = () => {
          if (!userId) throw new Error(`Job ${job.kind} ${job.ref} has no user to call Spotify as`)
          let token = tokens.get(userId)
          if (!token) {
            token = getAccessToken(deps, userId)
            tokens.set(userId, token)
            // A failed refresh isn't kept: the next job for this user tries again.
            token.catch(() => tokens.delete(userId))
          }
          return token
        }
        await handler.run(deps, job.ref, { accessToken })
        await db.delete(jobs).where(eq(jobs.id, job.id))
        result.done++
      } catch (error) {
        const apiError = error instanceof SpotifyApiError || error instanceof MetadataApiError ? error : null
        if (apiError && (apiError.status === 404 || apiError.status === 400)) {
          await handler?.gone?.(deps, job.ref)
          await db.delete(jobs).where(eq(jobs.id, job.id))
          result.dropped++
        } else if (apiError?.status === 429) {
          // This job and the rest of the batch wait out the API's Retry-After.
          const until = new Date(now().getTime() + (apiError.retryAfter ?? 60) * 1000)
          await release(db, batch.slice(i), until)
          await pauseApi(db, api, until, now())
          result.rateLimitedUntil = until
          break run
        } else {
          // Includes a user needing to reconnect: their jobs wait (with backoff) until they do.
          const attempts = job.attempts + 1
          await db
            .update(jobs)
            .set({
              attempts,
              runAfter: new Date(now().getTime() + (error instanceof ReauthRequiredError ? 6 * 60 * MINUTE : backoff(attempts))),
              lastError: error instanceof Error ? error.message : String(error),
            })
            .where(eq(jobs.id, job.id))
          result.retrying++
        }
      }
    }
  }

  const [left] = await db.select({ n: count() }).from(jobs).where(lane)
  result.remaining = left?.n ?? 0
  return result
}

/**
 * Reserves up to `n` due jobs, oldest due first: one statement picks them (skipping any another
 * runner is reserving right now) and pushes their `run_after` out by `CLAIM_MS`.
 */
async function claim(db: Db, n: number, now: Date, lane: SQL): Promise<Job[]> {
  const due = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(lte(jobs.runAfter, now), lane))
    .orderBy(asc(jobs.runAfter), asc(jobs.id))
    .limit(n)
    .for('update', { skipLocked: true })
  const claimed = await db
    .update(jobs)
    .set({ runAfter: new Date(now.getTime() + CLAIM_MS) })
    .where(inArray(jobs.id, due))
    .returning()
  return claimed.toSorted((a, b) => a.id - b.id)
}

/** Hands reserved jobs back, due at `at`. */
async function release(db: Db, batch: Job[], at: Date): Promise<void> {
  if (batch.length) await db.update(jobs).set({ runAfter: at }).where(inArray(jobs.id, batch.map((job) => job.id)))
}

/** Queue size for progress displays: everything pending, and how much of it has failed at least once. */
export async function jobStatus(db: Db, userId: string) {
  const [pending] = await db.select({ n: count() }).from(jobs).where(eq(jobs.userId, userId))
  const [failing] = await db
    .select({ n: count() })
    .from(jobs)
    .where(and(eq(jobs.userId, userId), gt(jobs.attempts, 0)))
  return { pending: pending?.n ?? 0, failing: failing?.n ?? 0 }
}
