import { createTestDb } from '@replay-crate/db/testing'
import { SpotifyApiError } from '@replay-crate/spotify'
import type {
  Paging,
  PlayHistoryItem,
  SpotifyContext,
  SpotifyPlaylist,
  SpotifyPlaylistItem,
  SpotifyTrack,
  TokenResponse,
} from '@replay-crate/spotify'
import { vi } from 'vitest'
import { createApp } from './app.ts'
import type { AppDeps, SpotifyGateway } from './deps.ts'
import { createTokenCipher } from './lib/crypto.ts'

export const REDIRECT_URI = 'http://127.0.0.1:5173/callback'
export const TEST_KEY = Buffer.alloc(32, 7).toString('base64')
export const CRON_SECRET = 'cron-secret-for-tests'

export const tokens = (overrides: Partial<TokenResponse> = {}): TokenResponse => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresIn: 3600,
  scope: 'user-read-recently-played user-top-read',
  ...overrides,
})

/** A Spotify track object. Artists are `[id, name]` pairs; the album defaults to one per track. */
export function track(
  id: string,
  options: { name?: string; album?: [id: string, name: string]; artists?: Array<[id: string, name: string]> } = {},
): SpotifyTrack {
  const [albumId, albumName] = options.album ?? [`album-${id}`, `Album ${id}`]
  const artists = (options.artists ?? [['artist-1', 'Artist One']]).map(([artistId, name]) => ({
    id: artistId,
    name,
    uri: `spotify:artist:${artistId}`,
  }))
  return {
    id,
    name: options.name ?? `Track ${id}`,
    uri: `spotify:track:${id}`,
    duration_ms: 200_000,
    explicit: false,
    is_local: false,
    external_ids: { isrc: `ISRC${id}` },
    album: {
      id: albumId,
      name: albumName,
      uri: `spotify:album:${albumId}`,
      album_type: 'album',
      release_date: '2024-05-01',
      release_date_precision: 'day',
      images: [
        { url: `https://i.scdn.co/${albumId}-300`, width: 300, height: 300 },
        { url: `https://i.scdn.co/${albumId}-64`, width: 64, height: 64 },
      ],
      artists: artists.slice(0, 1),
    },
    artists,
  }
}

export const playlistContext = (id: string): SpotifyContext => ({ type: 'playlist', uri: `spotify:playlist:${id}` })

export function play(t: SpotifyTrack, playedAt: string, context: SpotifyContext | null = null): PlayHistoryItem {
  return { track: t, played_at: playedAt, context }
}

/** A `GET /me/playlists` entry owned by `ownerId` (default: the test user). */
export function playlist(
  id: string,
  options: { name?: string; ownerId?: string; snapshot?: string; total?: number; collaborative?: boolean } = {},
): SpotifyPlaylist {
  return {
    id,
    name: options.name ?? `Playlist ${id}`,
    description: null,
    images: [{ url: `https://i.scdn.co/${id}-300`, width: 300, height: 300 }],
    owner: { id: options.ownerId ?? 'pixelg', display_name: 'Pixel G' },
    collaborative: options.collaborative ?? false,
    public: true,
    snapshot_id: options.snapshot ?? `${id}-v1`,
    items: { total: options.total ?? 0 },
  }
}

export const playlistEntry = (t: SpotifyTrack, addedAt = '2026-01-01T00:00:00Z'): SpotifyPlaylistItem => ({
  added_at: addedAt,
  added_by: { id: 'pixelg' },
  is_local: false,
  item: t,
})

/** Serves `items` as Spotify-style pages of `pageSize`. */
export function paged<T>(items: T[], pageSize = 50) {
  return async (offset: number): Promise<Paging<T>> => ({
    items: items.slice(offset, offset + pageSize),
    next: offset + pageSize < items.length ? `next?offset=${offset + pageSize}` : null,
    total: items.length,
    offset,
    limit: pageSize,
  })
}

/**
 * In-memory stand-in for the user's Spotify playlists, so write operations can be
 * followed by a re-read exactly like against the real API.
 */
export function createFakeLibrary() {
  const store = new Map<string, { meta: SpotifyPlaylist; entries: SpotifyTrack[]; version: number }>()
  let nextId = 1

  const snapshot = (id: string) => {
    const playlist = store.get(id)!
    playlist.version++
    playlist.meta.snapshot_id = `${id}-v${playlist.version}`
    playlist.meta.items = { total: playlist.entries.length }
    return { snapshot_id: playlist.meta.snapshot_id }
  }
  const get = (id: string) => {
    const playlist = store.get(id)
    if (!playlist) throw new SpotifyApiError(404, `playlist ${id} not found`)
    return playlist
  }
  const trackFromUri = (uri: string) => track(uri.replace('spotify:track:', ''))

  return {
    store,
    /** Seeds a playlist the user owns. */
    add(id: string, tracks: SpotifyTrack[], name = `Playlist ${id}`) {
      store.set(id, { meta: playlist(id, { name, total: tracks.length }), entries: [...tracks], version: 1 })
    },
    trackIds: (id: string) => get(id).entries.map((entry) => entry.id),
    gateway: {
      getMyPlaylists: async (_token: string, offset: number) =>
        paged([...store.values()].map((p) => ({ ...p.meta })))(offset),
      getPlaylistItems: async (_token: string, id: string, offset: number) =>
        paged(get(id).entries.map((entry) => playlistEntry(entry)))(offset),
      createPlaylist: async (_token: string, details: { name: string; description?: string; public?: boolean }) => {
        const id = `new-${nextId++}`
        store.set(id, {
          meta: { ...playlist(id, { name: details.name }), description: details.description ?? null, public: details.public ?? true, images: [] },
          entries: [],
          version: 1,
        })
        return { ...store.get(id)!.meta }
      },
      addPlaylistItems: async (_token: string, id: string, uris: string[], position?: number) => {
        const entries = get(id).entries
        entries.splice(position ?? entries.length, 0, ...uris.map(trackFromUri))
        return snapshot(id)
      },
      removePlaylistItems: async (_token: string, id: string, uris: string[]) => {
        const playlistEntries = get(id)
        playlistEntries.entries = playlistEntries.entries.filter((entry) => !uris.includes(entry.uri))
        return snapshot(id)
      },
      reorderPlaylistItems: async (
        _token: string,
        id: string,
        move: { rangeStart: number; insertBefore: number; snapshotId?: string },
      ) => {
        const playlistEntries = get(id)
        if (move.snapshotId && move.snapshotId !== playlistEntries.meta.snapshot_id) {
          throw new SpotifyApiError(400, 'snapshot mismatch')
        }
        const [moved] = playlistEntries.entries.splice(move.rangeStart, 1)
        const target = move.insertBefore > move.rangeStart ? move.insertBefore - 1 : move.insertBefore
        playlistEntries.entries.splice(target, 0, moved!)
        return snapshot(id)
      },
    },
  }
}

/** App wired to PGlite, a fake Spotify, and a controllable clock. */
export async function createTestContext() {
  const { db, close } = await createTestDb()
  let current = new Date('2026-09-21T12:00:00Z')

  const library = createFakeLibrary()
  const spotify = {
    exchangeCode: vi.fn<SpotifyGateway['exchangeCode']>(async () => tokens()),
    refreshAccessToken: vi.fn<SpotifyGateway['refreshAccessToken']>(async () =>
      tokens({ accessToken: 'access-2', refreshToken: undefined }),
    ),
    getCurrentUser: vi.fn<SpotifyGateway['getCurrentUser']>(async () => ({
      id: 'pixelg',
      display_name: 'Pixel G',
      images: [
        { url: 'https://i.scdn.co/image/small', width: 64, height: 64 },
        { url: 'https://i.scdn.co/image/large', width: 300, height: 300 },
      ],
    })),
    getRecentlyPlayed: vi.fn<SpotifyGateway['getRecentlyPlayed']>(async () => ({ items: [], cursors: null })),
    getPlaylistMeta: vi.fn<SpotifyGateway['getPlaylistMeta']>(async (_token, id) => ({
      id,
      name: `Playlist ${id}`,
      images: [{ url: `https://i.scdn.co/${id}`, width: 300, height: 300 }],
      owner: { id: 'pixelg', display_name: 'Pixel G' },
    })),
    getAlbum: vi.fn<SpotifyGateway['getAlbum']>(),
    getArtist: vi.fn<SpotifyGateway['getArtist']>(async (_token, id) => ({
      id,
      name: `Artist ${id}`,
      uri: `spotify:artist:${id}`,
      images: [{ url: `https://i.scdn.co/${id}`, width: 300, height: 300 }],
    })),
    getMyPlaylists: vi.fn<SpotifyGateway['getMyPlaylists']>(library.gateway.getMyPlaylists),
    getPlaylistItems: vi.fn<SpotifyGateway['getPlaylistItems']>(library.gateway.getPlaylistItems),
    createPlaylist: vi.fn<SpotifyGateway['createPlaylist']>(library.gateway.createPlaylist),
    addPlaylistItems: vi.fn<SpotifyGateway['addPlaylistItems']>(library.gateway.addPlaylistItems),
    removePlaylistItems: vi.fn<SpotifyGateway['removePlaylistItems']>(library.gateway.removePlaylistItems),
    reorderPlaylistItems: vi.fn<SpotifyGateway['reorderPlaylistItems']>(library.gateway.reorderPlaylistItems),
  }

  const deps: AppDeps = {
    db,
    cipher: await createTokenCipher(TEST_KEY),
    spotify,
    redirectUri: REDIRECT_URI,
    cronSecret: CRON_SECRET,
    now: () => current,
  }

  const app = createApp(deps)

  /** Runs the login callback and returns the session token from the Set-Cookie header. */
  async function login() {
    const res = await app.request('/api/auth/callback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'code-1', codeVerifier: 'v'.repeat(64), redirectUri: REDIRECT_URI }),
    })
    const token = res.headers.get('set-cookie')?.match(/rc_session=([^;]+)/)?.[1]
    return { res, token }
  }

  return {
    app,
    deps,
    db,
    spotify,
    library,
    login,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms)
    },
    close,
  }
}
