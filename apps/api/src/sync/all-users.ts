import { schema } from '@replay-crate/db'
import { eq } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { SpotifyApiError } from '@replay-crate/spotify'
import { pauseSpotify } from '../jobs/budget.ts'
import { missingScopes } from '../auth/me.ts'
import { SHOWS_SYNC_STALE_MS, syncFollowedShows } from '../podcasts/shows.ts'
import { ReauthRequiredError } from '../spotify/access-token.ts'
import { syncRecentlyPlayed } from './recently-played.ts'

export type UserSyncResult = { userId: string; inserted: number } | { userId: string; error: 'reauth_required' | 'failed' }

/**
 * Syncs recently played for every connected user, one at a time. A failure for one
 * user is logged and reported, never stops the others, except Spotify saying to slow down:
 * that's recorded for every process, and the rest wait for the next round.
 */
export async function syncAllUsers(deps: AppDeps): Promise<UserSyncResult[]> {
  const active = await deps.db
    .select({ id: schema.users.id, scope: schema.users.scope, showsSyncedAt: schema.users.showsSyncedAt })
    .from(schema.users)
    .where(eq(schema.users.needsReauth, false))

  const results: UserSyncResult[] = []
  const pauseFor = async (error: SpotifyApiError) => {
    const now = deps.now?.() ?? new Date()
    await pauseSpotify(deps.db, new Date(now.getTime() + (error.retryAfter ?? 60) * 1000), now)
  }
  for (const { id, scope, showsSyncedAt } of active) {
    try {
      const { inserted } = await syncRecentlyPlayed(deps, id)
      results.push({ userId: id, inserted })
    } catch (error) {
      if (!(error instanceof ReauthRequiredError)) console.error(`sync failed for ${id}`, error)
      results.push({ userId: id, error: error instanceof ReauthRequiredError ? 'reauth_required' : 'failed' })
      if (error instanceof SpotifyApiError && error.status === 429) {
        await pauseFor(error)
        break
      }
      continue
    }
    // The shows they follow, twice a day, so new episodes turn up with no browser open. A failure
    // here is logged; the plays above are in either way.
    const now = deps.now?.() ?? new Date()
    const showsStale = !showsSyncedAt || now.getTime() - showsSyncedAt.getTime() > SHOWS_SYNC_STALE_MS
    if (!showsStale || missingScopes(scope).includes('user-library-read')) continue
    try {
      await syncFollowedShows(deps, id)
    } catch (error) {
      console.error(`syncing followed shows failed for ${id}`, error)
      if (error instanceof SpotifyApiError && error.status === 429) {
        await pauseFor(error)
        break
      }
    }
  }
  return results
}
