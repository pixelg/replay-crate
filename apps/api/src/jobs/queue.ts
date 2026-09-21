import { schema, type Db } from '@replay-crate/db'
import { pickImage, SpotifyApiError } from '@replay-crate/spotify'
import { and, asc, count, eq, gt, lte, sql } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { getAccessToken, ReauthRequiredError } from '../spotify/access-token.ts'
import { discardTrack, promote } from '../imports/service.ts'
import { upsertCatalog } from '../sync/catalog.ts'

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
  /** Spotify asked us to slow down; when to try again. */
  rateLimitedUntil: Date | null
  /** Jobs still queued (due now or later). */
  remaining: number
}

/**
 * Works through due jobs one at a time until the time budget or `limit` runs out, pausing
 * briefly between Spotify calls. Stops early if Spotify rate-limits us.
 */
export async function runJobs(
  deps: AppDeps,
  {
    budgetMs = 20_000,
    limit = 500,
    pauseMs = 50,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  }: { budgetMs?: number; limit?: number; pauseMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<RunResult> {
  const { db } = deps
  const now = () => deps.now?.() ?? new Date()
  const startedAt = Date.now()
  const result: RunResult = { done: 0, retrying: 0, dropped: 0, rateLimitedUntil: null, remaining: 0 }

  const due = await db
    .select()
    .from(jobs)
    .where(lte(jobs.runAfter, now()))
    .orderBy(asc(jobs.runAfter), asc(jobs.id))
    .limit(limit)

  const tokens = new Map<string, string>()
  for (const job of due) {
    if (Date.now() - startedAt > budgetMs) break
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
        const until = new Date(now().getTime() + (error.retryAfter ?? 60) * 1000)
        await db.update(jobs).set({ runAfter: until }).where(eq(jobs.id, job.id))
        result.rateLimitedUntil = until
        break
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
    if (pauseMs > 0) await sleep(pauseMs)
  }

  const [left] = await db.select({ n: count() }).from(jobs)
  result.remaining = left?.n ?? 0
  return result
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
