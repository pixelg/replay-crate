import { z } from '@hono/zod-openapi'
import { schema } from '@replay-crate/db'
import { and, eq, gte, lt, sql, type SQL } from 'drizzle-orm'
import { playInGenre } from '../genres/queries.ts'
import { IsoDateTime } from '../lib/schemas.ts'

const { plays, trackRatings } = schema

/** The query parameters that narrow down which plays count, shared by the History endpoints. */
export const PlayFilterQuery = z.object({
  genre: z.coerce.number().int().min(1).optional().openapi({ description: 'Only plays in this genre (a `GenreRef` id).' }),
  since: IsoDateTime.optional().openapi({ description: 'Only plays at or after this time.' }),
  until: IsoDateTime.optional().openapi({ description: 'Only plays strictly before this time.' }),
  rated: z.enum(['yes', 'no']).optional().openapi({ description: 'Only plays of tracks you have rated (`yes`) or not (`no`).' }),
  newSince: IsoDateTime.optional().openapi({
    description: 'Only plays of tracks first played at or after this time: with `since` set to the same time, what was new to you then.',
  }),
  context: z
    .string()
    .regex(/^spotify:[\w:.-]+$/)
    .optional()
    .openapi({ description: 'Only plays from this context (its Spotify URI).', example: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' }),
})
export type PlayFilter = z.infer<typeof PlayFilterQuery>

/** The user's plays that `filter` keeps: a condition on `plays`. */
export function playFilter(userId: string, { genre, since, until, rated, newSince, context }: PlayFilter): SQL {
  const isRated = sql`exists (
    select 1 from ${trackRatings}
    where ${trackRatings.userId} = ${plays.userId} and ${trackRatings.trackId} = ${plays.trackId}
  )`
  return and(
    eq(plays.userId, userId),
    genre ? playInGenre(genre) : undefined,
    since ? gte(plays.playedAt, new Date(since)) : undefined,
    until ? lt(plays.playedAt, new Date(until)) : undefined,
    rated === 'yes' ? isRated : rated === 'no' ? sql`not ${isRated}` : undefined,
    newSince
      ? sql`not exists (
          select 1 from ${plays} earlier
          where earlier.user_id = ${plays.userId} and earlier.track_id = ${plays.trackId}
            and earlier.played_at < ${newSince}::timestamptz
        )`
      : undefined,
    context ? eq(plays.contextUri, context) : undefined,
  )!
}
