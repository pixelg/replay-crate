import { createRoute, z } from '@hono/zod-openapi'
import { schema } from '@replay-crate/db'
import { and, asc, count, eq, inArray, max, ne, sql } from 'drizzle-orm'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { loadTrackArtists } from '../history/queries.ts'
import { createRouter, errorResponses, signedIn } from '../lib/openapi.ts'
import { ArtistRef, IsoDateTime, jsonResponse, Rating } from '../lib/schemas.ts'
import { loadRatings } from '../tracks/ratings.ts'
import { spotifyErrorResponse } from '../spotify/errors.ts'
import { syncPlaylists } from '../sync/playlists.ts'

const { albums, playlistItems, playlists, plays, tracks, userPlaylists } = schema

const playlistUri = (id: string) => `spotify:playlist:${id}`

const sync = createRoute({
  method: 'post',
  path: '/playlists/sync',
  tags: ['Playlists'],
  operationId: 'syncPlaylists',
  summary: 'Sync playlists from Spotify',
  description:
    "Refreshes every playlist's details, then fetches tracks for playlists that changed, within a time " +
    'budget. Call again while `remaining > 0`.',
  security: signedIn,
  responses: {
    200: jsonResponse(
      z.object({
        total: z.number().int().openapi({ description: 'Playlists the user owns or collaborates on.' }),
        synced: z.number().int().openapi({ description: 'Playlists whose tracks were fetched in this call.' }),
        remaining: z.number().int().openapi({ description: 'Playlists still waiting for their tracks.' }),
      }),
      'Progress.',
    ),
    ...errorResponses('unauthorized', 'forbidden', 'not_found', 'reauth_required', 'rate_limited'),
  },
})

const list = createRoute({
  method: 'get',
  path: '/playlists',
  tags: ['Playlists'],
  operationId: 'listPlaylists',
  summary: 'Your playlists',
  description: 'In your Spotify order, with how often you play from each.',
  security: signedIn,
  responses: {
    200: jsonResponse(
      z.object({
        playlists: z.array(
          z
            .object({
              id: z.string(),
              name: z.string(),
              thumbUrl: z.string().nullable(),
              ownerName: z.string().nullable(),
              owned: z.boolean(),
              collaborative: z.boolean(),
              isPublic: z.boolean().nullable(),
              itemCount: z.number().int(),
              playsFrom: z.number().int().openapi({ description: 'Plays with this playlist as their context.' }),
              lastPlayedFrom: IsoDateTime.nullable(),
            })
            .openapi('PlaylistSummary'),
        ),
        syncedAt: IsoDateTime.nullable(),
      }),
      'Your playlists.',
    ),
    ...errorResponses('unauthorized'),
  },
})

const get = createRoute({
  method: 'get',
  path: '/playlists/{id}',
  tags: ['Playlists'],
  operationId: 'getPlaylist',
  summary: 'A playlist and its tracks',
  description: 'Each track with your play counts and the other playlists that hold it.',
  security: signedIn,
  request: { params: z.object({ id: z.string().min(1).openapi({ description: 'Spotify playlist id.' }) }) },
  responses: {
    200: jsonResponse(
      z.object({
        playlist: z.object({
          id: z.string(),
          name: z.string(),
          description: z.string().nullable(),
          imageUrl: z.string().nullable(),
          ownerName: z.string().nullable(),
          owned: z.boolean(),
          collaborative: z.boolean(),
          isPublic: z.boolean().nullable(),
          itemCount: z.number().int(),
          playsFrom: z.number().int(),
          itemsSynced: z.boolean().openapi({ description: 'False until the tracks have been fetched once.' }),
        }),
        items: z.array(
          z
            .object({
              position: z.number().int(),
              addedAt: IsoDateTime.nullable(),
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
              playsHere: z.number().int().openapi({ description: 'Plays from this playlist.' }),
              lastPlayedAt: IsoDateTime.nullable(),
              alsoOn: z.array(z.object({ id: z.string(), name: z.string() })),
            })
            .openapi('PlaylistTrack'),
        ),
      }),
      'The playlist.',
    ),
    ...errorResponses('unauthorized', 'not_found'),
  },
})

export function playlistRoutes(deps: AppDeps) {
  const { db } = deps
  const auth = requireUser(deps)

  return (
    createRouter()
      .openapi({ ...sync, middleware: auth }, async (c) => {
        try {
          return c.json(await syncPlaylists(deps, c.var.user.id), 200)
        } catch (error) {
          const response = spotifyErrorResponse(c, error)
          if (response) return response
          throw error
        }
      })

      .openapi({ ...list, middleware: auth }, async (c) => {
        const user = c.var.user

        const playedFrom = db
          .select({
            contextUri: plays.contextUri,
            playCount: count().as('play_count'),
            lastPlayedAt: max(plays.playedAt).as('last_played_at'),
          })
          .from(plays)
          .where(and(eq(plays.userId, user.id), eq(plays.contextType, 'playlist')))
          .groupBy(plays.contextUri)
          .as('played_from')

        const rows = await db
          .select({
            id: playlists.id,
            name: playlists.name,
            thumbUrl: playlists.thumbUrl,
            ownerId: playlists.ownerId,
            ownerName: playlists.ownerName,
            collaborative: playlists.collaborative,
            isPublic: playlists.isPublic,
            itemCount: playlists.itemCount,
            playsFrom: playedFrom.playCount,
            lastPlayedFrom: playedFrom.lastPlayedAt,
          })
          .from(userPlaylists)
          .innerJoin(playlists, eq(playlists.id, userPlaylists.playlistId))
          .leftJoin(playedFrom, eq(playedFrom.contextUri, sql`'spotify:playlist:' || ${playlists.id}`))
          .where(eq(userPlaylists.userId, user.id))
          .orderBy(asc(userPlaylists.position))

        return c.json(
          {
            playlists: rows.map((row) => ({
              id: row.id,
              name: row.name,
              thumbUrl: row.thumbUrl,
              ownerName: row.ownerName,
              owned: row.ownerId === user.id,
              collaborative: row.collaborative,
              isPublic: row.isPublic,
              itemCount: row.itemCount,
              playsFrom: Number(row.playsFrom ?? 0),
              lastPlayedFrom: toIso(row.lastPlayedFrom),
            })),
            syncedAt: user.playlistsSyncedAt?.toISOString() ?? null,
          },
          200,
        )
      })

      .openapi({ ...get, middleware: auth }, async (c) => {
        const user = c.var.user
        const { id: playlistId } = c.req.valid('param')

        const [playlist] = await db
          .select()
          .from(playlists)
          .innerJoin(
            userPlaylists,
            and(eq(userPlaylists.playlistId, playlists.id), eq(userPlaylists.userId, user.id)),
          )
          .where(eq(playlists.id, playlistId))
        if (!playlist) return c.json({ error: 'not_found' as const }, 404)
        const meta = playlist.playlists

        const items = await db
          .select({
            position: playlistItems.position,
            addedAt: playlistItems.addedAt,
            trackId: tracks.id,
            trackName: tracks.name,
            durationMs: tracks.durationMs,
            explicit: tracks.explicit,
            albumId: albums.id,
            albumName: albums.name,
            albumThumbUrl: albums.thumbUrl,
          })
          .from(playlistItems)
          .innerJoin(tracks, eq(tracks.id, playlistItems.trackId))
          .innerJoin(albums, eq(albums.id, tracks.albumId))
          .where(eq(playlistItems.playlistId, playlistId))
          .orderBy(asc(playlistItems.position))

        const trackIdsHere = db
          .select({ trackId: playlistItems.trackId })
          .from(playlistItems)
          .where(eq(playlistItems.playlistId, playlistId))

        const stats = await db
          .select({
            trackId: plays.trackId,
            playCount: count(),
            playsHere: sql<number>`count(*) filter (where ${plays.contextUri} = ${playlistUri(playlistId)})`.mapWith(
              Number,
            ),
            lastPlayedAt: max(plays.playedAt),
          })
          .from(plays)
          .where(and(eq(plays.userId, user.id), inArray(plays.trackId, trackIdsHere)))
          .groupBy(plays.trackId)
        const statsByTrack = new Map(stats.map((row) => [row.trackId, row]))

        const alsoOn = await db
          .selectDistinct({
            trackId: playlistItems.trackId,
            id: playlists.id,
            name: playlists.name,
            position: userPlaylists.position,
          })
          .from(playlistItems)
          .innerJoin(
            userPlaylists,
            and(eq(userPlaylists.playlistId, playlistItems.playlistId), eq(userPlaylists.userId, user.id)),
          )
          .innerJoin(playlists, eq(playlists.id, playlistItems.playlistId))
          .where(and(ne(playlistItems.playlistId, playlistId), inArray(playlistItems.trackId, trackIdsHere)))
          .orderBy(asc(userPlaylists.position))
        const alsoOnByTrack = new Map<string, Array<{ id: string; name: string }>>()
        for (const { trackId, id, name } of alsoOn) {
          alsoOnByTrack.set(trackId, [...(alsoOnByTrack.get(trackId) ?? []), { id, name }])
        }

        const artistsByTrack = await loadTrackArtists(
          db,
          items.map((item) => item.trackId),
        )
        const ratings = await loadRatings(
          db,
          user.id,
          items.map((item) => item.trackId),
        )
        const [playsFrom] = await db
          .select({ total: count() })
          .from(plays)
          .where(and(eq(plays.userId, user.id), eq(plays.contextUri, playlistUri(playlistId))))

        return c.json(
          {
            playlist: {
              id: meta.id,
              name: meta.name,
              description: meta.description,
              imageUrl: meta.imageUrl,
              ownerName: meta.ownerName,
              owned: meta.ownerId === user.id,
              collaborative: meta.collaborative,
              isPublic: meta.isPublic,
              itemCount: meta.itemCount,
              playsFrom: playsFrom?.total ?? 0,
              itemsSynced: meta.itemsSnapshotId != null,
            },
            items: items.map((item) => {
              const trackStats = statsByTrack.get(item.trackId)
              return {
                position: item.position,
                addedAt: item.addedAt?.toISOString() ?? null,
                track: {
                  id: item.trackId,
                  name: item.trackName,
                  durationMs: item.durationMs,
                  explicit: item.explicit,
                  album: { id: item.albumId, name: item.albumName, thumbUrl: item.albumThumbUrl },
                  artists: artistsByTrack.get(item.trackId) ?? [],
                  rating: ratings.get(item.trackId) ?? null,
                },
                playCount: trackStats?.playCount ?? 0,
                playsHere: trackStats?.playsHere ?? 0,
                lastPlayedAt: toIso(trackStats?.lastPlayedAt),
                alsoOn: alsoOnByTrack.get(item.trackId) ?? [],
              }
            }),
          },
          200,
        )
      })
  )
}

/** Aggregates can come back as Date or string depending on the driver. */
function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  return (value instanceof Date ? value : new Date(value)).toISOString()
}
