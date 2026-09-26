import { createRoute, z } from '@hono/zod-openapi'
import { describeFilter, ENTITY_TYPES, formatFilter, parseSearchQuery, type EntityType } from '@replay-crate/core'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { createRouter, errorResponses, signedIn } from '../lib/openapi.ts'
import { IsoDateTime, jsonResponse, Rating } from '../lib/schemas.ts'

const EntityTypeSchema = z.enum(ENTITY_TYPES).openapi('SearchType')
const Range = z.tuple([z.number().int(), z.number().int()]).openapi({ description: '[start, end) character offsets.' })

const SearchHit = z
  .object({
    type: EntityTypeSchema,
    id: z.string().openapi({ description: 'Spotify id; for a play, its id in the history.' }),
    name: z.string().openapi({ description: "The track's, artist's, album's or playlist's name; a play's track name." }),
    artists: z.array(z.string()).openapi({ description: "A track's, album's or play's artists; a playlist's owner." }),
    album: z.string().nullable(),
    year: z.number().int().nullable(),
    playCount: z.number().int().openapi({ description: 'Your plays: of the track, the artist, the album, or from the playlist.' }),
    rating: Rating,
    lastPlayedAt: IsoDateTime.nullable(),
    playedAt: IsoDateTime.nullable().openapi({ description: 'When the play happened (plays only).' }),
    context: z.string().nullable().openapi({ description: 'Where the play was played from (plays only).' }),
    imageUrl: z.string().nullable(),
    trackId: z.string().nullable().openapi({ description: 'The track a play is of.' }),
    score: z.number().openapi({ description: "How well it matched. Comparable within one response, not across engines." }),
    highlights: z.object({
      name: z.array(Range),
      artists: z.array(z.array(Range)).openapi({ description: 'Per entry of `artists`.' }),
    }),
  })
  .openapi('SearchHit')

const Bucket = <T extends z.ZodType>(value: T) => z.object({ value, count: z.number().int() })

const SearchResponse = z
  .object({
    query: z.object({
      text: z.string().openapi({ description: 'The free text, without filters.' }),
      filters: z.array(
        z.object({
          token: z.string().openapi({ example: 'rating:>=4', description: 'As it would be typed.' }),
          label: z.string().openapi({ example: 'Rating: 4★ or more', description: 'In words, for a chip.' }),
          start: z.number().int().openapi({ description: 'Where it sits in `q`, so a chip can remove it.' }),
          end: z.number().int(),
        }),
      ),
      issues: z.array(
        z.object({
          kind: z.enum(['unknown-field', 'bad-value', 'unclosed-quote']),
          message: z.string(),
          start: z.number().int(),
          end: z.number().int(),
        }),
      ),
    }),
    engine: z.enum(['elasticsearch', 'postgres']),
    tookMs: z.number().int(),
    total: z.number().int(),
    groups: z.array(z.object({ type: EntityTypeSchema, total: z.number().int(), hits: z.array(SearchHit) })),
    facets: z
      .object({
        types: z.array(Bucket(EntityTypeSchema)),
        decades: z.array(Bucket(z.number().int())).openapi({ description: 'By first year: 1990 is the 90s.' }),
        ratings: z.array(Bucket(z.number().int())),
        artists: z.array(Bucket(z.string())),
        contexts: z.array(Bucket(z.string())),
      })
      .optional()
      .openapi({ description: 'With `facets=true`. Types count everything; the rest the tracks (or the one type asked for).' }),
    suggestion: z.string().nullable().openapi({ description: 'When nothing matched: something close in your library.' }),
  })
  .openapi('SearchResponse')

const TYPES_PATTERN = new RegExp(`^(${ENTITY_TYPES.join('|')})(,(${ENTITY_TYPES.join('|')}))*$`)

const searchRoute = createRoute({
  method: 'get',
  path: '/search',
  tags: ['Search'],
  operationId: 'search',
  summary: 'Search your library',
  description:
    'Tracks, artists, albums, playlists and plays in your library, grouped by type, as you type. `q` is free text ' +
    '(typo-tolerant, matched at word starts) plus filters: `artist:` `album:` `in:` (playlist) `from:` ' +
    '(played from) `rating:` `plays:` `year:` `type:`, with comparisons (`rating:>=4`), ranges ' +
    '(`year:1990..1995`), decades (`year:90s`), quotes, and `-` to exclude. Ranked by match, then your plays and ratings.',
  security: signedIn,
  request: {
    query: z.object({
      q: z.string().max(200).openapi({ example: 'pete rock rating:>=4' }),
      types: z
        .string()
        .regex(TYPES_PATTERN)
        .optional()
        .openapi({ example: 'track,artist', description: `Comma-separated: ${ENTITY_TYPES.join(', ')}. Default: all.` }),
      limit: z.coerce.number().int().min(1).max(50).default(5).openapi({ description: 'Hits per group.' }),
      offset: z.coerce.number().int().min(0).max(10_000).default(0).openapi({ description: 'Hits to skip in each group.' }),
      facets: z.enum(['true', 'false']).default('false'),
    }),
  },
  responses: {
    200: jsonResponse(SearchResponse, 'Matches, grouped by type.'),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

export function searchRoutes(deps: AppDeps) {
  const auth = requireUser(deps)
  return createRouter().openapi({ ...searchRoute, middleware: auth }, async (c) => {
    const { q, types, limit, offset, facets } = c.req.valid('query')
    const started = performance.now()
    const query = parseSearchQuery(q)
    const result = await deps.search.search(c.var.user.id, query, {
      types: types ? (types.split(',') as EntityType[]) : undefined,
      limit,
      offset,
      facets: facets === 'true',
    })
    return c.json(
      {
        query: {
          text: query.text,
          filters: query.filters.map((filter) => ({
            token: formatFilter(filter),
            label: describeFilter(filter),
            start: filter.span[0],
            end: filter.span[1],
          })),
          issues: query.issues.map((issue) => ({ kind: issue.kind, message: issue.message, start: issue.span[0], end: issue.span[1] })),
        },
        engine: deps.search.engine,
        tookMs: Math.round(performance.now() - started),
        total: result.total,
        groups: result.groups.map((group) => ({
          type: group.type,
          total: group.total,
          hits: group.hits.map((hit) => ({
            type: hit.type,
            id: hit.id,
            name: hit.name,
            artists: hit.artists,
            album: hit.album,
            year: hit.year,
            playCount: hit.playCount,
            rating: hit.rating,
            lastPlayedAt: hit.lastPlayedAt,
            playedAt: hit.playedAt,
            context: hit.type === 'play' ? (hit.contexts[0] ?? null) : null,
            imageUrl: hit.imageUrl,
            trackId: hit.trackId,
            score: hit.score,
            highlights: hit.highlights,
          })),
        })),
        ...(result.facets && { facets: result.facets }),
        suggestion: result.suggestion,
      },
      200,
    )
  })
}
