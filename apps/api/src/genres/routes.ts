import { createRoute, z } from '@hono/zod-openapi'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { createRouter, errorResponses, signedIn } from '../lib/openapi.ts'
import { GenreRef, jsonResponse } from '../lib/schemas.ts'
import { genrePlayCounts } from './queries.ts'

const listGenres = createRoute({
  method: 'get',
  path: '/genres',
  tags: ['Genres'],
  operationId: 'listGenres',
  summary: 'Genres in your plays',
  description:
    "Every genre your played tracks' artists have, most played first. A play counts once for each genre its " +
    "track's artists have. Genres come from Last.fm tags, else MusicBrainz, and fill in in the background, so " +
    'recently played artists have them first.',
  security: signedIn,
  responses: {
    200: jsonResponse(
      z.object({ genres: z.array(GenreRef.extend({ playCount: z.number().int() })) }),
      'The genres, with how many of your plays fall in each.',
    ),
    ...errorResponses('unauthorized'),
  },
})

export function genreRoutes(deps: AppDeps) {
  return createRouter().openapi({ ...listGenres, middleware: requireUser(deps) }, async (c) =>
    c.json({ genres: await genrePlayCounts(deps.db, c.var.user.id) }, 200),
  )
}
