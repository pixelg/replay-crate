import { schema, type Db } from '@replay-crate/db'
import { and, eq, inArray } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { getAccessToken } from '../spotify/access-token.ts'
import { upsertEpisodes } from './catalog.ts'

const { episodeRatings, episodes } = schema

/** The user's ratings of `episodeIds` (unrated ones are simply absent). */
export async function loadEpisodeRatings(db: Db, userId: string, episodeIds: string[]): Promise<Map<string, number>> {
  const ids = [...new Set(episodeIds)]
  if (!ids.length) return new Map()
  const rows = await db
    .select({ episodeId: episodeRatings.episodeId, rating: episodeRatings.rating })
    .from(episodeRatings)
    .where(and(eq(episodeRatings.userId, userId), inArray(episodeRatings.episodeId, ids)))
  return new Map(rows.map((row) => [row.episodeId, row.rating]))
}

/**
 * Rates an episode 1–5, replacing any earlier rating. An episode the app hasn't seen yet is
 * fetched from Spotify first; Spotify's errors, like 404 for an unknown id, propagate.
 */
export async function rateEpisode(deps: AppDeps, userId: string, episodeId: string, rating: number): Promise<void> {
  const { db } = deps
  const [known] = await db.select({ id: episodes.id }).from(episodes).where(eq(episodes.id, episodeId))
  if (!known) await upsertEpisodes(db, [await deps.spotify.getEpisode(await getAccessToken(deps, userId), episodeId)])
  await db
    .insert(episodeRatings)
    .values({ userId, episodeId, rating })
    .onConflictDoUpdate({ target: [episodeRatings.userId, episodeRatings.episodeId], set: { rating, updatedAt: new Date() } })
}

export async function clearEpisodeRating(db: Db, userId: string, episodeId: string): Promise<void> {
  await db.delete(episodeRatings).where(and(eq(episodeRatings.userId, userId), eq(episodeRatings.episodeId, episodeId)))
}
