import { schema } from '@replay-crate/db'
import { eq } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { ReauthRequiredError } from '../spotify/access-token.ts'
import { syncRecentlyPlayed } from './recently-played.ts'

export type UserSyncResult = { userId: string; inserted: number } | { userId: string; error: 'reauth_required' | 'failed' }

/**
 * Syncs recently played for every connected user, one at a time. A failure for one
 * user is logged and reported, never stops the others.
 */
export async function syncAllUsers(deps: AppDeps): Promise<UserSyncResult[]> {
  const active = await deps.db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.needsReauth, false))

  const results: UserSyncResult[] = []
  for (const { id } of active) {
    try {
      const { inserted } = await syncRecentlyPlayed(deps, id)
      results.push({ userId: id, inserted })
    } catch (error) {
      if (!(error instanceof ReauthRequiredError)) console.error(`sync failed for ${id}`, error)
      results.push({ userId: id, error: error instanceof ReauthRequiredError ? 'reauth_required' : 'failed' })
    }
  }
  return results
}
