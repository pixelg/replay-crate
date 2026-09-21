import { schema } from '@replay-crate/db'
import type { PlayHistoryItem, SpotifyContext } from '@replay-crate/spotify'
import { eq } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { getAccessToken } from '../spotify/access-token.ts'
import { upsertCatalog } from './catalog.ts'
import { resolveContexts } from './contexts.ts'

export type SyncResult = {
  /** Plays Spotify returned (at most 50). */
  fetched: number
  /** Plays we hadn't recorded yet. */
  inserted: number
  /** Local files, which have no Spotify id. */
  skipped: number
  syncedAt: Date
}

/** Records the user's latest plays. Safe to run as often as you like. */
export async function syncRecentlyPlayed(deps: AppDeps, userId: string): Promise<SyncResult> {
  const { db, spotify } = deps
  const accessToken = await getAccessToken(deps, userId)
  const page = await spotify.getRecentlyPlayed(accessToken)

  const items = page.items.filter(
    (item): item is PlayHistoryItem & { track: { id: string } } => item.track.id != null && !item.track.is_local,
  )
  await upsertCatalog(
    db,
    items.map((item) => item.track),
  )

  const inserted = items.length
    ? await db
        .insert(schema.plays)
        .values(
          items.map((item) => ({
            userId,
            trackId: item.track.id,
            playedAt: new Date(item.played_at),
            contextType: item.context?.type ?? null,
            contextUri: item.context?.uri ?? null,
            source: 'poll' as const,
          })),
        )
        .onConflictDoNothing({ target: [schema.plays.userId, schema.plays.playedAt] })
        .returning({ id: schema.plays.id })
    : []

  await resolveContexts(
    deps,
    accessToken,
    items.map((item) => item.context).filter((context): context is SpotifyContext => context != null),
  )

  const syncedAt = deps.now?.() ?? new Date()
  await db.update(schema.users).set({ lastSyncedAt: syncedAt }).where(eq(schema.users.id, userId))

  return { fetched: page.items.length, inserted: inserted.length, skipped: page.items.length - items.length, syncedAt }
}
