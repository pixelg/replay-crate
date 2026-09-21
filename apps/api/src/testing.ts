import { createTestDb } from '@replay-crate/db/testing'
import type { PlayHistoryItem, SpotifyContext, SpotifyTrack, TokenResponse } from '@replay-crate/spotify'
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

/** App wired to PGlite, a fake Spotify, and a controllable clock. */
export async function createTestContext() {
  const { db, close } = await createTestDb()
  let current = new Date('2026-09-21T12:00:00Z')

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
    login,
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms)
    },
    close,
  }
}
