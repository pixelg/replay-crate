export const SPOTIFY_ACCOUNTS_URL = 'https://accounts.spotify.com'
export const SPOTIFY_API_URL = 'https://api.spotify.com/v1'

/** OAuth scopes the app requests at login. */
export const SPOTIFY_SCOPES = [
  'user-read-recently-played',
  'user-top-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
  'playlist-modify-public',
] as const
