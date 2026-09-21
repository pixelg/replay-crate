import { SpotifyApiError } from '@replay-crate/spotify'
import type { Context } from 'hono'
import { ReauthRequiredError } from './access-token.ts'

/**
 * Maps the Spotify failures a route can expect to API responses; returns null for anything
 * else so the caller rethrows it (and it becomes a logged 500).
 */
export function spotifyErrorResponse(c: Context, error: unknown) {
  if (error instanceof ReauthRequiredError) return c.json({ error: 'reauth_required' as const }, 409)
  if (error instanceof SpotifyApiError) {
    if (error.status === 429) return c.json({ error: 'rate_limited' as const, retryAfter: error.retryAfter ?? null }, 503)
    if (error.status === 403) return c.json({ error: 'forbidden' as const }, 403)
    if (error.status === 404) return c.json({ error: 'not_found' as const }, 404)
  }
  return null
}
