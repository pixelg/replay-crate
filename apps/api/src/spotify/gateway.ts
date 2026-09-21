import {
  addPlaylistItems,
  createPlaylist,
  exchangeCode,
  getAlbum,
  getArtist,
  getCurrentUser,
  getMyPlaylists,
  getPlaylistItems,
  getPlaylistMeta,
  getRecentlyPlayed,
  refreshAccessToken,
  removePlaylistItems,
  reorderPlaylistItems,
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
    getMyPlaylists: (accessToken, offset) => getMyPlaylists(accessToken, offset),
    getPlaylistItems: (accessToken, playlistId, offset) => getPlaylistItems(accessToken, playlistId, offset),
    createPlaylist: (accessToken, details) => createPlaylist(accessToken, details),
    addPlaylistItems: (accessToken, playlistId, uris, position) => addPlaylistItems(accessToken, playlistId, uris, position),
    removePlaylistItems: (accessToken, playlistId, uris) => removePlaylistItems(accessToken, playlistId, uris),
    reorderPlaylistItems: (accessToken, playlistId, move) => reorderPlaylistItems(accessToken, playlistId, move),
  }
}
