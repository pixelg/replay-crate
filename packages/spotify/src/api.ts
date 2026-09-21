import { SPOTIFY_API_URL } from './constants.ts'
import type {
  Paging,
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

  constructor(status: number, message: string, retryAfter?: number) {
    super(message)
    this.name = 'SpotifyApiError'
    this.status = status
    this.retryAfter = retryAfter
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
    if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') ?? '1')
      if (attempt < 2 && retryAfter <= maxRetryWaitSeconds) {
        await sleep(retryAfter * 1000)
        continue
      }
      throw new SpotifyApiError(429, `${method} ${path} was rate limited`, retryAfter)
    }
    throw new SpotifyApiError(res.status, `${method} ${path} failed with ${res.status}`)
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

/** Playlist name, image and owner. Works for any playlist; contents only for the user's own. */
export function getPlaylistMeta(accessToken: string, id: string, options?: RequestOptions): Promise<SpotifyPlaylistMeta> {
  const fields = encodeURIComponent('id,name,images,owner(id,display_name)')
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
