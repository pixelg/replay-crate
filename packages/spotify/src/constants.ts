export const SPOTIFY_ACCOUNTS_URL = 'https://accounts.spotify.com'
export const SPOTIFY_API_URL = 'https://api.spotify.com/v1'

/**
 * OAuth scopes the app requests at login. Adding one asks existing users to reconnect: the API
 * compares this list with the scopes each user granted (`missingScopes` on /auth/me).
 */
export const SPOTIFY_SCOPES = [
  'user-read-recently-played',
  'user-top-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
  // The player (M9): read what's playing, the queue and devices; control playback.
  'user-read-playback-state',
  'user-read-currently-playing',
  'user-modify-playback-state',
] as const
