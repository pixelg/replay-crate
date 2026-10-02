import { schema, type Db, type User } from '@replay-crate/db'
import { SpotifyApiError } from '@replay-crate/spotify'
import { and, desc, eq, isNotNull } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { upsertCatalog } from '../sync/catalog.ts'

// Playing one track or episode. Spotify's iPhone app takes a play of a bare URI (`uris`), answers
// 204, stops what was playing and never starts the new item; started from a context at that item
// it plays every time. So a single item plays from a context (a track's album, or the playlist it
// was last played from by the user's choice in `users.play_tracks_from`; an episode's show), and
// the device is asked afterwards whether it really started.

/** A track or episode URI the player can start from its context. */
export const ITEM_URI = /^spotify:(track|episode):[A-Za-z0-9]+$/

/** How long to wait between looks at the player after a play (Spotify takes a moment to show it). */
export const START_CHECK_DELAYS_MS = [400, 600, 1_000, 1_500] as const

export type PlayItemResult = { started: true } | { started: false; device: string | null }

type Player = Pick<User, 'id' | 'playTracksFrom'>
type PlayItem = { uri: string; user: Player; positionMs?: number; deviceId?: string }

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Where to start `uri` from, best first: a track's last playlist (when the user plays tracks from
 * there), then its album; an episode's show. From the catalog, else Spotify; empty when neither knows.
 */
export async function itemContexts(
  deps: Pick<AppDeps, 'db' | 'spotify'>,
  token: string,
  { uri, user }: { uri: string; user: Player },
): Promise<string[]> {
  const [, type, id] = uri.split(':') as [string, 'track' | 'episode', string]
  const { db, spotify } = deps
  if (type === 'episode') {
    const [known] = await db.select({ showId: schema.episodes.showId }).from(schema.episodes).where(eq(schema.episodes.id, id))
    if (known) return [`spotify:show:${known.showId}`]
    const episode = await spotify.getEpisode(token, id).catch(lookupFailed(uri))
    return episode ? [`spotify:show:${episode.show.id}`] : []
  }

  const playlist = user.playTracksFrom === 'playlist' ? await lastPlaylist(db, user.id, id) : null
  const [known] = await db.select({ albumId: schema.tracks.albumId }).from(schema.tracks).where(eq(schema.tracks.id, id))
  let albumId = known?.albumId
  if (!albumId) {
    const track = await spotify.getTrack(token, id).catch(lookupFailed(uri))
    if (track) await upsertCatalog(db, [track])
    albumId = track?.album.id
  }
  return [...(playlist ? [playlist] : []), ...(albumId ? [`spotify:album:${albumId}`] : [])]
}

/**
 * The playlist the user last played `trackId` from, unless it's one whose contents we keep and
 * the track has left it. Other playlists are tried; Spotify refuses if the track isn't there.
 */
async function lastPlaylist(db: Db, userId: string, trackId: string): Promise<string | null> {
  const { plays, playlists, playlistItems } = schema
  const [last] = await db
    .select({ uri: plays.contextUri })
    .from(plays)
    .where(and(eq(plays.userId, userId), eq(plays.trackId, trackId), eq(plays.contextType, 'playlist'), isNotNull(plays.contextUri)))
    .orderBy(desc(plays.playedAt))
    .limit(1)
  if (!last?.uri) return null
  const playlistId = last.uri.replace('spotify:playlist:', '')
  const [kept] = await db.select({ snapshot: playlists.itemsSnapshotId }).from(playlists).where(eq(playlists.id, playlistId))
  if (!kept?.snapshot) return last.uri
  const [still] = await db
    .select({ position: playlistItems.position })
    .from(playlistItems)
    .where(and(eq(playlistItems.playlistId, playlistId), eq(playlistItems.trackId, trackId)))
    .limit(1)
  return still ? last.uri : null
}

/** Without a context the item can still be played on its own, which most devices start. */
const lookupFailed = (uri: string) => (error: unknown) => {
  console.error(`[player] looking up where ${uri} belongs failed:`, error)
  return null
}

/** A refusal of the context itself (not of the device): the next context, or the item alone, may still play. */
const contextRefused = (error: unknown) =>
  error instanceof SpotifyApiError && (error.status === 400 || (error.status === 404 && error.reason !== 'NO_ACTIVE_DEVICE'))

/** Tries each of the item's contexts in turn; false when Spotify took none of them. */
async function startFromContext(deps: Pick<AppDeps, 'db' | 'spotify'>, token: string, { uri, user, positionMs, deviceId }: PlayItem) {
  for (const context of await itemContexts(deps, token, { uri, user })) {
    try {
      await deps.spotify.play(token, { contextUri: context, offset: { uri }, positionMs, deviceId })
      return true
    } catch (error) {
      // A playlist the track has left, a show (Spotify only promises albums, artists and
      // playlists as contexts) or an album gone from its catalogue: on to the next.
      if (!contextRefused(error)) throw error
    }
  }
  return false
}

/**
 * Plays `uri` (a track or episode) from its context at `positionMs`, then watches the player
 * until it's playing there. Spotify's refusals of the device are thrown as they come.
 */
export async function playItem(deps: Pick<AppDeps, 'db' | 'spotify' | 'sleep'>, token: string, request: PlayItem): Promise<PlayItemResult> {
  const { spotify, sleep: wait = sleep } = deps
  const { uri, positionMs, deviceId } = request
  if (!(await startFromContext(deps, token, request))) await spotify.play(token, { uris: [uri], positionMs, deviceId })

  let device: string | null = null
  let elapsed = 0
  // What each look saw, for the log: Spotify's state can lag the device.
  const seen: string[] = []
  for (const delay of START_CHECK_DELAYS_MS) {
    await wait(delay)
    elapsed += delay
    const state = await spotify.getPlaybackState(token)
    const item = state?.item
    seen.push(`+${elapsed}ms ${item?.uri ?? 'nothing'} ${state?.is_playing ? 'playing' : 'paused'}`)
    device = state?.device.name ?? device
    if (state?.is_playing && item?.uri === uri) {
      console.info(`[player] ${device ?? 'device'} started ${uri}: ${seen.join(', ')}`)
      return { started: true }
    }
  }
  console.warn(`[player] ${device ?? 'device'} didn't show ${uri} playing: ${seen.join(', ')}`)
  return { started: false, device }
}
