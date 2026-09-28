import { schema, type Db, type Job } from '@replay-crate/db'
import { pickImage, SpotifyApiError } from '@replay-crate/spotify'
import { and, asc, count, eq, gt, inArray, lte, sql } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { getAccessToken, ReauthRequiredError } from '../spotify/access-token.ts'
import { discardTrack, promote } from '../imports/service.ts'
import { upsertCatalog } from '../sync/catalog.ts'
import { DEFAULT_BUDGET, pauseSpotify, pausedUntil, takeCall, type CallBudget } from './budget.ts'

const { artists, jobs } = schema

export type JobKind = 'track' | 'artist'
type Handler = {
  /** Does the work; makes exactly one Spotify call. */
  run: (deps: AppDeps, accessToken: string, ref: string) => Promise<void>
  /** Spotify doesn't have the thing any more (404/400); clean up anything waiting on it. */
  gone?: (deps: AppDeps, ref: string) => Promise<void>
}

const handlers: Record<JobKind, Handler> = {
  /**
   * Fetch a track (e.g. one named in an import) into the catalog, then move any imported
   * plays that were waiting for it into history.
   */
  track: {
    run: async (deps, accessToken, id) => {
      await upsertCatalog(deps.db, [await deps.spotify.getTrack(accessToken, id)])
      await promote(deps.db, [id])
    },
    gone: (deps, id) => discardTrack(deps.db, id),
  },
  /** Fetch an artist for its image (artists in plays come without one). */
  artist: { run: async (deps, accessToken, id) => {
    const artist = await deps.spotify.getArtist(accessToken, id)
    await deps.db
      .insert(artists)
      .values({ id: artist.id, name: artist.name, imageUrl: pickImage(artist.images, 300) })
      .onConflictDoUpdate({
        target: artists.id,
        set: { name: sql`excluded.name`, imageUrl: sql`excluded.image_url`, updatedAt: sql`now()` },
      })
  } },
}

const CHUNK = 1_000
const MINUTE = 60_000
/** 1, 2, 4… minutes, capped at 6 hours. */
const backoff = (attempts: number) => Math.min(2 ** (attempts - 1) * MINUTE, 6 * 60 * MINUTE)

/** Queues work, due at `now`; asking for the same kind + ref twice is harmless. */
export async function enqueue(
  db: Db,
  items: Array<{ kind: JobKind; ref: string; userId: string }>,
  now: Date = new Date(),
): Promise<void> {
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = items.slice(i, i + CHUNK).map((item) => ({ ...item, runAfter: now, createdAt: now }))
    await db.insert(jobs).values(batch).onConflictDoNothing()
  }
}

export type RunResult = {
  done: number
  /** Jobs that failed and will be retried later. */
  retrying: number
  /** Jobs dropped because there's nothing to fetch (Spotify says 404/400). */
  dropped: number
  /** Spotify asked us to slow down (now or earlier, as recorded for every process); when to try again. */
  rateLimitedUntil: Date | null
  /** The day's call budget ran out; when the next call is allowed. */
  budgetUntil: Date | null
  /** Jobs still queued (due now or later). */
  remaining: number
}

/** At most one Spotify call per this long: a steady ~3 a second, well inside Spotify's limits. */
export const CALL_INTERVAL_MS = 300
/** Jobs reserved per round trip; unreached ones are handed back when a run stops early. */
const CLAIM_BATCH = 20
/** A reserved job that's neither done nor handed back (the process died) is due again after this. */
const CLAIM_MS = 5 * MINUTE

/**
 * Works through due jobs one at a time until the time budget or `limit` runs out, one Spotify
 * call per `intervalMs` at most, each taken from the shared daily `budget`. Doesn't start while
 * Spotify's Retry-After (recorded for every process) is running, and records a new one. Jobs are reserved before
 * they're worked on (their `run_after` pushed out in the same statement that picks them), so two
 * runners can never take the same job.
 */
export async function runJobs(
  deps: AppDeps,
  {
    budgetMs = 20_000,
    limit = 500,
    intervalMs = CALL_INTERVAL_MS,
    budget = DEFAULT_BUDGET,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: {
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
  result.rateLimitedUntil = await pausedUntil(db, now())
  const tokens = new Map<string, string>()
  let taken = 0
  let lastCall = Number.NEGATIVE_INFINITY

  run: while (!result.rateLimitedUntil && taken < limit && Date.now() - startedAt <= budgetMs) {
    const batch = await claim(db, Math.min(CLAIM_BATCH, limit - taken), now())
    if (!batch.length) break
    taken += batch.length
    for (const [i, job] of batch.entries()) {
      if (Date.now() - startedAt > budgetMs) {
        await release(db, batch.slice(i), now())
        break run
      }
      const allowed = await takeCall(db, budget, now())
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
        let token = tokens.get(job.userId)
        if (!token) {
          token = await getAccessToken(deps, job.userId)
          tokens.set(job.userId, token)
        }
        await handler.run(deps, token, job.ref)
        await db.delete(jobs).where(eq(jobs.id, job.id))
        result.done++
      } catch (error) {
        if (error instanceof SpotifyApiError && (error.status === 404 || error.status === 400)) {
          await handler?.gone?.(deps, job.ref)
          await db.delete(jobs).where(eq(jobs.id, job.id))
          result.dropped++
        } else if (error instanceof SpotifyApiError && error.status === 429) {
          // This job and the rest of the batch wait out Spotify's Retry-After.
          const until = new Date(now().getTime() + (error.retryAfter ?? 60) * 1000)
          await release(db, batch.slice(i), until)
          await pauseSpotify(db, until, now())
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

  const [left] = await db.select({ n: count() }).from(jobs)
  result.remaining = left?.n ?? 0
  return result
}

/**
 * Reserves up to `n` due jobs, oldest due first: one statement picks them (skipping any another
 * runner is reserving right now) and pushes their `run_after` out by `CLAIM_MS`.
 */
async function claim(db: Db, n: number, now: Date): Promise<Job[]> {
  const due = db
    .select({ id: jobs.id })
    .from(jobs)
    .where(lte(jobs.runAfter, now))
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
