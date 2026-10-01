import { z } from '@hono/zod-openapi'
import { schema, type Db } from '@replay-crate/db'
import { and, desc, eq, gt, gte, isNotNull, max, or, sql } from 'drizzle-orm'
import { loadEpisodeSummaries } from '../podcasts/present.ts'
import { RANGES } from './rules.ts'

// Ways to pick episodes for a new playlist, the podcast counterparts of `rules.ts`.

const { episodeListens, episodeProgress, episodeRatings, episodes, userShows } = schema

const DAY_MS = 24 * 60 * 60 * 1000
const range = z.enum(['7d', '30d', '90d', '1y', 'all'])
const limit = z.number().int().min(1).max(200).default(50)
const rangeLabels: Record<keyof typeof RANGES, string> = {
  '7d': 'the last 7 days',
  '30d': 'the last 30 days',
  '90d': 'the last 90 days',
  '1y': 'the last year',
  all: 'all time',
}

export const episodeRule = z
  .discriminatedUnion('kind', [
    /** Started but not finished, the most recently listened first: a queue to get back to. */
    z.object({ kind: z.literal('unfinished'), limit }),
    /** The unfinished latest episodes of the shows the user follows, newest release first. */
    z.object({ kind: z.literal('newest_from_shows'), days: z.number().int().min(1).max(365).default(14), limit }),
    /** Listened to in a time range, the latest first. */
    z.object({ kind: z.literal('recently_played'), range: range.default('7d'), limit }),
    /** Rated at least `minRating` stars, best first. */
    z.object({ kind: z.literal('top_rated'), minRating: z.number().int().min(1).max(5).default(4), limit }),
  ])
  .openapi('EpisodePlaylistRule')
export type EpisodeRule = z.infer<typeof episodeRule>

/** The episodes a rule picks, in playlist order, and a name to suggest. */
export async function evaluateEpisodeRule(db: Db, userId: string, rule: EpisodeRule, now: Date) {
  const progressJoin = and(eq(episodeProgress.episodeId, episodes.id), eq(episodeProgress.userId, userId))
  const lastListen = max(episodeListens.endedAt)
  let ids: string[]
  let suggestedName: string
  switch (rule.kind) {
    case 'unfinished': {
      const rows = await db
        .select({ id: episodes.id })
        .from(episodes)
        .innerJoin(episodeProgress, progressJoin)
        .leftJoin(episodeListens, and(eq(episodeListens.episodeId, episodes.id), eq(episodeListens.userId, userId)))
        .where(and(eq(episodeProgress.fullyPlayed, false), gt(episodeProgress.resumePositionMs, 0)))
        .groupBy(episodes.id, episodeProgress.updatedAt)
        .orderBy(sql`${lastListen} desc nulls last`, desc(episodeProgress.updatedAt))
        .limit(rule.limit)
      ids = rows.map((row) => row.id)
      suggestedName = 'Unfinished episodes'
      break
    }
    case 'newest_from_shows': {
      const since = new Date(now.getTime() - rule.days * DAY_MS).toISOString().slice(0, 10)
      const rows = await db
        .select({ id: episodes.id })
        .from(episodes)
        .innerJoin(userShows, and(eq(userShows.showId, episodes.showId), eq(userShows.userId, userId)))
        .leftJoin(episodeProgress, progressJoin)
        .where(
          and(
            isNotNull(episodes.releaseDate),
            sql`${episodes.releaseDate} >= ${since}`,
            or(sql`${episodeProgress.fullyPlayed} is null`, eq(episodeProgress.fullyPlayed, false)),
          ),
        )
        .orderBy(desc(episodes.releaseDate), episodes.name)
        .limit(rule.limit)
      ids = rows.map((row) => row.id)
      suggestedName = 'New from your shows'
      break
    }
    case 'recently_played': {
      const days = RANGES[rule.range]
      const rows = await db
        .select({ id: episodeListens.episodeId, last: lastListen })
        .from(episodeListens)
        .where(
          and(
            eq(episodeListens.userId, userId),
            days === null ? undefined : gte(episodeListens.endedAt, new Date(now.getTime() - days * DAY_MS)),
          ),
        )
        .groupBy(episodeListens.episodeId)
        .orderBy(desc(lastListen))
        .limit(rule.limit)
      ids = rows.map((row) => row.id)
      suggestedName = `Podcasts from ${rangeLabels[rule.range]}`
      break
    }
    case 'top_rated': {
      const rows = await db
        .select({ id: episodeRatings.episodeId })
        .from(episodeRatings)
        .where(and(eq(episodeRatings.userId, userId), gte(episodeRatings.rating, rule.minRating)))
        .orderBy(desc(episodeRatings.rating), desc(episodeRatings.updatedAt))
        .limit(rule.limit)
      ids = rows.map((row) => row.id)
      suggestedName = rule.minRating === 5 ? 'Five-star episodes' : `Top rated episodes (${rule.minRating}★ and up)`
      break
    }
  }
  const summaries = await loadEpisodeSummaries(db, userId, ids)
  return { suggestedName, episodes: ids.flatMap((id) => summaries.get(id) ?? []) }
}
