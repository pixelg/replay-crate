import { exchangeCode, getCurrentUser, refreshAccessToken } from '@replay-crate/spotify'
import type { SpotifyGateway } from '../deps.ts'

export function createSpotifyGateway(clientId: string): SpotifyGateway {
  return {
    exchangeCode: (params) => exchangeCode({ clientId, ...params }),
    refreshAccessToken: (refreshToken) => refreshAccessToken({ clientId, refreshToken }),
    getCurrentUser: (accessToken) => getCurrentUser(accessToken),
  }
}
