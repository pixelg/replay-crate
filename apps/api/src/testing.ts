import { createTestDb } from '@replay-crate/db/testing'
import { vi } from 'vitest'
import { createApp } from './app.ts'
import type { AppDeps, SpotifyGateway } from './deps.ts'
import { createFakeLibrary, createFakeSpotify, fakePlayerFor } from './fakes.ts'
import { createTokenCipher } from './lib/crypto.ts'
import { drainAll } from './search/indexer.ts'
import { createPostgresSearchIndex } from './search/postgres.ts'

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
  const player = fakePlayerFor(library, { now: () => current.getTime() })
  const fake = createFakeSpotify(library, { player })
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
    getTopTracks: vi.fn<SpotifyGateway['getTopTracks']>(fake.getTopTracks),
    searchTracks: vi.fn<SpotifyGateway['searchTracks']>(fake.searchTracks),
    getTopArtists: vi.fn<SpotifyGateway['getTopArtists']>(fake.getTopArtists),
    getTrack: vi.fn<SpotifyGateway['getTrack']>(fake.getTrack),
    getPlaybackState: vi.fn<SpotifyGateway['getPlaybackState']>(fake.getPlaybackState),
    getQueue: vi.fn<SpotifyGateway['getQueue']>(fake.getQueue),
    getDevices: vi.fn<SpotifyGateway['getDevices']>(fake.getDevices),
    play: vi.fn<SpotifyGateway['play']>(fake.play),
    pause: vi.fn<SpotifyGateway['pause']>(fake.pause),
    skipToNext: vi.fn<SpotifyGateway['skipToNext']>(fake.skipToNext),
    skipToPrevious: vi.fn<SpotifyGateway['skipToPrevious']>(fake.skipToPrevious),
    seek: vi.fn<SpotifyGateway['seek']>(fake.seek),
    setRepeat: vi.fn<SpotifyGateway['setRepeat']>(fake.setRepeat),
    setShuffle: vi.fn<SpotifyGateway['setShuffle']>(fake.setShuffle),
    setVolume: vi.fn<SpotifyGateway['setVolume']>(fake.setVolume),
    addToQueue: vi.fn<SpotifyGateway['addToQueue']>(fake.addToQueue),
    transferPlayback: vi.fn<SpotifyGateway['transferPlayback']>(fake.transferPlayback),
  }
  const deps: AppDeps = {
    db,
    cipher: await createTokenCipher(TEST_KEY),
    spotify,
    redirectUri: REDIRECT_URI,
    cronSecret: CRON_SECRET,
    now: () => current,
    search: createPostgresSearchIndex(db),
  }

  const app = createApp(deps)

  /** Runs the login callback and returns the session token from the Set-Cookie header. */
  async function login() {
    const res = await app.request('/api/v1/auth/callback', {
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
    /** The fake player behind the player calls; seed it with `player.nowPlaying(track)`. */
    player,
    login,
    /** Runs the search indexer until the outbox is empty (the app does this in the background). */
    indexSearch: () => drainAll(deps),
    advance: (ms: number) => {
      current = new Date(current.getTime() + ms)
    },
    close,
  }
}
