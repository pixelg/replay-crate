import { createRoute, z } from '@hono/zod-openapi'
import { schema } from '@replay-crate/db'
import { and, count, desc, eq, gte, lt, max, sql } from 'drizzle-orm'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { createRouter, errorResponses, invalidRequest, signedIn } from '../lib/openapi.ts'
import { IsoDateTime, jsonResponse } from '../lib/schemas.ts'
import { ListenItem, loadEpisodeSummaries, ShowRef } from '../podcasts/present.ts'
import { listenMonths } from '../stats/podcasts.ts'
import { timeZone } from '../stats/ranges.ts'

const { episodeListens, episodes, shows } = schema

const listListens = createRoute({
  method: 'get',
  path: '/history/listens',
  tags: ['History'],
  operationId: 'listListens',
  summary: 'Podcast listening history',
  description:
    'Episode listens, the most recently ended first. Pass `nextCursor` back as `before` for older ones, or `offset` ' +
    'for numbered pages (which also returns `total`), not both. `show` keeps only listens of that show, and ' +
    '`since` / `until` only listens that ended in that stretch of time.',
  security: signedIn,
  request: {
    query: z.object({
      before: IsoDateTime.optional().openapi({ description: 'Only listens that ended strictly before this.' }),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).optional().openapi({ description: 'Listens to skip, for numbered pages.' }),
      show: z.string().min(1).optional().openapi({ description: 'Only listens of this show (Spotify show id).' }),
      since: IsoDateTime.optional().openapi({ description: 'Only listens that ended at or after this time.' }),
      until: IsoDateTime.optional().openapi({ description: 'Only listens that ended strictly before this time.' }),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        items: z.array(ListenItem),
        nextCursor: IsoDateTime.nullable().openapi({ description: 'Where the next page starts; null on the last page.' }),
        total: z.number().int().optional().openapi({ description: 'All listens matching the filters. With `offset` only.' }),
      }),
      'A page of listens.',
    ),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

const listListenedShows = createRoute({
  method: 'get',
  path: '/history/listens/shows',
  tags: ['History'],
  operationId: 'listListenedShows',
  summary: 'Shows in the listening history',
  description: 'Every show the user has listened to, with how many listens it has, most listened first: the choices for `show`.',
  security: signedIn,
  responses: {
    200: jsonResponse(
      z.object({ shows: z.array(ShowRef.extend({ listens: z.number().int() }).openapi('ListenedShow')) }),
      'Listened shows.',
    ),
    ...errorResponses('unauthorized'),
  },
})

const getListensTimeline = createRoute({
  method: 'get',
  path: '/history/listens/timeline',
  tags: ['History'],
  operationId: 'getListensTimeline',
  summary: 'Podcast listens per month',
  description: 'How many listens ended in each calendar month of `tz`, newest first; months without listens are left out.',
  security: signedIn,
  request: {
    query: z.object({ tz: timeZone.default('UTC').openapi({ description: 'IANA time zone for month boundaries.', example: 'Europe/Berlin' }) }),
  },
  responses: {
    200: jsonResponse(
      z.object({ months: z.array(z.object({ month: z.string().openapi({ example: '2019-03' }), listens: z.number().int() })) }),
      'Months with listens.',
    ),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

export function listenRoutes(deps: AppDeps) {
  const { db } = deps
  const auth = requireUser(deps)

  return createRouter()
    .openapi({ ...getListensTimeline, middleware: auth }, async (c) =>
      c.json({ months: await listenMonths(db, c.var.user.id, c.req.valid('query').tz) }, 200),
    )

    .openapi({ ...listListenedShows, middleware: auth }, async (c) => {
      const rows = await db
        .select({ id: shows.id, name: shows.name, thumbUrl: shows.thumbUrl, listens: count(), last: max(episodeListens.endedAt) })
        .from(episodeListens)
        .innerJoin(episodes, eq(episodes.id, episodeListens.episodeId))
        .innerJoin(shows, eq(shows.id, episodes.showId))
        .where(eq(episodeListens.userId, c.var.user.id))
        .groupBy(shows.id)
        .orderBy(desc(count()), desc(max(episodeListens.endedAt)))
      return c.json({ shows: rows.map(({ id, name, thumbUrl, listens }) => ({ id, name, thumbUrl, listens })) }, 200)
    })

    .openapi({ ...listListens, middleware: auth }, async (c) => {
      const userId = c.var.user.id
      const { before, limit, offset, show, since, until } = c.req.valid('query')
      if (before !== undefined && offset !== undefined) {
        return c.json(invalidRequest({ issues: [{ path: ['offset'], message: 'Pass either before or offset, not both' }] }), 400)
      }
      const mine = and(
        eq(episodeListens.userId, userId),
        show
          ? sql`${episodeListens.episodeId} in (select ${episodes.id} from ${episodes} where ${episodes.showId} = ${show})`
          : undefined,
        since ? gte(episodeListens.endedAt, new Date(since)) : undefined,
        until ? lt(episodeListens.endedAt, new Date(until)) : undefined,
      )
      const rows = await db
        .select()
        .from(episodeListens)
        .where(and(mine, before ? lt(episodeListens.endedAt, new Date(before)) : undefined))
        .orderBy(desc(episodeListens.endedAt), desc(episodeListens.id))
        .limit(limit + 1)
        .offset(offset ?? 0)
      const page = rows.slice(0, limit)
      const summaries = await loadEpisodeSummaries(
        db,
        userId,
        page.map((row) => row.episodeId),
      )
      return c.json(
        {
          items: page.map((row) => ({
            id: row.id,
            startedAt: row.startedAt.toISOString(),
            endedAt: row.endedAt.toISOString(),
            listenedMs: row.listenedMs,
            startPositionMs: row.startPositionMs,
            endPositionMs: row.endPositionMs,
            source: row.source,
            // episode_id is a foreign key, so every listen's episode is there.
            episode: summaries.get(row.episodeId)!,
          })),
          nextCursor: rows.length > limit ? page.at(-1)!.endedAt.toISOString() : null,
          ...(offset !== undefined && { total: (await db.select({ n: count() }).from(episodeListens).where(mine))[0]?.n ?? 0 }),
        },
        200,
      )
    })
}
