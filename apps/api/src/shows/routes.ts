import { createRoute, z } from '@hono/zod-openapi'
import { schema } from '@replay-crate/db'
import { and, count, countDistinct, desc, eq, max, sql } from 'drizzle-orm'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { createRouter, errorResponses, signedIn } from '../lib/openapi.ts'
import { IsoDateTime, jsonResponse } from '../lib/schemas.ts'
import { EpisodeSummary, loadEpisodeSummaries, ShowRef, toIso } from '../podcasts/present.ts'

const { episodeListens, episodes, shows } = schema

const ShowStats = z.object({
  episodes: z.number().int().openapi({ description: 'Episodes listened to.' }),
  listens: z.number().int(),
  listenedMs: z.number().int(),
  lastListenedAt: IsoDateTime.nullable(),
})

const listShows = createRoute({
  method: 'get',
  path: '/shows',
  tags: ['Shows'],
  operationId: 'listShows',
  summary: 'Shows you listen to',
  description: 'Every show with a listen, the most recently listened first.',
  security: signedIn,
  responses: {
    200: jsonResponse(
      z.object({ items: z.array(z.object({ show: ShowRef, stats: ShowStats }).openapi('LibraryShow')) }),
      'Listened shows.',
    ),
    ...errorResponses('unauthorized'),
  },
})

const getShow = createRoute({
  method: 'get',
  path: '/shows/{id}',
  tags: ['Shows'],
  operationId: 'getShow',
  summary: 'A show with its episodes',
  description: "Its episodes the app knows (listened to, or seen in the player), newest release first, with the user's listens.",
  security: signedIn,
  request: { params: z.object({ id: z.string().min(1).openapi({ description: 'Spotify show id.' }) }) },
  responses: {
    200: jsonResponse(
      z
        .object({
          show: ShowRef.extend({ description: z.string().nullable(), imageUrl: z.string().nullable() }),
          stats: ShowStats,
          episodes: z.array(
            z.object({
              episode: EpisodeSummary,
              listens: z.number().int(),
              listenedMs: z.number().int(),
              lastListenedAt: IsoDateTime.nullable(),
            }),
          ),
        })
        .openapi('ShowDetail'),
      'The show.',
    ),
    ...errorResponses('unauthorized', 'not_found'),
  },
})

export function showRoutes(deps: AppDeps) {
  const { db } = deps
  const auth = requireUser(deps)

  return createRouter()
    .openapi({ ...listShows, middleware: auth }, async (c) => {
      const rows = await db
        .select({
          id: shows.id,
          name: shows.name,
          thumbUrl: shows.thumbUrl,
          episodes: countDistinct(episodeListens.episodeId),
          listens: count(),
          listenedMs: sql<number>`sum(${episodeListens.listenedMs})::int`,
          lastListenedAt: max(episodeListens.endedAt),
        })
        .from(episodeListens)
        .innerJoin(episodes, eq(episodes.id, episodeListens.episodeId))
        .innerJoin(shows, eq(shows.id, episodes.showId))
        .where(eq(episodeListens.userId, c.var.user.id))
        .groupBy(shows.id)
        .orderBy(desc(max(episodeListens.endedAt)))
      return c.json(
        {
          items: rows.map((row) => ({
            show: { id: row.id, name: row.name, thumbUrl: row.thumbUrl },
            stats: {
              episodes: row.episodes,
              listens: row.listens,
              listenedMs: Number(row.listenedMs),
              lastListenedAt: toIso(row.lastListenedAt),
            },
          })),
        },
        200,
      )
    })

    .openapi({ ...getShow, middleware: auth }, async (c) => {
      const userId = c.var.user.id
      const { id } = c.req.valid('param')
      const [show] = await db.select().from(shows).where(eq(shows.id, id))
      if (!show) return c.json({ error: 'not_found' as const }, 404)

      const rows = await db
        .select({
          id: episodes.id,
          listens: count(episodeListens.id),
          listenedMs: sql<number>`coalesce(sum(${episodeListens.listenedMs}), 0)::int`,
          lastListenedAt: max(episodeListens.endedAt),
        })
        .from(episodes)
        .leftJoin(episodeListens, and(eq(episodeListens.episodeId, episodes.id), eq(episodeListens.userId, userId)))
        .where(eq(episodes.showId, id))
        .groupBy(episodes.id)
        .orderBy(sql`${episodes.releaseDate} desc nulls last`, desc(max(episodeListens.endedAt)))
      const summaries = await loadEpisodeSummaries(
        db,
        userId,
        rows.map((row) => row.id),
      )
      const listened = rows.filter((row) => row.listens > 0)
      const lastListenedAt = listened.map((row) => toIso(row.lastListenedAt)!).toSorted().at(-1) ?? null

      return c.json(
        {
          show: { id: show.id, name: show.name, thumbUrl: show.thumbUrl, description: show.description, imageUrl: show.imageUrl },
          stats: {
            episodes: listened.length,
            listens: listened.reduce((n, row) => n + row.listens, 0),
            listenedMs: listened.reduce((n, row) => n + Number(row.listenedMs), 0),
            lastListenedAt,
          },
          episodes: rows.map((row) => ({
            episode: summaries.get(row.id)!,
            listens: row.listens,
            listenedMs: Number(row.listenedMs),
            lastListenedAt: toIso(row.lastListenedAt),
          })),
        },
        200,
      )
    })
}
