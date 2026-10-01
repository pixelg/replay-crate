import { schema } from '@replay-crate/db'
import { pickImage, type SavedShow, type SpotifyEpisode } from '@replay-crate/spotify'
import { and, eq, inArray, isNull, lt, notInArray, or, sql } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { enqueue } from '../jobs/enqueue.ts'
import { getAccessToken } from '../spotify/access-token.ts'
import { DESCRIPTION_LIMIT, saveProgress, upsertEpisodes } from './catalog.ts'

const { shows, userShows, users } = schema

/** A followed show's latest episodes are fetched again after this long. */
export const SHOW_EPISODES_STALE_MS = 12 * 60 * 60_000
/** Followed shows are read again after this long by the scheduled sync. */
export const SHOWS_SYNC_STALE_MS = 12 * 60 * 60_000
/** Pages of 50 followed shows read at most. */
const MAX_PAGES = 20

/** The `show` job's ref: resume points are per user, so one job per user and show. */
export const showJobRef = (userId: string, showId: string) => `${userId}:${showId}`
export function parseShowJobRef(ref: string): { userId: string; showId: string } {
  const at = ref.lastIndexOf(':')
  return { userId: ref.slice(0, at), showId: ref.slice(at + 1) }
}

/**
 * Reads the shows the user saved on Spotify into `user_shows` (forgetting ones they removed),
 * and queues a `show` job for each whose latest episodes haven't been fetched lately.
 */
export async function syncFollowedShows(deps: AppDeps, userId: string): Promise<{ total: number; queued: number }> {
  const { db, spotify } = deps
  const now = deps.now?.() ?? new Date()
  const accessToken = await getAccessToken(deps, userId)
  const saved: SavedShow[] = []
  for (let page = 0, offset = 0; page < MAX_PAGES; page++) {
    const result = await spotify.getMyShows(accessToken, offset)
    saved.push(...result.items.filter((item): item is SavedShow => Boolean(item?.show?.id)))
    if (!result.next || !result.items.length) break
    offset += result.items.length
  }

  if (saved.length) {
    await db
      .insert(shows)
      .values(
        saved.map(({ show }) => ({
          id: show.id,
          name: show.name,
          description: show.description ? show.description.slice(0, DESCRIPTION_LIMIT) : null,
          imageUrl: pickImage(show.images, 300),
          thumbUrl: pickImage(show.images, 64),
        })),
      )
      .onConflictDoUpdate({
        target: shows.id,
        set: {
          name: sql`excluded.name`,
          description: sql`coalesce(excluded.description, ${shows.description})`,
          imageUrl: sql`coalesce(excluded.image_url, ${shows.imageUrl})`,
          thumbUrl: sql`coalesce(excluded.thumb_url, ${shows.thumbUrl})`,
          updatedAt: sql`now()`,
        },
      })
    await db
      .insert(userShows)
      .values(saved.map(({ show, added_at }) => ({ userId, showId: show.id, addedAt: new Date(added_at) })))
      .onConflictDoUpdate({ target: [userShows.userId, userShows.showId], set: { addedAt: sql`excluded.added_at` } })
  }
  const ids = saved.map(({ show }) => show.id)
  await db.delete(userShows).where(and(eq(userShows.userId, userId), ids.length ? notInArray(userShows.showId, ids) : undefined))
  await db.update(users).set({ showsSyncedAt: now }).where(eq(users.id, userId))

  const stale = ids.length
    ? await db
        .select({ id: shows.id })
        .from(shows)
        .where(
          and(
            inArray(shows.id, ids),
            or(isNull(shows.episodesCheckedAt), lt(shows.episodesCheckedAt, new Date(now.getTime() - SHOW_EPISODES_STALE_MS))),
          ),
        )
    : []
  await enqueue(
    db,
    stale.map(({ id }) => ({ kind: 'show' as const, ref: showJobRef(userId, id), userId })),
    now,
  )
  return { total: saved.length, queued: stale.length }
}

/** The `show` job: the show's latest episodes, with the user's resume points, into the catalog. */
export async function refreshShowEpisodes(deps: AppDeps, ref: string, accessToken: string): Promise<void> {
  const { db } = deps
  const now = deps.now?.() ?? new Date()
  const { userId, showId } = parseShowJobRef(ref)
  const [show] = await db.select({ id: shows.id, name: shows.name }).from(shows).where(eq(shows.id, showId))
  if (!show) return
  const page = await deps.spotify.getShowEpisodes(accessToken, showId)
  const items = page.items.filter((item) => item?.id)
  // The list leaves the show out; the stored one stands in (no images: `upsertEpisodes` keeps what's there).
  const showRef: SpotifyEpisode['show'] = { id: show.id, name: show.name, uri: `spotify:show:${show.id}`, images: [] }
  await upsertEpisodes(
    db,
    items.map((item) => ({ ...item, type: 'episode' as const, show: showRef })),
  )
  for (const item of items) {
    if (!item.resume_point) continue
    // Never started: no progress to keep.
    if (!item.resume_point.fully_played && item.resume_point.resume_position_ms === 0) continue
    await saveProgress(
      db,
      {
        userId,
        episodeId: item.id,
        resumePositionMs: item.resume_point.resume_position_ms,
        fullyPlayed: item.resume_point.fully_played,
        authoritative: true,
      },
      now,
    )
  }
  await db.update(shows).set({ episodesCheckedAt: now }).where(eq(shows.id, showId))
}
