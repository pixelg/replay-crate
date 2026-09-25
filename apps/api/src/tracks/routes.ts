import { schema } from '@replay-crate/db'
import { and, asc, count, desc, eq, max, min } from 'drizzle-orm'
import { Hono } from 'hono'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { loadTrackArtists, toContext } from '../history/queries.ts'

const { albums, contexts, playlistItems, playlists, plays, tracks, userPlaylists } = schema

// Plain Hono until #63 declares it with createRoute.
export function trackRoutes(deps: AppDeps) {
  const { db } = deps
  const auth = requireUser(deps)

  return (
    new Hono()
      /** One track with the signed-in user's play stats. */
      .get('/tracks/:id', auth, async (c) => {
        const user = c.get('user')
        const trackId = c.req.param('id')

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
  )
}

/** Aggregates come back as Date from Postgres drivers, but guard against string/null. */
function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  return (value instanceof Date ? value : new Date(value)).toISOString()
}

