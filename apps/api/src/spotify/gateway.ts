import {
  exchangeCode,
  getAlbum,
  getArtist,
  getCurrentUser,
  getPlaylistMeta,
  getRecentlyPlayed,
  refreshAccessToken,
} from '@replay-crate/spotify'
import type { SpotifyGateway } from '../deps.ts'

export function createSpotifyGateway(clientId: string): SpotifyGateway {
  return {
    exchangeCode: (params) => exchangeCode({ clientId, ...params }),
    refreshAccessToken: (refreshToken) => refreshAccessToken({ clientId, refreshToken }),
    getCurrentUser: (accessToken) => getCurrentUser(accessToken),
    getRecentlyPlayed: (accessToken) => getRecentlyPlayed(accessToken),
    getPlaylistMeta: (accessToken, id) => getPlaylistMeta(accessToken, id),
    getAlbum: (accessToken, id) => getAlbum(accessToken, id),
    getArtist: (accessToken, id) => getArtist(accessToken, id),
  }
}
