import { createRoute, z } from '@hono/zod-openapi'
import { schema } from '@replay-crate/db'
import { and, asc, count, desc, eq, max, min } from 'drizzle-orm'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { loadTrackArtists, toContext } from '../history/queries.ts'
import { createRouter, errorResponses, invalidRequest, signedIn } from '../lib/openapi.ts'
import { ArtistRef, ContextRef, IsoDateTime, jsonBody, jsonResponse, Rating } from '../lib/schemas.ts'
import { spotifyErrorResponse } from '../spotify/errors.ts'
import { clearRating, loadRatings, rateTrack } from './ratings.ts'
import { decodeCursor, listTracks, TRACK_SORTS } from './library.ts'

const { albums, contexts, playlistItems, playlists, plays, tracks, userPlaylists } = schema

const TrackDetail = z
  .object({
    track: z.object({
      id: z.string(),
      name: z.string(),
      durationMs: z.number().int(),
      explicit: z.boolean(),
      album: z.object({
        id: z.string(),
        name: z.string(),
        imageUrl: z.string().nullable(),
        releaseDate: z.string().nullable().openapi({ description: "Spotify's precision: YYYY, YYYY-MM or YYYY-MM-DD." }),
      }),
      artists: z.array(ArtistRef),
      rating: Rating,
    }),
    stats: z.object({
      playCount: z.number().int(),
      firstPlayedAt: IsoDateTime.nullable(),
      lastPlayedAt: IsoDateTime.nullable(),
    }),
    playedFrom: z.array(
      z.object({ context: ContextRef.nullable(), playCount: z.number().int(), lastPlayedAt: IsoDateTime.nullable() }),
    ),
    recentPlays: z.array(z.object({ playedAt: IsoDateTime, context: ContextRef.nullable() })),
    playlists: z
      .array(z.object({ id: z.string(), name: z.string(), thumbUrl: z.string().nullable() }))
      .openapi({ description: "The user's playlists holding this track, in their Spotify order." }),
  })
  .openapi('TrackDetail')

const LibraryTrack = z
  .object({
    track: z.object({
      id: z.string(),
      name: z.string(),
      durationMs: z.number().int(),
      explicit: z.boolean(),
      album: z.object({ id: z.string(), name: z.string(), thumbUrl: z.string().nullable() }),
      artists: z.array(ArtistRef),
      rating: Rating,
    }),
    playCount: z.number().int(),
    firstPlayedAt: IsoDateTime,
    lastPlayedAt: IsoDateTime,
  })
  .openapi('LibraryTrack')

const listLibrary = createRoute({
  method: 'get',
  path: '/tracks',
  tags: ['Tracks'],
  operationId: 'listTracks',
  summary: 'Every track you have played',
  description:
    'With play counts, last plays and ratings. `plays`, `last_played` and `rating` sort highest and newest first ' +
    '(unrated tracks last), `name` A–Z. `minRating` keeps only tracks rated that many stars or more. ' +
    'Pass `nextCursor` back as `cursor` for the next page (with the same `sort` and `minRating`), or pass ' +
    '`offset` for numbered pages. Not both at once.',
  security: signedIn,
  request: {
    query: z.object({
      sort: z.enum(TRACK_SORTS).default('plays'),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      minRating: z.coerce.number().int().min(1).max(5).optional().openapi({ description: 'Only tracks rated at least this.' }),
      cursor: z
        .string()
        .optional()
        .transform((value, ctx) => {
          if (value === undefined) return null
          const cursor = decodeCursor(value)
          if (!cursor) ctx.addIssue({ code: 'custom', message: 'Not a cursor from this endpoint' })
          return cursor
        })
        .openapi({ type: 'string', description: 'The previous page\'s `nextCursor`.' }),
      offset: z.coerce.number().int().min(0).optional().openapi({ description: 'Tracks to skip, for numbered pages.' }),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        items: z.array(LibraryTrack),
        nextCursor: z.string().nullable().openapi({ description: 'null on the last page.' }),
        total: z.number().int().openapi({ description: 'Tracks across all pages (matching `minRating`, if given).' }),
      }),
      'A page of tracks.',
    ),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

const TrackParams = z.object({ id: z.string().min(1).openapi({ description: 'Spotify track id.' }) })

const rate = createRoute({
  method: 'put',
  path: '/tracks/{id}/rating',
  tags: ['Tracks'],
  operationId: 'rateTrack',
  summary: 'Rate a track',
  description:
    "1 to 5 stars, replacing any earlier rating. A track the app hasn't seen yet is fetched from Spotify first.",
  security: signedIn,
  request: { params: TrackParams, body: jsonBody(z.object({ rating: z.number().int().min(1).max(5) })) },
  responses: {
    200: jsonResponse(z.object({ rating: z.number().int().min(1).max(5) }), 'Rated.'),
    ...errorResponses('invalid_request', 'unauthorized', 'forbidden', 'not_found', 'reauth_required', 'rate_limited'),
  },
})

const unrate = createRoute({
  method: 'delete',
  path: '/tracks/{id}/rating',
  tags: ['Tracks'],
  operationId: 'clearTrackRating',
  summary: 'Clear a rating',
  description: 'Back to unrated. Clearing an unrated track is fine too.',
  security: signedIn,
  request: { params: TrackParams },
  responses: { 204: { description: 'Unrated.' }, ...errorResponses('invalid_request', 'unauthorized') },
})

const getTrack = createRoute({
  method: 'get',
  path: '/tracks/{id}',
  tags: ['Tracks'],
  operationId: 'getTrack',
  summary: 'A track with your play stats',
  description: 'Where you played it from, recent plays, and which of your playlists hold it.',
  security: signedIn,
  request: { params: TrackParams },
  responses: { 200: jsonResponse(TrackDetail, 'The track.'), ...errorResponses('unauthorized', 'not_found') },
})

export function trackRoutes(deps: AppDeps) {
  const { db } = deps
  const auth = requireUser(deps)

  return createRouter()
    .openapi({ ...listLibrary, middleware: auth }, async (c) => {
      const { sort, limit, cursor, minRating, offset } = c.req.valid('query')
      if (cursor && offset !== undefined) {
        return c.json(invalidRequest({ issues: [{ path: ['offset'], message: 'Pass either cursor or offset, not both' }] }), 400)
      }
      return c.json(await listTracks(db, c.var.user.id, { sort, limit, cursor, minRating, offset }), 200)
    })
    .openapi({ ...rate, middleware: auth }, async (c) => {
      const { id } = c.req.valid('param')
      const { rating } = c.req.valid('json')
      try {
        await rateTrack(deps, c.var.user.id, id, rating)
      } catch (error) {
        const response = spotifyErrorResponse(c, error)
        if (response) return response
        throw error
      }
      return c.json({ rating }, 200)
    })
    .openapi({ ...unrate, middleware: auth }, async (c) => {
      await clearRating(db, c.var.user.id, c.req.valid('param').id)
      return c.body(null, 204)
    })
    .openapi({ ...getTrack, middleware: auth }, async (c) => {
      const user = c.var.user
      const { id: trackId } = c.req.valid('param')

      const [track] = await db
        .select({
          id: tracks.id,
          name: tracks.name,
          durationMs: tracks.durationMs,
          explicit: tracks.explicit,
          albumId: albums.id,
          albumName: albums.name,
          albumImageUrl: albums.imageUrl,
          releaseDate: albums.releaseDate,
        })
        .from(tracks)
        .innerJoin(albums, eq(tracks.albumId, albums.id))
        .where(eq(tracks.id, trackId))
      if (!track) return c.json({ error: 'not_found' as const }, 404)

      const mine = and(eq(plays.userId, user.id), eq(plays.trackId, trackId))

      const [stats] = await db
        .select({ playCount: count(), firstPlayedAt: min(plays.playedAt), lastPlayedAt: max(plays.playedAt) })
        .from(plays)
        .where(mine)

      const playedFrom = await db
        .select({
          contextType: plays.contextType,
          contextUri: plays.contextUri,
          contextName: contexts.name,
          contextImageUrl: contexts.imageUrl,
          playCount: count(),
          lastPlayedAt: max(plays.playedAt),
        })
        .from(plays)
        .leftJoin(contexts, eq(plays.contextUri, contexts.uri))
        .where(mine)
        .groupBy(plays.contextType, plays.contextUri, contexts.name, contexts.imageUrl)
        .orderBy(desc(count()), desc(max(plays.playedAt)))

      const recent = await db
        .select({
          playedAt: plays.playedAt,
          contextType: plays.contextType,
          contextUri: plays.contextUri,
          contextName: contexts.name,
          contextImageUrl: contexts.imageUrl,
        })
        .from(plays)
        .leftJoin(contexts, eq(plays.contextUri, contexts.uri))
        .where(mine)
        .orderBy(desc(plays.playedAt))
        .limit(20)

      const artists = (await loadTrackArtists(db, [trackId])).get(trackId) ?? []

      const onPlaylists = await db
        .selectDistinct({
          id: playlists.id,
          name: playlists.name,
          thumbUrl: playlists.thumbUrl,
          position: userPlaylists.position,
        })
        .from(playlistItems)
        .innerJoin(
          userPlaylists,
          and(eq(userPlaylists.playlistId, playlistItems.playlistId), eq(userPlaylists.userId, user.id)),
        )
        .innerJoin(playlists, eq(playlists.id, playlistItems.playlistId))
        .where(eq(playlistItems.trackId, trackId))
        .orderBy(asc(userPlaylists.position))

      return c.json(
        {
          track: {
            id: track.id,
            name: track.name,
            durationMs: track.durationMs,
            explicit: track.explicit,
            album: {
              id: track.albumId,
              name: track.albumName,
              imageUrl: track.albumImageUrl,
              releaseDate: track.releaseDate,
            },
            artists,
            rating: (await loadRatings(db, user.id, [trackId])).get(trackId) ?? null,
          },
          stats: {
            playCount: stats?.playCount ?? 0,
            firstPlayedAt: toIso(stats?.firstPlayedAt),
            lastPlayedAt: toIso(stats?.lastPlayedAt),
          },
          playedFrom: playedFrom.map((row) => ({
            context: toContext(row),
            playCount: row.playCount,
            lastPlayedAt: toIso(row.lastPlayedAt),
          })),
          recentPlays: recent.map((row) => ({ playedAt: row.playedAt.toISOString(), context: toContext(row) })),
          playlists: onPlaylists.map(({ id, name, thumbUrl }) => ({ id, name, thumbUrl })),
        },
        200,
      )
  })
}

/** Aggregates come back as Date from Postgres drivers, but guard against string/null. */
function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

