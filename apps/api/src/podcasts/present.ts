import { z } from '@hono/zod-openapi'
import { schema, type Db } from '@replay-crate/db'
import { and, eq, inArray } from 'drizzle-orm'
import { IsoDateTime, Rating } from '../lib/schemas.ts'

// How podcasts appear in responses, and the loaders that fill them in for a page at once.

const { episodeProgress, episodeRatings, episodes, shows } = schema

export const ShowRef = z
  .object({ id: z.string(), name: z.string(), thumbUrl: z.string().nullable() })
  .openapi('ShowRef')

export const EpisodeProgress = z
  .object({
    resumePositionMs: z.number().int().openapi({ description: 'Where listening would pick up.' }),
    fullyPlayed: z.boolean(),
  })
  .nullable()
  .openapi('EpisodeProgress', { description: 'Null when the user has never played it.' })

/** An episode the way lists show it. */
export const EpisodeSummary = z
  .object({
    id: z.string().openapi({ description: 'Spotify episode id.' }),
    name: z.string(),
    durationMs: z.number().int(),
    explicit: z.boolean(),
    releaseDate: z.string().nullable().openapi({ description: "Spotify's precision: YYYY, YYYY-MM or YYYY-MM-DD." }),
    thumbUrl: z.string().nullable(),
    show: ShowRef,
    progress: EpisodeProgress,
    rating: Rating,
  })
  .openapi('EpisodeSummary')
export type EpisodeSummary = z.infer<typeof EpisodeSummary>

/** One stretch of listening. Imported listens have no positions. */
export const ListenItem = z
  .object({
    id: z.number().int(),
    startedAt: IsoDateTime,
    endedAt: IsoDateTime,
    listenedMs: z.number().int().openapi({ description: 'How much of the episode was heard (at 2×, twice the time on the clock).' }),
    startPositionMs: z.number().int().nullable(),
    endPositionMs: z.number().int().nullable(),
    source: z.enum(schema.listenSource.enumValues),
    episode: EpisodeSummary,
  })
  .openapi('ListenItem')

/** The user's view of `episodeIds`: each with its show, their progress and rating. Unknown ids are left out. */
export async function loadEpisodeSummaries(db: Db, userId: string, episodeIds: string[]): Promise<Map<string, EpisodeSummary>> {
  const ids = [...new Set(episodeIds)]
  if (!ids.length) return new Map()
  const rows = await db
    .select({
      id: episodes.id,
      name: episodes.name,
      durationMs: episodes.durationMs,
      explicit: episodes.explicit,
      releaseDate: episodes.releaseDate,
      thumbUrl: episodes.thumbUrl,
      showId: shows.id,
      showName: shows.name,
      showThumbUrl: shows.thumbUrl,
      resumePositionMs: episodeProgress.resumePositionMs,
      fullyPlayed: episodeProgress.fullyPlayed,
      rating: episodeRatings.rating,
    })
    .from(episodes)
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .leftJoin(episodeProgress, and(eq(episodeProgress.episodeId, episodes.id), eq(episodeProgress.userId, userId)))
    .leftJoin(episodeRatings, and(eq(episodeRatings.episodeId, episodes.id), eq(episodeRatings.userId, userId)))
    .where(inArray(episodes.id, ids))
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        durationMs: row.durationMs,
        explicit: row.explicit,
        releaseDate: row.releaseDate,
        thumbUrl: row.thumbUrl ?? row.showThumbUrl,
        show: { id: row.showId, name: row.showName, thumbUrl: row.showThumbUrl },
        progress:
          row.resumePositionMs === null || row.fullyPlayed === null
            ? null
            : { resumePositionMs: row.resumePositionMs, fullyPlayed: row.fullyPlayed },
        rating: row.rating,
      },
    ]),
  )
}

/** Aggregates come back as Date from Postgres drivers, but guard against string/null. */
export function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  return (value instanceof Date ? value : new Date(value)).toISOString()
}
