import { zValidator } from '@hono/zod-validator'
import { schema } from '@replay-crate/db'
import { SpotifyApiError } from '@replay-crate/spotify'
import { and, count, desc, eq, lt, max, min } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { ReauthRequiredError } from '../spotify/access-token.ts'
import { syncRecentlyPlayed } from '../sync/recently-played.ts'
import { loadTrackArtists, toContext } from './queries.ts'

const { albums, contexts, plays, tracks } = schema

/** Manual syncs closer together than this reuse the last result instead of calling Spotify. */
const MIN_SYNC_INTERVAL_MS = 30_000

const playsQuery = z.object({
  /** Cursor: return plays strictly older than this ISO timestamp. */
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

export function historyRoutes(deps: AppDeps) {
  const { db } = deps
  const now = deps.now ?? (() => new Date())
  const auth = requireUser(deps)

  return (
    new Hono()
      .post('/sync', auth, async (c) => {
        const user = c.get('user')
        if (user.lastSyncedAt && now().getTime() - user.lastSyncedAt.getTime() < MIN_SYNC_INTERVAL_MS) {
          return c.json({ status: 'skipped' as const, inserted: 0, lastSyncedAt: user.lastSyncedAt.toISOString() }, 200)
        }
        try {
          const result = await syncRecentlyPlayed(deps, user.id)
          return c.json(
            { status: 'synced' as const, inserted: result.inserted, lastSyncedAt: result.syncedAt.toISOString() },
            200,
          )
        } catch (error) {
          if (error instanceof ReauthRequiredError) return c.json({ error: 'reauth_required' as const }, 409)
          if (error instanceof SpotifyApiError && error.status === 429) {
            return c.json({ error: 'rate_limited' as const, retryAfter: error.retryAfter ?? null }, 503)
          }
          throw error
        }
      })

      /** Newest-first play history, paginated with the `before` cursor. */
      .get('/plays', auth, zValidator('query', playsQuery), async (c) => {
        const user = c.get('user')
        const { before, limit } = c.req.valid('query')

        const rows = await db
          .select({
            playedAt: plays.playedAt,
            msPlayed: plays.msPlayed,
            source: plays.source,
            contextType: plays.contextType,
            contextUri: plays.contextUri,
            contextName: contexts.name,
            contextImageUrl: contexts.imageUrl,
            trackId: tracks.id,
            trackName: tracks.name,
            durationMs: tracks.durationMs,
            explicit: tracks.explicit,
            albumId: albums.id,
            albumName: albums.name,
            albumThumbUrl: albums.thumbUrl,
          })
          .from(plays)
          .innerJoin(tracks, eq(plays.trackId, tracks.id))
          .innerJoin(albums, eq(tracks.albumId, albums.id))
          .leftJoin(contexts, eq(plays.contextUri, contexts.uri))
          .where(and(eq(plays.userId, user.id), before ? lt(plays.playedAt, new Date(before)) : undefined))
          .orderBy(desc(plays.playedAt))
          .limit(limit + 1)

        const page = rows.slice(0, limit)
        const artistsByTrack = await loadTrackArtists(
          db,
          page.map((row) => row.trackId),
        )

        return c.json(
          {
            items: page.map((row) => ({
              playedAt: row.playedAt.toISOString(),
              msPlayed: row.msPlayed,
              source: row.source,
              context: toContext(row),
              track: {
                id: row.trackId,
                name: row.trackName,
                durationMs: row.durationMs,
                explicit: row.explicit,
                album: { id: row.albumId, name: row.albumName, thumbUrl: row.albumThumbUrl },
                artists: artistsByTrack.get(row.trackId) ?? [],
              },
            })),
            nextCursor: rows.length > limit ? page.at(-1)!.playedAt.toISOString() : null,
            lastSyncedAt: user.lastSyncedAt?.toISOString() ?? null,
          },
          200,
        )
      })

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

