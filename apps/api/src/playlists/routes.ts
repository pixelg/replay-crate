import { schema } from '@replay-crate/db'
import { SpotifyApiError } from '@replay-crate/spotify'
import { and, asc, count, eq, inArray, max, ne, sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { loadTrackArtists } from '../history/queries.ts'
import { ReauthRequiredError } from '../spotify/access-token.ts'
import { syncPlaylists } from '../sync/playlists.ts'

const { albums, playlistItems, playlists, plays, tracks, userPlaylists } = schema

const playlistUri = (id: string) => `spotify:playlist:${id}`

export function playlistRoutes(deps: AppDeps) {
  const { db } = deps
  const auth = requireUser(deps)

  return (
    new Hono()
      /** Syncs playlists within a time budget; call again while `remaining > 0`. */
      .post('/playlists/sync', auth, async (c) => {
        try {
          return c.json(await syncPlaylists(deps, c.get('user').id), 200)
        } catch (error) {
          if (error instanceof ReauthRequiredError) return c.json({ error: 'reauth_required' as const }, 409)
          if (error instanceof SpotifyApiError && error.status === 429) {
            return c.json({ error: 'rate_limited' as const, retryAfter: error.retryAfter ?? null }, 503)
          }
          throw error
        }
      })

      /** The user's playlists, in their Spotify order, with how often they play from each. */
      .get('/playlists', auth, async (c) => {
        const user = c.get('user')

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

      /** A playlist's tracks with the user's play counts and which other playlists hold each one. */
      .get('/playlists/:id', auth, async (c) => {
        const user = c.get('user')
        const playlistId = c.req.param('id')

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
              /** False until the tracks have been fetched at least once. */
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
