import type { Db } from '@replay-crate/db'
import type {
  Paging,
  RecentlyPlayedPage,
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
  getTopArtists(accessToken: string, timeRange: TopTimeRange): Promise<Paging<SpotifyArtist>>
}

export type AppDeps = {
  db: Db
  cipher: TokenCipher
  spotify: SpotifyGateway
  /** The redirect URI registered with Spotify. Its origin is the web app's origin. */
  redirectUri: string
  /** Bearer token for POST /api/cron/poll. The endpoint is disabled when unset. */
  cronSecret?: string
  now?: () => Date
}
