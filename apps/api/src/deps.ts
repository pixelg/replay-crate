import type { Db } from '@replay-crate/db'
import type {
  Paging,
  PlayRequest,
  RecentlyPlayedPage,
  RepeatState,
  SpotifyDevice,
  SpotifyPlaybackState,
  SpotifyQueue,
  SpotifyArtist,
  SpotifyPlaylist,
  SpotifyPlaylistItem,
  SpotifyPlaylistMeta,
  SpotifySimplifiedAlbum,
  SpotifyTrack,
  SpotifyUser,
  TokenResponse,
  TopTimeRange,
} from '@replay-crate/spotify'
import type { TokenCipher } from './lib/crypto.ts'
import type { Analytics } from './search/analytics.ts'
import type { SearchIndex } from './search/types.ts'

/** The Spotify calls the API makes, already bound to our client id. Tests pass a fake. */
export type SpotifyGateway = {
  exchangeCode(params: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenResponse>
  refreshAccessToken(refreshToken: string): Promise<TokenResponse>
  getCurrentUser(accessToken: string): Promise<SpotifyUser>
  getRecentlyPlayed(accessToken: string): Promise<RecentlyPlayedPage>
  getPlaylistMeta(accessToken: string, id: string): Promise<SpotifyPlaylistMeta>
  getAlbum(accessToken: string, id: string): Promise<SpotifySimplifiedAlbum>
  getArtist(accessToken: string, id: string): Promise<SpotifyArtist>
  getMyPlaylists(accessToken: string, offset: number): Promise<Paging<SpotifyPlaylist>>
  getPlaylistItems(accessToken: string, playlistId: string, offset: number): Promise<Paging<SpotifyPlaylistItem>>
  createPlaylist(accessToken: string, details: { name: string; description?: string; public?: boolean }): Promise<SpotifyPlaylist>
  addPlaylistItems(accessToken: string, playlistId: string, uris: string[], position?: number): Promise<{ snapshot_id: string }>
  removePlaylistItems(accessToken: string, playlistId: string, uris: string[]): Promise<{ snapshot_id: string }>
  reorderPlaylistItems(
    accessToken: string,
    playlistId: string,
    move: { rangeStart: number; insertBefore: number; snapshotId?: string },
  ): Promise<{ snapshot_id: string }>
  getTopTracks(accessToken: string, timeRange: TopTimeRange): Promise<Paging<SpotifyTrack>>
  /** Spotify's catalogue, tracks only, at most 10. */
  searchTracks(accessToken: string, q: string, limit?: number): Promise<Paging<SpotifyTrack>>
  getTopArtists(accessToken: string, timeRange: TopTimeRange): Promise<Paging<SpotifyArtist>>
  getTrack(accessToken: string, id: string): Promise<SpotifyTrack>

  // Player. Commands go to `deviceId`, or the active device.
  getPlaybackState(accessToken: string): Promise<SpotifyPlaybackState | null>
  getQueue(accessToken: string): Promise<SpotifyQueue>
  getDevices(accessToken: string): Promise<SpotifyDevice[]>
  play(accessToken: string, request: PlayRequest & { deviceId?: string }): Promise<void>
  pause(accessToken: string, target: { deviceId?: string }): Promise<void>
  skipToNext(accessToken: string, target: { deviceId?: string }): Promise<void>
  skipToPrevious(accessToken: string, target: { deviceId?: string }): Promise<void>
  seek(accessToken: string, positionMs: number, target: { deviceId?: string }): Promise<void>
  setRepeat(accessToken: string, state: RepeatState, target: { deviceId?: string }): Promise<void>
  setShuffle(accessToken: string, on: boolean, target: { deviceId?: string }): Promise<void>
  setVolume(accessToken: string, percent: number, target: { deviceId?: string }): Promise<void>
  addToQueue(accessToken: string, uri: string, target: { deviceId?: string }): Promise<void>
  transferPlayback(accessToken: string, deviceId: string, options: { play?: boolean }): Promise<void>
}

export type AppDeps = {
  db: Db
  cipher: TokenCipher
  spotify: SpotifyGateway
  /** The redirect URI registered with Spotify. Its origin is the web app's origin. */
  redirectUri: string
  /** Bearer token for POST /api/v1/system/cron/poll. The endpoint is disabled when unset. */
  cronSecret?: string
  /** Library search: Elasticsearch when configured, Postgres otherwise. Kept in step by the search indexer. */
  search: SearchIndex
  /** Listening and search events for Kibana; only with Elasticsearch. */
  analytics?: Analytics
  now?: () => Date
}
