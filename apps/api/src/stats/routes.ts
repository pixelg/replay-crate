import { createRoute, z } from '@hono/zod-openapi'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { createRouter, errorResponses, signedIn } from '../lib/openapi.ts'
import { jsonResponse } from '../lib/schemas.ts'
import { spotifyErrorResponse } from '../spotify/errors.ts'
import { overview } from './overview.ts'
import { range, timeZone } from './ranges.ts'
import { spotifyTop } from './spotify-top.ts'
import { top } from './top.ts'

const Range = range.openapi('StatsRange', { description: 'A rolling window ending now.' })

const getOverview = createRoute({
  method: 'get',
  path: '/stats/overview',
  tags: ['Stats'],
  operationId: 'getStatsOverview',
  summary: 'Totals and listening over time',
  description:
    "Each point splits plays into new tracks (a track's first-ever play) and replays. Ranges over 90 days " +
    "are bucketed by week, shorter ones by day, in the user's time zone; empty buckets are zeros.",
  security: signedIn,
  request: {
    query: z.object({
      range: Range.default('30d'),
      tz: timeZone.default('UTC').openapi({ description: 'IANA time zone for day boundaries.', example: 'America/Los_Angeles' }),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        range: Range,
        tz: z.string(),
        bucket: z.enum(['day', 'week']),
        totals: z.object({
          plays: z.number().int(),
          minutes: z.number().int(),
          tracks: z.number().int(),
          artists: z.number().int(),
          newTracks: z.number().int(),
        }),
        series: z.array(
          z.object({
            date: z.string().openapi({ description: 'Bucket start, YYYY-MM-DD.' }),
            newTracks: z.number().int(),
            replays: z.number().int(),
            minutes: z.number().int(),
          }),
        ),
        openGaps: z.number().int().openapi({ description: 'Unfilled history gaps in the range.' }),
      }),
      'The overview.',
    ),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

const TopQuery = z.object({
  type: z.enum(['tracks', 'artists', 'albums']).default('tracks'),
  range: Range.default('30d'),
  metric: z.enum(['plays', 'minutes']).default('plays'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})

const getTop = createRoute({
  method: 'get',
  path: '/stats/top',
  tags: ['Stats'],
  operationId: 'getStatsTop',
  summary: 'Most played tracks, artists or albums',
  description: 'Ranked by play count or listening time. Plays without a known duration count the track length.',
  security: signedIn,
  request: { query: TopQuery },
  responses: {
    200: jsonResponse(
      TopQuery.extend({
        items: z.array(
          z
            .object({
              rank: z.number().int(),
              id: z.string(),
              name: z.string(),
              subtitle: z.string().nullable().openapi({ description: 'Artists, for tracks and albums.' }),
              imageUrl: z.string().nullable(),
              plays: z.number().int(),
              minutes: z.number().int(),
            })
            .openapi('TopItem'),
        ),
      }),
      'The ranking, echoing the query.',
    ),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

const SpotifyTopQuery = z.object({
  type: z.enum(['tracks', 'artists']).default('tracks'),
  timeRange: z.enum(['short_term', 'medium_term', 'long_term']).default('short_term').openapi({
    description: "Spotify's windows: about 4 weeks, 6 months, or a year.",
  }),
})

const getSpotifyTop = createRoute({
  method: 'get',
  path: '/stats/spotify-top',
  tags: ['Stats'],
  operationId: 'getSpotifyTop',
  summary: "Spotify's own top tracks or artists",
  description: "Spotify's ranking, next to the plays Replay Crate has recorded for each, for comparison.",
  security: signedIn,
  request: { query: SpotifyTopQuery },
  responses: {
    200: jsonResponse(
      SpotifyTopQuery.extend({
        items: z.array(
          z
            .object({
              rank: z.number().int(),
              id: z.string(),
              name: z.string(),
              subtitle: z.string().nullable(),
              imageUrl: z.string().nullable(),
              plays: z.number().int().openapi({ description: 'Plays Replay Crate has recorded.' }),
            })
            .openapi('SpotifyTopItem'),
        ),
      }),
      "Spotify's ranking, echoing the query.",
    ),
    ...errorResponses('invalid_request', 'unauthorized', 'forbidden', 'not_found', 'reauth_required', 'rate_limited'),
  },
})

export function statsRoutes(deps: AppDeps) {
  const auth = requireUser(deps)
  const now = deps.now ?? (() => new Date())

  return createRouter()
    .openapi({ ...getOverview, middleware: auth }, async (c) => {
      const { range: r, tz } = c.req.valid('query')
      return c.json(await overview(deps.db, c.var.user.id, { range: r, tz, now: now() }), 200)
    })

    .openapi({ ...getTop, middleware: auth }, async (c) => {
      const query = c.req.valid('query')
      const items = await top(deps.db, c.var.user.id, { ...query, now: now() })
      return c.json({ ...query, items }, 200)
    })

    .openapi({ ...getSpotifyTop, middleware: auth }, async (c) => {
      const query = c.req.valid('query')
      try {
        return c.json({ ...query, items: await spotifyTop(deps, c.var.user.id, query) }, 200)
      } catch (error) {
        const response = spotifyErrorResponse(c, error)
        if (response) return response
        throw error
      }
    })
}
