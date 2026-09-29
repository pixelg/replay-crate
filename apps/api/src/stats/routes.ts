import { createRoute, z } from '@hono/zod-openapi'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { createRouter, errorResponses, invalidRequest, signedIn } from '../lib/openapi.ts'
import { jsonResponse, Rating } from '../lib/schemas.ts'
import { spotifyErrorResponse } from '../spotify/errors.ts'
import { calendarDays, yearsWithPlays } from './calendar.ts'
import { overview } from './overview.ts'
import { localDay, period, range, timeZone, type Range, type Span } from './ranges.ts'
import { spotifyTop } from './spotify-top.ts'
import { top } from './top.ts'

const Range = range.openapi('StatsRange', { description: 'A rolling window ending now. `30d` unless `period` is given.' })
const Period = period.openapi('StatsPeriod', {
  description: 'A calendar year (`2019`) or month (`2019-03`), in local days of `tz`. Not with `range`.',
  example: '2019-03',
})
const Tz = timeZone.default('UTC').openapi({ description: 'IANA time zone for day boundaries.', example: 'America/Los_Angeles' })
/** Echoes what the numbers cover: the query's `range` (or the default) or its `period`. */
const Scope = { range: Range.optional(), period: Period.optional() }

const Listening = z.object({ plays: z.number().int(), minutes: z.number().int() }).openapi('Listening')

const getOverview = createRoute({
  method: 'get',
  path: '/stats/overview',
  tags: ['Stats'],
  operationId: 'getStatsOverview',
  summary: 'Totals and listening over time',
  description:
    "Each point splits plays into new tracks (a track's first-ever play) and replays, and by artist: the " +
    "span's top 5 artists by plays (first-credited artist) and everyone else, in plays and minutes. Spans over 90 days " +
    "(a year, all time) are bucketed by week, shorter ones (a month) by day, in the user's time zone; empty buckets are " +
    'zeros. A period still going ends at today.',
  security: signedIn,
  request: {
    query: z.object({ ...Scope, tz: Tz }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        ...Scope,
        tz: z.string(),
        bucket: z.enum(['day', 'week']),
        totals: z.object({
          plays: z.number().int(),
          minutes: z.number().int(),
          tracks: z.number().int(),
          artists: z.number().int(),
          newTracks: z.number().int(),
        }),
        artists: z
          .array(z.object({ id: z.string(), name: z.string(), ...Listening.shape }))
          .openapi({ description: "The span's top artists by plays (not time), most first." }),
        series: z.array(
          z.object({
            date: z.string().openapi({ description: 'Bucket start, YYYY-MM-DD.' }),
            newTracks: z.number().int(),
            replays: z.number().int(),
            minutes: z.number().int(),
            byArtist: z.array(Listening).openapi({ description: 'Per artist in `artists`, same order.' }),
            others: Listening.openapi({ description: 'Everyone else.' }),
          }),
        ),
        openGaps: z.number().int().openapi({ description: 'Unfilled history gaps reaching into the span.' }),
      }),
      'The overview.',
    ),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

const TopQuery = z.object({
  type: z.enum(['tracks', 'artists', 'albums']).default('tracks'),
  ...Scope,
  tz: Tz,
  metric: z.enum(['plays', 'minutes']).default('plays'),
  limit: z.coerce.number().int().min(1).max(50).default(10),
})

const getTop = createRoute({
  method: 'get',
  path: '/stats/top',
  tags: ['Stats'],
  operationId: 'getStatsTop',
  summary: 'Most played tracks, artists or albums',
  description:
    'Ranked by play count or listening time, over a rolling `range` or a calendar `period`. Plays without a known ' +
    'duration count the track length.',
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
              rating: Rating.openapi({ description: 'For tracks; always null for artists and albums.' }),
            })
            .openapi('TopItem'),
        ),
      }),
      'The ranking, echoing the query.',
    ),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

const getCalendar = createRoute({
  method: 'get',
  path: '/stats/calendar',
  tags: ['Stats'],
  operationId: 'getStatsCalendar',
  summary: 'Plays per day for a year',
  description: "For a calendar heatmap: the year's days that have plays, in the user's time zone, and every year that has plays.",
  security: signedIn,
  request: {
    query: z.object({
      year: z.coerce.number().int().min(1900).max(9999).optional().openapi({ description: 'Defaults to the current year.', example: 2023 }),
      tz: timeZone.default('UTC').openapi({ description: 'IANA time zone for day boundaries.', example: 'America/Los_Angeles' }),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        year: z.number().int(),
        tz: z.string(),
        years: z.array(z.number().int()).openapi({ description: 'Every year with plays, oldest first.' }),
        days: z
          .array(z.object({ date: z.string().openapi({ description: 'YYYY-MM-DD.' }), plays: z.number().int() }))
          .openapi({ description: 'Days with plays, oldest first; the rest had none.' }),
      }),
      'Daily play counts.',
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
  description:
    "Spotify's ranking, next to the plays Replay Crate has recorded for each (all time), for comparison. Spotify only " +
    'offers its own fixed windows: there is no range or period here.',
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

/** What a query covers: its period, or its rolling range (30 days by default). Null when it names both. */
function spanOf({ range, period }: { range?: Range; period?: string }): Span | null {
  if (range !== undefined && period !== undefined) return null
  return period === undefined ? { range: range ?? '30d' } : { period }
}
const bothGiven = () => invalidRequest({ issues: [{ path: ['period'], message: 'Pass either range or period, not both' }] })

export function statsRoutes(deps: AppDeps) {
  const auth = requireUser(deps)
  const now = deps.now ?? (() => new Date())

  return createRouter()
    .openapi({ ...getOverview, middleware: auth }, async (c) => {
      const query = c.req.valid('query')
      const span = spanOf(query)
      if (!span) return c.json(bothGiven(), 400)
      return c.json(await overview(deps.db, c.var.user.id, { span, tz: query.tz, now: now() }), 200)
    })

    .openapi({ ...getTop, middleware: auth }, async (c) => {
      const { type, range, period, tz, metric, limit } = c.req.valid('query')
      const span = spanOf({ range, period })
      if (!span) return c.json(bothGiven(), 400)
      const items = await top(deps.db, c.var.user.id, { type, span, tz, metric, limit, now: now() })
      return c.json({ type, ...span, tz, metric, limit, items }, 200)
    })

    .openapi({ ...getCalendar, middleware: auth }, async (c) => {
      const { tz, ...query } = c.req.valid('query')
      const userId = c.var.user.id
      const year = query.year ?? Number(localDay(now(), tz).slice(0, 4))
      const [days, years] = await Promise.all([calendarDays(deps.db, userId, { year, tz }), yearsWithPlays(deps.db, userId, tz)])
      return c.json({ year, tz, years, days }, 200)
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
