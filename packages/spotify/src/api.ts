import { SPOTIFY_API_URL } from './constants.ts'
import type {
  Paging,
  PlayRequest,
  RepeatState,
  SpotifyDevice,
  SpotifyPlaybackState,
  SpotifyQueue,
  SpotifyTrack,
  TopTimeRange,
  RecentlyPlayedPage,
  SpotifyArtist,
  SpotifyImage,
  SpotifyPlaylist,
  SpotifyPlaylistItem,
  SpotifyPlaylistMeta,
  SpotifySimplifiedAlbum,
} from './types.ts'

/** Fields of `GET /me` still returned to development-mode apps after the Feb 2026 changes. */
export type SpotifyUser = {
  id: string
  display_name: string | null
  images: SpotifyImage[]
}

export class SpotifyApiError extends Error {
  readonly status: number
  /** Seconds to wait before retrying, when Spotify rate-limits us (429). */
  readonly retryAfter: number | undefined
  /**
   * Spotify's `error.reason`, when it gives one. The player uses it to say why a command failed,
   * e.g. `NO_ACTIVE_DEVICE` (404) or `PREMIUM_REQUIRED` (403).
   */
  readonly reason: string | undefined

  constructor(status: number, message: string, retryAfter?: number, reason?: string) {
    super(message)
    this.name = 'SpotifyApiError'
    this.status = status
    this.retryAfter = retryAfter
    this.reason = reason
  }
}

type Fetch = typeof fetch

export type RequestOptions = {
  fetchFn?: Fetch
  /** Longest Retry-After we'll wait out in-process before giving up. */
  maxRetryWaitSeconds?: number
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Calls a Web API path and returns its JSON body. On 429 it waits out short
 * Retry-After windows (up to twice) and otherwise throws SpotifyApiError with
 * `retryAfter` set.
 */
export async function spotifyRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  accessToken: string,
  { body, ...options }: RequestOptions & { body?: unknown } = {},
): Promise<T> {
  const { fetchFn = fetch, maxRetryWaitSeconds = 5, sleep = defaultSleep } = options

  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(`${SPOTIFY_API_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body !== undefined && { 'Content-Type': 'application/json' }),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    })
    if (res.ok) {
      // Some endpoints answer 200 with an empty body (e.g. Change Playlist Details).
      const text = await res.text()
      return (text ? JSON.parse(text) : undefined) as T
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '1')
      if (attempt < 2 && retryAfter <= maxRetryWaitSeconds) {
        await sleep(retryAfter * 1000)
        continue
      }
      throw new SpotifyApiError(429, `${method} ${path} was rate limited`, retryAfter)
    }
    // Error bodies are `{ error: { status, message, reason? } }`, but don't count on JSON.
    const { error } = ((await res.json().catch(() => null)) ?? {}) as { error?: { message?: string; reason?: string } }
    const detail = error?.message ? `: ${error.message}` : ''
    throw new SpotifyApiError(res.status, `${method} ${path} failed with ${res.status}${detail}`, undefined, error?.reason)
  }
}

export function spotifyGet<T>(path: string, accessToken: string, options: RequestOptions = {}): Promise<T> {
  return spotifyRequest('GET', path, accessToken, options)
}

export function getCurrentUser(accessToken: string, options?: RequestOptions): Promise<SpotifyUser> {
  return spotifyGet('/me', accessToken, options)
}

/** The user's last 50 plays. Spotify keeps no history beyond that. */
export function getRecentlyPlayed(accessToken: string, options?: RequestOptions): Promise<RecentlyPlayedPage> {
  return spotifyGet('/me/player/recently-played?limit=50', accessToken, options)
}

/**
 * Playlist name, image, owner and current snapshot. Works for any playlist; contents only
 * for the user's own. Unlike `GET /me/playlists`, which can lag a recent change by a minute,
 * this reflects the latest version.
 */
export function getPlaylistMeta(accessToken: string, id: string, options?: RequestOptions): Promise<SpotifyPlaylistMeta> {
  const fields = encodeURIComponent('id,name,images,owner(id,display_name),snapshot_id')
  return spotifyGet(`/playlists/${encodeURIComponent(id)}?fields=${fields}`, accessToken, options)
}

export function getAlbum(accessToken: string, id: string, options?: RequestOptions): Promise<SpotifySimplifiedAlbum> {
  return spotifyGet(`/albums/${encodeURIComponent(id)}`, accessToken, options)
}

export function getArtist(accessToken: string, id: string, options?: RequestOptions): Promise<SpotifyArtist> {
  return spotifyGet(`/artists/${encodeURIComponent(id)}`, accessToken, options)
}

/** One page (up to 50) of the playlists in the user's library, owned or followed. */
export function getMyPlaylists(
  accessToken: string,
  offset = 0,
  options?: RequestOptions,
): Promise<Paging<SpotifyPlaylist>> {
  return spotifyGet(`/me/playlists?limit=50&offset=${offset}`, accessToken, options)
}

const PLAYLIST_ITEM_FIELDS = [
  'items(added_at,added_by(id),is_local,item(type,id,name,uri,duration_ms,explicit,is_local,external_ids(isrc),',
  'album(id,name,uri,album_type,release_date,release_date_precision,images,artists(id,name,uri)),',
  'artists(id,name,uri))),next,total,offset,limit',
].join('')

/**
 * One page (up to 50) of a playlist's items. Only works for playlists the user owns
 * or collaborates on; Spotify answers 403 for anything else.
 */
export function getPlaylistItems(
  accessToken: string,
  playlistId: string,
  offset = 0,
  options?: RequestOptions,
): Promise<Paging<SpotifyPlaylistItem>> {
  const query = new URLSearchParams({ limit: '50', offset: String(offset), fields: PLAYLIST_ITEM_FIELDS })
  return spotifyGet(`/playlists/${encodeURIComponent(playlistId)}/items?${query}`, accessToken, options)
}

/** Creates an (empty) playlist owned by the current user. */
export function createPlaylist(
  accessToken: string,
  details: { name: string; description?: string; public?: boolean },
  options?: RequestOptions,
): Promise<SpotifyPlaylist> {
  return spotifyRequest('POST', '/me/playlists', accessToken, { ...options, body: details })
}

/** Adds up to 100 track URIs, appended unless `position` is given. */
export function addPlaylistItems(
  accessToken: string,
  playlistId: string,
  uris: string[],
  position?: number,
  options?: RequestOptions,
): Promise<{ snapshot_id: string }> {
  return spotifyRequest('POST', `/playlists/${encodeURIComponent(playlistId)}/items`, accessToken, {
    ...options,
    body: { uris, ...(position !== undefined && { position }) },
  })
}

/** Removes every occurrence of up to 100 track URIs. */
export function removePlaylistItems(
  accessToken: string,
  playlistId: string,
  uris: string[],
  options?: RequestOptions,
): Promise<{ snapshot_id: string }> {
  return spotifyRequest('DELETE', `/playlists/${encodeURIComponent(playlistId)}/items`, accessToken, {
    ...options,
    body: { items: uris.map((uri) => ({ uri })) },
  })
}

/**
 * Moves `rangeLength` items starting at `rangeStart` so they sit before the item
 * currently at `insertBefore` (Spotify's semantics; use the list length to move to the end).
 */
export function reorderPlaylistItems(
  accessToken: string,
  playlistId: string,
  move: { rangeStart: number; insertBefore: number; rangeLength?: number; snapshotId?: string },
  options?: RequestOptions,
): Promise<{ snapshot_id: string }> {
  return spotifyRequest('PUT', `/playlists/${encodeURIComponent(playlistId)}/items`, accessToken, {
    ...options,
    body: {
      range_start: move.rangeStart,
      insert_before: move.insertBefore,
      range_length: move.rangeLength ?? 1,
      ...(move.snapshotId && { snapshot_id: move.snapshotId }),
    },
  })
}

/**
 * The user's top tracks by Spotify's own reckoning: roughly 4 weeks (short), 6 months
 * (medium) or about a year (long). Spotify doesn't say how it ranks them.
 */
export function getTopTracks(
  accessToken: string,
  timeRange: TopTimeRange,
  options?: RequestOptions,
): Promise<Paging<SpotifyTrack>> {
  return spotifyGet(`/me/top/tracks?time_range=${timeRange}&limit=20`, accessToken, options)
}

export function getTopArtists(
  accessToken: string,
  timeRange: TopTimeRange,
  options?: RequestOptions,
): Promise<Paging<SpotifyArtist>> {
  return spotifyGet(`/me/top/artists?time_range=${timeRange}&limit=20`, accessToken, options)
}

/** One track by id. (The batch `GET /tracks?ids=` was removed in Feb 2026.) */
export function getTrack(accessToken: string, id: string, options?: RequestOptions): Promise<SpotifyTrack> {
  return spotifyGet(`/tracks/${encodeURIComponent(id)}`, accessToken, options)
}

// Player API. Every call needs Premium; commands go to `deviceId`, or to the active device when
// it's omitted (404 NO_ACTIVE_DEVICE when there's none).

type PlayerTarget = { deviceId?: string }

/** `?a=1&b=2` from the defined entries, or '' when there are none. */
function query(params: Record<string, string | number | boolean | undefined>): string {
  const entries = Object.entries(params).filter((entry): entry is [string, string | number | boolean] => entry[1] !== undefined)
  return entries.length ? `?${new URLSearchParams(Object.fromEntries(entries.map(([key, value]) => [key, String(value)])))}` : ''
}

/** What's playing, where, and how far in; null when there's no active device (Spotify's 204). */
export async function getPlaybackState(accessToken: string, options?: RequestOptions): Promise<SpotifyPlaybackState | null> {
  const state = await spotifyGet<SpotifyPlaybackState | undefined>('/me/player?additional_types=track,episode', accessToken, options)
  return state ?? null
}

/** The current item and what's up next (the user's queue, then the rest of the context). */
export function getQueue(accessToken: string, options?: RequestOptions): Promise<SpotifyQueue> {
  return spotifyGet('/me/player/queue', accessToken, options)
}

/** Devices the user can play on right now (Spotify Connect). */
export async function getDevices(accessToken: string, options?: RequestOptions): Promise<SpotifyDevice[]> {
  return (await spotifyGet<{ devices: SpotifyDevice[] }>('/me/player/devices', accessToken, options)).devices
}

/** Starts playing tracks or a context, or resumes when `request` is empty. */
export async function play(
  accessToken: string,
  { deviceId, ...request }: PlayRequest & PlayerTarget = {},
  options?: RequestOptions,
): Promise<void> {
  const body = {
    ...(request.contextUri && { context_uri: request.contextUri }),
    ...(request.uris && { uris: request.uris }),
    ...(request.offset && { offset: request.offset }),
    ...(request.positionMs !== undefined && { position_ms: request.positionMs }),
  }
  await spotifyRequest('PUT', `/me/player/play${query({ device_id: deviceId })}`, accessToken, {
    ...options,
    ...(Object.keys(body).length && { body }),
  })
}

export async function pause(accessToken: string, { deviceId }: PlayerTarget = {}, options?: RequestOptions): Promise<void> {
  await spotifyRequest('PUT', `/me/player/pause${query({ device_id: deviceId })}`, accessToken, options)
}

export async function skipToNext(accessToken: string, { deviceId }: PlayerTarget = {}, options?: RequestOptions): Promise<void> {
  await spotifyRequest('POST', `/me/player/next${query({ device_id: deviceId })}`, accessToken, options)
}

export async function skipToPrevious(accessToken: string, { deviceId }: PlayerTarget = {}, options?: RequestOptions): Promise<void> {
  await spotifyRequest('POST', `/me/player/previous${query({ device_id: deviceId })}`, accessToken, options)
}

/** Jumps to `positionMs` in the current item; past its end skips to the next one. */
export async function seek(
  accessToken: string,
  positionMs: number,
  { deviceId }: PlayerTarget = {},
  options?: RequestOptions,
): Promise<void> {
  await spotifyRequest('PUT', `/me/player/seek${query({ position_ms: positionMs, device_id: deviceId })}`, accessToken, options)
}

export async function setRepeat(
  accessToken: string,
  state: RepeatState,
  { deviceId }: PlayerTarget = {},
  options?: RequestOptions,
): Promise<void> {
  await spotifyRequest('PUT', `/me/player/repeat${query({ state, device_id: deviceId })}`, accessToken, options)
}

export async function setShuffle(
  accessToken: string,
  on: boolean,
  { deviceId }: PlayerTarget = {},
  options?: RequestOptions,
): Promise<void> {
  await spotifyRequest('PUT', `/me/player/shuffle${query({ state: on, device_id: deviceId })}`, accessToken, options)
}

/** 0–100. Devices with `supports_volume: false` refuse (403 VOLUME_CONTROL_DISALLOW). */
export async function setVolume(
  accessToken: string,
  percent: number,
  { deviceId }: PlayerTarget = {},
  options?: RequestOptions,
): Promise<void> {
  await spotifyRequest('PUT', `/me/player/volume${query({ volume_percent: percent, device_id: deviceId })}`, accessToken, options)
}

/** Queues a track or episode URI after whatever is queued already. */
export async function addToQueue(
  accessToken: string,
  uri: string,
  { deviceId }: PlayerTarget = {},
  options?: RequestOptions,
): Promise<void> {
  await spotifyRequest('POST', `/me/player/queue${query({ uri, device_id: deviceId })}`, accessToken, options)
}

/** Moves playback to `deviceId`. `play` starts it there; otherwise it keeps its current state. */
export async function transferPlayback(
  accessToken: string,
  deviceId: string,
  { play: start }: { play?: boolean } = {},
  options?: RequestOptions,
): Promise<void> {
  await spotifyRequest('PUT', '/me/player', accessToken, {
    ...options,
    body: { device_ids: [deviceId], ...(start !== undefined && { play: start }) },
  })
}
