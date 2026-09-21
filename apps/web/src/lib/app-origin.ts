/**
 * The app only works on the origin of SPOTIFY_REDIRECT_URI: Spotify sends logins back
 * there, and both the pending login (sessionStorage) and the session cookie belong to a
 * single origin. Opened anywhere else (say `localhost` instead of `127.0.0.1`), sign-in
 * fails. Returns where to go instead, or null when already on the right origin.
 */
export function urlOnAppOrigin(current: URL, redirectUri: string): string | null {
  const origin = new URL(redirectUri).origin
  if (current.origin === origin) return null
  return `${origin}${current.pathname}${current.search}${current.hash}`
}
