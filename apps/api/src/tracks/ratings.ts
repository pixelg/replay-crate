import { schema, type Db } from '@replay-crate/db'
import { and, eq, inArray, sql } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { getAccessToken } from '../spotify/access-token.ts'
import { upsertCatalog } from '../sync/catalog.ts'

const { trackRatings, tracks } = schema

/**
 * The user's ratings of `trackIds` (unrated ones are simply absent). A copy of a recording has
 * the recording's rating, which is kept on its canonical track.
 */
export async function loadRatings(db: Db, userId: string, trackIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(trackIds)]
  if (!ids.length) return new Map()
  const rows = await db
    .select({ trackId: tracks.id, rating: trackRatings.rating })
    .from(tracks)
    .innerJoin(
      trackRatings,
      and(eq(trackRatings.userId, userId), eq(trackRatings.trackId, sql`coalesce(${tracks.recordingOf}, ${tracks.id})`)),
    )
    .where(inArray(tracks.id, ids))
  return new Map(rows.map((row) => [row.trackId, row.rating]))
}

/**
 * Rates a track 1–5, replacing any earlier rating. A track the app hasn't seen yet (say, one
 * playing now for the first time) is fetched from Spotify into the catalog first; Spotify's
 * errors, like 404 for an unknown id, propagate. A copy's rating lands on its recording's
 * canonical track (a trigger, migration 0025).
 */
export async function rateTrack(deps: AppDeps, userId: string, trackId: string, rating: number): Promise<void> {
  const { db } = deps
  const [known] = await db.select({ id: tracks.id }).from(tracks).where(eq(tracks.id, trackId))
  if (!known) await upsertCatalog(db, [await deps.spotify.getTrack(await getAccessToken(deps, userId), trackId)])
  await db
    .insert(trackRatings)
    .values({ userId, trackId, rating })
    .onConflictDoUpdate({ target: [trackRatings.userId, trackRatings.trackId], set: { rating, updatedAt: new Date() } })
}

export async function clearRating(db: Db, userId: string, trackId: string): Promise<void> {
  await db
    .delete(trackRatings)
    .where(and(eq(trackRatings.userId, userId), eq(trackRatings.trackId, sql`track_recording(${trackId})`)))
}
