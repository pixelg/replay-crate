import { createRoute, z } from '@hono/zod-openapi'
import { schema } from '@replay-crate/db'
import { and, count, countDistinct, desc, eq, isNotNull, max, or, sql } from 'drizzle-orm'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { createRouter, errorResponses, signedIn } from '../lib/openapi.ts'
import { spotifyErrorResponse } from '../spotify/errors.ts'
import { syncFollowedShows } from '../podcasts/shows.ts'
import { IsoDateTime, jsonResponse } from '../lib/schemas.ts'
import { EpisodeSummary, loadEpisodeSummaries, ShowRef, toIso } from '../podcasts/present.ts'

const { episodeListens, episodeProgress, episodes, shows, userShows } = schema

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
  summary: 'Shows you listen to or follow',
  description:
    'Every show with a listen, the most recently listened first, then the shows you follow on Spotify without one ' +
    '(A–Z). `followed` is as of the last `POST /shows/sync`.',
  security: signedIn,
  responses: {
    200: jsonResponse(
      z.object({
        items: z.array(z.object({ show: ShowRef, followed: z.boolean(), stats: ShowStats }).openapi('LibraryShow')),
        syncedAt: IsoDateTime.nullable().openapi({ description: 'When the shows you follow were last read from Spotify.' }),
      }),
      'Shows.',
    ),
    ...errorResponses('unauthorized'),
  },
})

const syncShows = createRoute({
  method: 'post',
  path: '/shows/sync',
  tags: ['Shows'],
  operationId: 'syncShows',
  summary: 'Sync the shows you follow',
  description:
    'Reads the shows you saved on Spotify, and queues a look at the latest episodes of each not checked in the last 12 ' +
    'hours (they arrive in the background). The scheduled sync does this twice a day too. Needs the ' +
    '`user-library-read` scope.',
  security: signedIn,
  responses: {
    200: jsonResponse(
      z.object({
        total: z.number().int().openapi({ description: 'Shows followed.' }),
        queued: z.number().int().openapi({ description: 'Shows whose latest episodes are being fetched.' }),
      }),
      'Synced.',
    ),
    ...errorResponses('unauthorized', 'forbidden', 'not_found', 'reauth_required', 'rate_limited'),
  },
})

const newEpisodes = createRoute({
  method: 'get',
  path: '/shows/new-episodes',
  tags: ['Shows'],
  operationId: 'listNewEpisodes',
  summary: 'New episodes of the shows you follow',
  description:
    "The latest episodes of the shows you follow that you haven't finished, newest release first: those released in " +
    'the last `days` days.',
  security: signedIn,
  request: {
    query: z.object({
      days: z.coerce.number().int().min(1).max(365).default(30),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({ items: z.array(EpisodeSummary), syncedAt: IsoDateTime.nullable() }),
      'New episodes.',
    ),
    ...errorResponses('invalid_request', 'unauthorized'),
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
          followed: z.boolean(),
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
    .openapi({ ...syncShows, middleware: auth }, async (c) => {
      try {
        return c.json(await syncFollowedShows(deps, c.var.user.id), 200)
      } catch (error) {
        const response = spotifyErrorResponse(c, error)
        if (response) return response
        throw error
      }
    })

    .openapi({ ...newEpisodes, middleware: auth }, async (c) => {
      const user = c.var.user
      const { days, limit } = c.req.valid('query')
      const since = new Date((deps.now?.() ?? new Date()).getTime() - days * 86_400_000).toISOString().slice(0, 10)
      const rows = await db
        .select({ id: episodes.id })
        .from(episodes)
        .innerJoin(userShows, and(eq(userShows.showId, episodes.showId), eq(userShows.userId, user.id)))
        .leftJoin(episodeProgress, and(eq(episodeProgress.episodeId, episodes.id), eq(episodeProgress.userId, user.id)))
        .where(
          and(
            isNotNull(episodes.releaseDate),
            sql`${episodes.releaseDate} >= ${since}`,
            or(sql`${episodeProgress.fullyPlayed} is null`, eq(episodeProgress.fullyPlayed, false)),
          ),
        )
        .orderBy(desc(episodes.releaseDate), episodes.name)
        .limit(limit)
      const summaries = await loadEpisodeSummaries(
        db,
        user.id,
        rows.map((row) => row.id),
      )
      return c.json({ items: rows.map((row) => summaries.get(row.id)!), syncedAt: user.showsSyncedAt?.toISOString() ?? null }, 200)
    })

    .openapi({ ...listShows, middleware: auth }, async (c) => {
      const user = c.var.user
      const followed = await db
        .select({ id: shows.id, name: shows.name, thumbUrl: shows.thumbUrl })
        .from(userShows)
        .innerJoin(shows, eq(shows.id, userShows.showId))
        .where(eq(userShows.userId, user.id))
        .orderBy(shows.name)
      const following = new Set(followed.map((show) => show.id))
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
        .where(eq(episodeListens.userId, user.id))
        .groupBy(shows.id)
        .orderBy(desc(max(episodeListens.endedAt)))
      const listened = new Set(rows.map((row) => row.id))
      return c.json(
        {
          items: [
            ...rows.map((row) => ({
              show: { id: row.id, name: row.name, thumbUrl: row.thumbUrl },
              followed: following.has(row.id),
              stats: {
                episodes: row.episodes,
                listens: row.listens,
                listenedMs: Number(row.listenedMs),
                lastListenedAt: toIso(row.lastListenedAt),
              },
            })),
            ...followed
              .filter((show) => !listened.has(show.id))
              .map((show) => ({ show, followed: true, stats: { episodes: 0, listens: 0, listenedMs: 0, lastListenedAt: null } })),
          ],
          syncedAt: user.showsSyncedAt?.toISOString() ?? null,
        },
        200,
      )
    })

    .openapi({ ...getShow, middleware: auth }, async (c) => {
      const userId = c.var.user.id
      const { id } = c.req.valid('param')
      const [show] = await db.select().from(shows).where(eq(shows.id, id))
      if (!show) return c.json({ error: 'not_found' as const }, 404)
      const [follow] = await db
        .select({ showId: userShows.showId })
        .from(userShows)
        .where(and(eq(userShows.userId, userId), eq(userShows.showId, id)))

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
          followed: Boolean(follow),
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
