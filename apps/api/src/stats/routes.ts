import { Hono } from 'hono'
import { z } from 'zod'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { validate } from '../lib/validate.ts'
import { spotifyErrorResponse } from '../spotify/errors.ts'
import { overview } from './overview.ts'
import { range, timeZone } from './ranges.ts'
import { spotifyTop } from './spotify-top.ts'
import { top } from './top.ts'

export function statsRoutes(deps: AppDeps) {
  const auth = requireUser(deps)
  const now = deps.now ?? (() => new Date())

  return (
    new Hono()
      /** Totals and the "listening over time" series (new tracks vs replays). */
      .get(
        '/stats/overview',
        auth,
        validate('query', z.object({ range: range.default('30d'), tz: timeZone.default('UTC') })),
        async (c) => {
          const { range: r, tz } = c.req.valid('query')
          return c.json(await overview(deps.db, c.get('user').id, { range: r, tz, now: now() }), 200)
        },
      )

      .get(
        '/stats/top',
        auth,
        validate(
          'query',
          z.object({
            type: z.enum(['tracks', 'artists', 'albums']).default('tracks'),
            range: range.default('30d'),
            metric: z.enum(['plays', 'minutes']).default('plays'),
            limit: z.coerce.number().int().min(1).max(50).default(10),
          }),
        ),
        async (c) => {
          const query = c.req.valid('query')
          const items = await top(deps.db, c.get('user').id, { ...query, now: now() })
          return c.json({ ...query, items }, 200)
        },
      )

      /** Spotify's own ranking, to compare with ours. */
      .get(
        '/stats/spotify-top',
        auth,
        validate(
          'query',
          z.object({
            type: z.enum(['tracks', 'artists']).default('tracks'),
            timeRange: z.enum(['short_term', 'medium_term', 'long_term']).default('short_term'),
          }),
        ),
        async (c) => {
          const query = c.req.valid('query')
          try {
            return c.json({ ...query, items: await spotifyTop(deps, c.get('user').id, query) }, 200)
          } catch (error) {
            const response = spotifyErrorResponse(c, error)
            if (response) return response
            throw error
          }
        },
      )
  )
}
