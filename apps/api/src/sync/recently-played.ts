import { schema } from '@replay-crate/db'
import type { PlayHistoryItem, SpotifyContext } from '@replay-crate/spotify'
import { eq, max } from 'drizzle-orm'
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
  /** Plays may have been missed since the last sync (see detectGap). */
  gap: { after: Date; before: Date } | null
  syncedAt: Date
}

/** Spotify's recently-played endpoint never returns more than this. */
export const RECENTLY_PLAYED_LIMIT = 50

/**
 * Plays were missed if Spotify sent a full page and even its oldest play is newer than
 * the newest one we already had: anything between the two was never seen. A partial page
 * with no overlap is fine, since Spotify sent everything since the last sync.
 */
export function detectGap(lastKnown: Date | null, page: Array<{ played_at: string }>) {
  if (!lastKnown || page.length < RECENTLY_PLAYED_LIMIT) return null
  const oldest = new Date(Math.min(...page.map((item) => new Date(item.played_at).getTime())))
  return oldest > lastKnown ? { after: lastKnown, before: oldest } : null
}

/** Records the user's latest plays. Safe to run as often as you like. */
export async function syncRecentlyPlayed(deps: AppDeps, userId: string): Promise<SyncResult> {
  const { db, spotify } = deps
  const accessToken = await getAccessToken(deps, userId)
  const page = await spotify.getRecentlyPlayed(accessToken)

  // The newest play we had before this sync, to tell whether Spotify's page reaches back to it.
  const [latest] = await db
    .select({ at: max(schema.plays.playedAt) })
    .from(schema.plays)
    .where(eq(schema.plays.userId, userId))
  const gap = detectGap(latest?.at ? new Date(latest.at) : null, page.items)

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
  if (gap) {
    await db.insert(schema.syncGaps).values({ userId, ...gap, detectedAt: syncedAt }).onConflictDoNothing()
  }

  await db.update(schema.users).set({ lastSyncedAt: syncedAt }).where(eq(schema.users.id, userId))

  return {
    fetched: page.items.length,
    inserted: inserted.length,
    skipped: page.items.length - items.length,
    gap,
    syncedAt,
  }
}
