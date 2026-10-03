import { createRoute, z } from '@hono/zod-openapi'
import { schema } from '@replay-crate/db'
import { and, asc, count, eq, inArray, max, ne, sql } from 'drizzle-orm'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { loadTrackGenres } from '../genres/queries.ts'
import { loadTrackArtists } from '../history/queries.ts'
import { recordingId } from '../tracks/recordings.ts'
import { latestAddedFirst } from './queries.ts'
import { EpisodeSummary, loadEpisodeSummaries } from '../podcasts/present.ts'
import { createRouter, errorResponses, signedIn } from '../lib/openapi.ts'
import { ArtistRef, GenreRef, IsoDateTime, jsonResponse, Rating } from '../lib/schemas.ts'
import { loadRatings } from '../tracks/ratings.ts'
import { spotifyErrorResponse } from '../spotify/errors.ts'
import { syncPlaylists } from '../sync/playlists.ts'

const { albums, episodeListens, playlistEpisodes, playlistItems, playlists, plays, tracks, userPlaylists } = schema

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
  description:
    'In your Spotify order, with how often you play from each. `contains=tracks` keeps only playlists with a track, ' +
    '`contains=episodes` only those with a podcast episode (empty ones, or ones of only local files, are in neither).',
  security: signedIn,
  request: {
    query: z.object({ contains: z.enum(['tracks', 'episodes']).optional().openapi({ description: 'What the playlists should hold.' }) }),
  },
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
              trackCount: z.number().int().openapi({ description: 'Tracks in it, as of the last sync.' }),
              episodeCount: z.number().int().openapi({ description: 'Podcast episodes in it, as of the last sync.' }),
              playsFrom: z.number().int().openapi({ description: 'Plays with this playlist as their context.' }),
              lastPlayedFrom: IsoDateTime.nullable(),
              lastAddedAt: IsoDateTime.nullable().openapi({
                description: 'When a track or episode was last added to it (by anyone, here or in Spotify), as of the last sync.',
              }),
            })
            .openapi('PlaylistSummary'),
        ),
        syncedAt: IsoDateTime.nullable(),
      }),
      'Your playlists.',
    ),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

const PlaylistEpisode = z
  .object({
    position: z.number().int(),
    addedAt: IsoDateTime.nullable(),
    episode: EpisodeSummary,
    listens: z.number().int(),
    listenedMs: z.number().int(),
    lastListenedAt: IsoDateTime.nullable(),
  })
  .openapi('PlaylistEpisode')

const get = createRoute({
  method: 'get',
  path: '/playlists/{id}',
  tags: ['Playlists'],
  operationId: 'getPlaylist',
  summary: 'A playlist and its tracks and episodes',
  description:
    'Each track with your play counts and the other playlists that hold it, and each podcast episode with your listens. ' +
    "Positions are Spotify's, counting both, so `items` and `episodes` together are the playlist in order.",
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
              recordingId: z.string().openapi({
                description: "The recording's track id, as plays and the other lists know it: the track's own, unless the playlist holds another copy.",
              }),
              track: z.object({
                id: z.string(),
                name: z.string(),
                durationMs: z.number().int(),
                explicit: z.boolean(),
                album: z.object({ id: z.string(), name: z.string(), thumbUrl: z.string().nullable() }),
                artists: z.array(ArtistRef),
                genres: z.array(GenreRef).openapi({ description: "Its artists' genres, the primary artist's first; at most 3." }),
                rating: Rating,
              }),
              playCount: z.number().int(),
              playsHere: z.number().int().openapi({ description: 'Plays from this playlist.' }),
              lastPlayedAt: IsoDateTime.nullable(),
              alsoOn: z.array(z.object({ id: z.string(), name: z.string() })),
            })
            .openapi('PlaylistTrack'),
        ),
        episodes: z.array(PlaylistEpisode).openapi({ description: 'Its podcast episodes, in order.' }),
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
        const added = db
          .select({
            playlistId: playlistItems.playlistId,
            lastAddedAt: max(playlistItems.addedAt).as('last_added_at'),
            tracks: count().as('track_count'),
          })
          .from(playlistItems)
          .groupBy(playlistItems.playlistId)
          .as('added')
        const addedEpisodes = db
          .select({
            playlistId: playlistEpisodes.playlistId,
            lastAddedAt: max(playlistEpisodes.addedAt).as('last_episode_added_at'),
            episodes: count().as('episode_count'),
          })
          .from(playlistEpisodes)
          .groupBy(playlistEpisodes.playlistId)
          .as('added_episodes')
        const { contains } = c.req.valid('query')

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
            lastAddedAt: added.lastAddedAt,
            lastEpisodeAddedAt: addedEpisodes.lastAddedAt,
            trackCount: added.tracks,
            episodeCount: addedEpisodes.episodes,
          })
          .from(userPlaylists)
          .innerJoin(playlists, eq(playlists.id, userPlaylists.playlistId))
          .leftJoin(playedFrom, eq(playedFrom.contextUri, sql`'spotify:playlist:' || ${playlists.id}`))
          .leftJoin(added, eq(added.playlistId, playlists.id))
          .leftJoin(addedEpisodes, eq(addedEpisodes.playlistId, playlists.id))
          .where(eq(userPlaylists.userId, user.id))
          .orderBy(asc(userPlaylists.position))

        const kept = rows.filter((row) => {
          const tracksIn = Number(row.trackCount ?? 0)
          const episodesIn = Number(row.episodeCount ?? 0)
          if (contains === 'tracks') return tracksIn > 0
          if (contains === 'episodes') return episodesIn > 0
          return true
        })
        const latest = (a: Date | string | null, b: Date | string | null) => {
          const [x, y] = [toIso(a), toIso(b)]
          return x && y ? (x > y ? x : y) : (x ?? y)
        }
        return c.json(
          {
            playlists: kept.map((row) => ({
              id: row.id,
              name: row.name,
              thumbUrl: row.thumbUrl,
              ownerName: row.ownerName,
              owned: row.ownerId === user.id,
              collaborative: row.collaborative,
              isPublic: row.isPublic,
              itemCount: row.itemCount,
              trackCount: Number(row.trackCount ?? 0),
              episodeCount: Number(row.episodeCount ?? 0),
              playsFrom: Number(row.playsFrom ?? 0),
              lastPlayedFrom: toIso(row.lastPlayedFrom),
              lastAddedAt: latest(row.lastAddedAt, row.lastEpisodeAddedAt),
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
            // Plays and other playlists count the recording, whichever copy this playlist holds.
            recording: recordingId,
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

        const recordingsHere = db
          .select({ recording: recordingId })
          .from(playlistItems)
          .innerJoin(tracks, eq(tracks.id, playlistItems.trackId))
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
          .where(and(eq(plays.userId, user.id), inArray(plays.trackId, recordingsHere)))
          .groupBy(plays.trackId)
        const statsByTrack = new Map(stats.map((row) => [row.trackId, row]))

        // The playlist each track went into most recently first, like everywhere else rows list them.
        const alsoOn = await db
          .select({ recording: recordingId, id: playlists.id, name: playlists.name })
          .from(playlistItems)
          .innerJoin(tracks, eq(tracks.id, playlistItems.trackId))
          .innerJoin(
            userPlaylists,
            and(eq(userPlaylists.playlistId, playlistItems.playlistId), eq(userPlaylists.userId, user.id)),
          )
          .innerJoin(playlists, eq(playlists.id, playlistItems.playlistId))
          .where(and(ne(playlistItems.playlistId, playlistId), inArray(recordingId, recordingsHere)))
          .groupBy(recordingId, playlists.id, playlists.name, userPlaylists.position)
          .orderBy(...latestAddedFirst())
        const alsoOnByTrack = new Map<string, Array<{ id: string; name: string }>>()
        for (const { recording, id, name } of alsoOn) {
          alsoOnByTrack.set(recording, [...(alsoOnByTrack.get(recording) ?? []), { id, name }])
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
        const genresByTrack = await loadTrackGenres(
          db,
          items.map((item) => item.trackId),
        )
        const [playsFrom] = await db
          .select({ total: count() })
          .from(plays)
          .where(and(eq(plays.userId, user.id), eq(plays.contextUri, playlistUri(playlistId))))

        const episodeRows = await db
          .select({
            position: playlistEpisodes.position,
            addedAt: playlistEpisodes.addedAt,
            episodeId: playlistEpisodes.episodeId,
            listens: sql<number>`count(${episodeListens.id})::int`.mapWith(Number),
            listenedMs: sql<number>`coalesce(sum(${episodeListens.listenedMs}), 0)::int`.mapWith(Number),
            lastListenedAt: max(episodeListens.endedAt),
          })
          .from(playlistEpisodes)
          .leftJoin(
            episodeListens,
            and(eq(episodeListens.episodeId, playlistEpisodes.episodeId), eq(episodeListens.userId, user.id)),
          )
          .where(eq(playlistEpisodes.playlistId, playlistId))
          .groupBy(playlistEpisodes.position, playlistEpisodes.addedAt, playlistEpisodes.episodeId)
          .orderBy(asc(playlistEpisodes.position))
        const episodeSummaries = await loadEpisodeSummaries(
          db,
          user.id,
          episodeRows.map((row) => row.episodeId),
        )

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
              const trackStats = statsByTrack.get(item.recording)
              return {
                position: item.position,
                addedAt: item.addedAt?.toISOString() ?? null,
                recordingId: item.recording,
                track: {
                  id: item.trackId,
                  name: item.trackName,
                  durationMs: item.durationMs,
                  explicit: item.explicit,
                  album: { id: item.albumId, name: item.albumName, thumbUrl: item.albumThumbUrl },
                  artists: artistsByTrack.get(item.trackId) ?? [],
                  genres: genresByTrack.get(item.trackId) ?? [],
                  rating: ratings.get(item.trackId) ?? null,
                },
                playCount: trackStats?.playCount ?? 0,
                playsHere: trackStats?.playsHere ?? 0,
                lastPlayedAt: toIso(trackStats?.lastPlayedAt),
                alsoOn: alsoOnByTrack.get(item.recording) ?? [],
              }
            }),
            episodes: episodeRows.map((row) => ({
              position: row.position,
              addedAt: row.addedAt?.toISOString() ?? null,
              // episode_id is a foreign key, so every one is there.
              episode: episodeSummaries.get(row.episodeId)!,
              listens: row.listens,
              listenedMs: row.listenedMs,
              lastListenedAt: toIso(row.lastListenedAt),
            })),
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
