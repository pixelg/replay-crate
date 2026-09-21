import type { Db } from '@replay-crate/db'
import type {
  RecentlyPlayedPage,
  SpotifyArtist,
  SpotifyPlaylistMeta,
  SpotifySimplifiedAlbum,
  SpotifyUser,
  TokenResponse,
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
