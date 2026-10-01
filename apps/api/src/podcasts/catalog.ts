import { schema, type Db } from '@replay-crate/db'
import { pickImage, type SpotifyEpisode } from '@replay-crate/spotify'
import { sql } from 'drizzle-orm'

const { episodeProgress, episodes, shows } = schema

/** Episode descriptions can run to pages; lists only ever show the start. */
export const DESCRIPTION_LIMIT = 2_000

const clip = (text: string | undefined) => (text ? text.slice(0, DESCRIPTION_LIMIT) : null)

/**
 * Upserts episodes and their shows, shows first so the foreign key holds. Fields the object
 * leaves out (the player's episodes may lack a release date) keep what's stored.
 */
export async function upsertEpisodes(db: Db, items: SpotifyEpisode[]): Promise<void> {
  if (!items.length) return
  const allShows = [...new Map(items.map((item) => [item.show.id, item.show])).values()]
  await db
    .insert(shows)
    .values(
      allShows.map((show) => ({
        id: show.id,
        name: show.name,
        description: clip(show.description),
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

  const allEpisodes = [...new Map(items.map((item) => [item.id, item])).values()]
  await db
    .insert(episodes)
    .values(
      allEpisodes.map((item) => ({
        id: item.id,
        showId: item.show.id,
        name: item.name,
        description: clip(item.description),
        durationMs: item.duration_ms,
        releaseDate: item.release_date || null,
        explicit: item.explicit,
        imageUrl: pickImage(item.images, 300),
        thumbUrl: pickImage(item.images, 64),
      })),
    )
    .onConflictDoUpdate({
      target: episodes.id,
      set: {
        name: sql`excluded.name`,
        showId: sql`excluded.show_id`,
        description: sql`coalesce(excluded.description, ${episodes.description})`,
        durationMs: sql`excluded.duration_ms`,
        releaseDate: sql`coalesce(excluded.release_date, ${episodes.releaseDate})`,
        explicit: sql`excluded.explicit`,
        imageUrl: sql`coalesce(excluded.image_url, ${episodes.imageUrl})`,
        thumbUrl: sql`coalesce(excluded.thumb_url, ${episodes.thumbUrl})`,
        updatedAt: sql`now()`,
      },
    })
}

/** Stores where the user is in an episode. `fullyPlayed` stays once set, unless Spotify itself says otherwise (`authoritative`). */
export async function saveProgress(
  db: Db,
  progress: { userId: string; episodeId: string; resumePositionMs: number; fullyPlayed: boolean; authoritative?: boolean },
  at: Date,
): Promise<void> {
  const { userId, episodeId, resumePositionMs, fullyPlayed, authoritative = false } = progress
  await db
    .insert(episodeProgress)
    .values({ userId, episodeId, resumePositionMs, fullyPlayed, updatedAt: at })
    .onConflictDoUpdate({
      target: [episodeProgress.userId, episodeProgress.episodeId],
      set: {
        resumePositionMs: sql`excluded.resume_position_ms`,
        fullyPlayed: authoritative ? sql`excluded.fully_played` : sql`${episodeProgress.fullyPlayed} or excluded.fully_played`,
        updatedAt: sql`excluded.updated_at`,
      },
    })
}
