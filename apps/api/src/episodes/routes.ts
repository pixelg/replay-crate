import { createRoute, z } from '@hono/zod-openapi'
import { schema } from '@replay-crate/db'
import { and, asc, count, desc, eq, isNull, max, min, or, sql, sum } from 'drizzle-orm'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { createRouter, errorResponses, signedIn } from '../lib/openapi.ts'
import { IsoDateTime, jsonBody, jsonResponse } from '../lib/schemas.ts'
import { EpisodeSummary, ListenItem, loadEpisodeSummaries, toIso } from '../podcasts/present.ts'
import { clearEpisodeRating, rateEpisode } from '../podcasts/ratings.ts'
import { spotifyErrorResponse } from '../spotify/errors.ts'

const { episodeListens, episodeProgress, episodeRatings, episodes } = schema

export const EPISODE_SORTS = ['recent', 'most', 'rating', 'newest'] as const

const LibraryEpisode = z
  .object({
    episode: EpisodeSummary,
    listens: z.number().int(),
    listenedMs: z.number().int().openapi({ description: 'Across all its listens.' }),
    lastListenedAt: IsoDateTime,
  })
  .openapi('LibraryEpisode')

const listEpisodes = createRoute({
  method: 'get',
  path: '/episodes',
  tags: ['Episodes'],
  operationId: 'listEpisodes',
  summary: 'Every episode you have listened to',
  description:
    'With how often and how long, and where you are in it. `recent` sorts by the last listen, `most` by time ' +
    'listened, `rating` by stars (unrated last), `newest` by release date. `unfinished` keeps only episodes not ' +
    'played to the end.',
  security: signedIn,
  request: {
    query: z.object({
      sort: z.enum(EPISODE_SORTS).default('recent'),
      unfinished: z
        .enum(['true', 'false'])
        .optional()
        .transform((value) => value === 'true')
        .openapi({ type: 'string', enum: ['true', 'false'], description: 'Only episodes not finished.' }),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({ items: z.array(LibraryEpisode), total: z.number().int().openapi({ description: 'Across all pages.' }) }),
      'A page of episodes.',
    ),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

const EpisodeParams = z.object({ id: z.string().min(1).openapi({ description: 'Spotify episode id.' }) })

const EpisodeDetail = z
  .object({
    episode: EpisodeSummary.extend({
      description: z.string().nullable().openapi({ description: 'Plain text, cut short.' }),
      imageUrl: z.string().nullable(),
    }),
    stats: z.object({
      listens: z.number().int(),
      listenedMs: z.number().int(),
      firstListenedAt: IsoDateTime.nullable(),
      lastListenedAt: IsoDateTime.nullable(),
    }),
    recentListens: z.array(ListenItem.omit({ episode: true })).openapi({ description: 'The latest 20, newest first.' }),
  })
  .openapi('EpisodeDetail')

const getEpisode = createRoute({
  method: 'get',
  path: '/episodes/{id}',
  tags: ['Episodes'],
  operationId: 'getEpisode',
  summary: 'An episode with your listens',
  security: signedIn,
  request: { params: EpisodeParams },
  responses: { 200: jsonResponse(EpisodeDetail, 'The episode.'), ...errorResponses('unauthorized', 'not_found') },
})

const rate = createRoute({
  method: 'put',
  path: '/episodes/{id}/rating',
  tags: ['Episodes'],
  operationId: 'rateEpisode',
  summary: 'Rate an episode',
  description: "1 to 5 stars, replacing any earlier rating. An episode the app hasn't seen yet is fetched from Spotify first.",
  security: signedIn,
  request: { params: EpisodeParams, body: jsonBody(z.object({ rating: z.number().int().min(1).max(5) })) },
  responses: {
    200: jsonResponse(z.object({ rating: z.number().int().min(1).max(5) }), 'Rated.'),
    ...errorResponses('invalid_request', 'unauthorized', 'forbidden', 'not_found', 'reauth_required', 'rate_limited'),
  },
})

const unrate = createRoute({
  method: 'delete',
  path: '/episodes/{id}/rating',
  tags: ['Episodes'],
  operationId: 'clearEpisodeRating',
  summary: 'Clear an episode rating',
  description: 'Back to unrated. Clearing an unrated episode is fine too.',
  security: signedIn,
  request: { params: EpisodeParams },
  responses: { 204: { description: 'Unrated.' }, ...errorResponses('invalid_request', 'unauthorized') },
})

export function episodeRoutes(deps: AppDeps) {
  const { db } = deps
  const auth = requireUser(deps)

  return createRouter()
    .openapi({ ...listEpisodes, middleware: auth }, async (c) => {
      const userId = c.var.user.id
      const { sort, unfinished, limit, offset } = c.req.valid('query')
      const listened = db
        .select({
          episodeId: episodeListens.episodeId,
          listens: count().as('listens'),
          listenedMs: sql<number>`sum(${episodeListens.listenedMs})::int`.as('listened_ms'),
          lastListenedAt: max(episodeListens.endedAt).as('last_listened_at'),
        })
        .from(episodeListens)
        .where(eq(episodeListens.userId, userId))
        .groupBy(episodeListens.episodeId)
        .as('listened')
      const filter = unfinished ? or(isNull(episodeProgress.fullyPlayed), eq(episodeProgress.fullyPlayed, false)) : undefined
      const base = () =>
        db
          .select({
            episodeId: listened.episodeId,
            listens: listened.listens,
            listenedMs: listened.listenedMs,
            lastListenedAt: listened.lastListenedAt,
          })
          .from(listened)
          .innerJoin(episodes, eq(episodes.id, listened.episodeId))
          .leftJoin(episodeProgress, and(eq(episodeProgress.episodeId, listened.episodeId), eq(episodeProgress.userId, userId)))
          .leftJoin(episodeRatings, and(eq(episodeRatings.episodeId, listened.episodeId), eq(episodeRatings.userId, userId)))
          .where(filter)
      const order = {
        recent: [desc(listened.lastListenedAt)],
        most: [desc(listened.listenedMs), desc(listened.lastListenedAt)],
        rating: [sql`${episodeRatings.rating} desc nulls last`, desc(listened.lastListenedAt)],
        newest: [sql`${episodes.releaseDate} desc nulls last`, desc(listened.lastListenedAt)],
      }[sort]
      const rows = await base()
        .orderBy(...order, asc(listened.episodeId))
        .limit(limit)
        .offset(offset)
      const [total] = await db.select({ n: count() }).from(base().as('matching'))
      const summaries = await loadEpisodeSummaries(
        db,
        userId,
        rows.map((row) => row.episodeId),
      )
      return c.json(
        {
          items: rows.map((row) => ({
            episode: summaries.get(row.episodeId)!,
            listens: row.listens,
            listenedMs: Number(row.listenedMs),
            lastListenedAt: toIso(row.lastListenedAt)!,
          })),
          total: total?.n ?? 0,
        },
        200,
      )
    })

    .openapi({ ...getEpisode, middleware: auth }, async (c) => {
      const userId = c.var.user.id
      const { id } = c.req.valid('param')
      const [row] = await db
        .select({ description: episodes.description, imageUrl: episodes.imageUrl })
        .from(episodes)
        .where(eq(episodes.id, id))
      const summary = (await loadEpisodeSummaries(db, userId, [id])).get(id)
      if (!row || !summary) return c.json({ error: 'not_found' as const }, 404)

      const mine = and(eq(episodeListens.userId, userId), eq(episodeListens.episodeId, id))
      const [stats] = await db
        .select({
          listens: count(),
          listenedMs: sum(episodeListens.listenedMs),
          first: min(episodeListens.startedAt),
          last: max(episodeListens.endedAt),
        })
        .from(episodeListens)
        .where(mine)
      const recent = await db.select().from(episodeListens).where(mine).orderBy(desc(episodeListens.endedAt)).limit(20)

      return c.json(
        {
          episode: { ...summary, description: row.description, imageUrl: row.imageUrl ?? summary.thumbUrl },
          stats: {
            listens: stats?.listens ?? 0,
            listenedMs: Number(stats?.listenedMs ?? 0),
            firstListenedAt: toIso(stats?.first),
            lastListenedAt: toIso(stats?.last),
          },
          recentListens: recent.map((listen) => ({
            id: listen.id,
            startedAt: listen.startedAt.toISOString(),
            endedAt: listen.endedAt.toISOString(),
            listenedMs: listen.listenedMs,
            startPositionMs: listen.startPositionMs,
            endPositionMs: listen.endPositionMs,
            source: listen.source,
          })),
        },
        200,
      )
    })

    .openapi({ ...rate, middleware: auth }, async (c) => {
      const { id } = c.req.valid('param')
      const { rating } = c.req.valid('json')
      try {
        await rateEpisode(deps, c.var.user.id, id, rating)
      } catch (error) {
        const response = spotifyErrorResponse(c, error)
        if (response) return response
        throw error
      }
      return c.json({ rating }, 200)
    })

    .openapi({ ...unrate, middleware: auth }, async (c) => {
      await clearEpisodeRating(db, c.var.user.id, c.req.valid('param').id)
      return c.body(null, 204)
    })
}
