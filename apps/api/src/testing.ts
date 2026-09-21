import { createTestDb } from '@replay-crate/db/testing'
import { vi } from 'vitest'
import { createApp } from './app.ts'
import type { AppDeps, SpotifyGateway } from './deps.ts'
import { createFakeLibrary, createFakeSpotify } from './fakes.ts'
import { createTokenCipher } from './lib/crypto.ts'

export {
  createFakeLibrary,
  paged,
  play,
  playlist,
  playlistContext,
  playlistEntry,
  tokens,
  track,
} from './fakes.ts'

export const REDIRECT_URI = 'http://127.0.0.1:5173/callback'
export const TEST_KEY = Buffer.alloc(32, 7).toString('base64')
export const CRON_SECRET = 'cron-secret-for-tests'

/** App wired to PGlite, a fake Spotify (every call a vi.fn), and a controllable clock. */
export async function createTestContext() {
  const { db, close } = await createTestDb()
  let current = new Date('2026-09-21T12:00:00Z')

  const library = createFakeLibrary()
  const fake = createFakeSpotify(library)
  const spotify = {
    exchangeCode: vi.fn<SpotifyGateway['exchangeCode']>(fake.exchangeCode),
    refreshAccessToken: vi.fn<SpotifyGateway['refreshAccessToken']>(fake.refreshAccessToken),
    getCurrentUser: vi.fn<SpotifyGateway['getCurrentUser']>(fake.getCurrentUser),
    getRecentlyPlayed: vi.fn<SpotifyGateway['getRecentlyPlayed']>(fake.getRecentlyPlayed),
    getPlaylistMeta: vi.fn<SpotifyGateway['getPlaylistMeta']>(fake.getPlaylistMeta),
    getAlbum: vi.fn<SpotifyGateway['getAlbum']>(fake.getAlbum),
    getArtist: vi.fn<SpotifyGateway['getArtist']>(fake.getArtist),
    getMyPlaylists: vi.fn<SpotifyGateway['getMyPlaylists']>(fake.getMyPlaylists),
    getPlaylistItems: vi.fn<SpotifyGateway['getPlaylistItems']>(fake.getPlaylistItems),
    createPlaylist: vi.fn<SpotifyGateway['createPlaylist']>(fake.createPlaylist),
    addPlaylistItems: vi.fn<SpotifyGateway['addPlaylistItems']>(fake.addPlaylistItems),
    removePlaylistItems: vi.fn<SpotifyGateway['removePlaylistItems']>(fake.removePlaylistItems),
    reorderPlaylistItems: vi.fn<SpotifyGateway['reorderPlaylistItems']>(fake.reorderPlaylistItems),
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
