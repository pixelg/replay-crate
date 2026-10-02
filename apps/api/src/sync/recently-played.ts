import { schema, type Db } from '@replay-crate/db'
import type { PlayHistoryItem, SpotifyContext } from '@replay-crate/spotify'
import { and, eq, inArray, max } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { inContext } from '../player/in-context.ts'
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

/**
 * What each play was played from. Spotify names the context that was on even for a track the
 * user queued, or one autoplay chose after the context ended, so a context the track provably
 * isn't in (see inContext) is dropped: the play counts as played on its own.
 */
async function playedFrom(db: Db, items: PlayHistoryItem[]): Promise<Array<SpotifyContext | null>> {
  return Promise.all(
    items.map(async ({ track, context }) =>
      context && (await inContext(db, { ...track, type: 'track' }, context)) === false ? null : context,
    ),
  )
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
  // Already recorded plays are left alone, so only new ones are looked into.
  const known = items.length
    ? await db
        .select({ at: schema.plays.playedAt, type: schema.plays.contextType, uri: schema.plays.contextUri })
        .from(schema.plays)
        .where(and(eq(schema.plays.userId, userId), inArray(schema.plays.playedAt, items.map((item) => new Date(item.played_at)))))
    : []
  const recorded = new Set(known.map(({ at }) => at.getTime()))
  const fresh = items.filter((item) => !recorded.has(new Date(item.played_at).getTime()))
  const contexts = await playedFrom(db, fresh)

  const inserted = fresh.length
    ? await db
        .insert(schema.plays)
        .values(
          fresh.map((item, i) => ({
            userId,
            trackId: item.track.id,
            playedAt: new Date(item.played_at),
            contextType: contexts[i]?.type ?? null,
            contextUri: contexts[i]?.uri ?? null,
            source: 'poll' as const,
          })),
        )
        .onConflictDoNothing({ target: [schema.plays.userId, schema.plays.playedAt] })
        .returning({ id: schema.plays.id })
    : []

  // Recorded plays' contexts too: a lookup that failed for a moment is tried again.
  const recordedContexts = known.flatMap(({ type, uri }) => (type && uri ? [{ type, uri }] : []))
  await resolveContexts(deps, accessToken, [...contexts.filter((context): context is SpotifyContext => context != null), ...recordedContexts])

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
