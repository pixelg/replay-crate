import type { Db } from '@replay-crate/db'
import type { SpotifyUser, TokenResponse } from '@replay-crate/spotify'
import type { TokenCipher } from './lib/crypto.ts'

/** The Spotify calls the API makes, already bound to our client id. Tests pass a fake. */
export type SpotifyGateway = {
  exchangeCode(params: { code: string; codeVerifier: string; redirectUri: string }): Promise<TokenResponse>
  refreshAccessToken(refreshToken: string): Promise<TokenResponse>
  getCurrentUser(accessToken: string): Promise<SpotifyUser>
}

export type AppDeps = {
  db: Db
  cipher: TokenCipher
  spotify: SpotifyGateway
  /** The redirect URI registered with Spotify. Its origin is the web app's origin. */
  redirectUri: string
  now?: () => Date
}
