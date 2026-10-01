import { isFinished, mergeListen } from '@replay-crate/core'
import { schema, type Db } from '@replay-crate/db'
import type { SpotifyEpisode, SpotifyPlaybackState } from '@replay-crate/spotify'
import { and, desc, eq, sql } from 'drizzle-orm'
import { enqueue } from '../jobs/enqueue.ts'
import { saveProgress, upsertEpisodes } from './catalog.ts'

const { episodeListens, episodes, playerWatch } = schema

/** Snapshots closer together than this are one moment: only the first is recorded. */
export const OBSERVE_EVERY_MS = 25_000

/** The `episode` job's ref: resume points are per user, so one job per user and episode. */
export const episodeJobRef = (userId: string, episodeId: string) => `${userId}:${episodeId}`

export function parseEpisodeJobRef(ref: string): { userId: string; episodeId: string } {
  const at = ref.lastIndexOf(':')
  return { userId: ref.slice(0, at), episodeId: ref.slice(at + 1) }
}

/**
 * Records what a user's player shows (`state`, null when nothing is active) at `at`: an episode
 * playing starts or carries on a listen (see `mergeListen`) and moves its progress. Called by every
 * look at the player, the app's polls and the background watcher alike; the `player_watch` row
 * lets only one of them record each moment, across processes. When the episode changes, the one
 * before is queued for a lookup of Spotify's resume point. Returns whether this call recorded.
 */
export async function recordObservation(db: Db, userId: string, state: SpotifyPlaybackState | null, at: Date): Promise<boolean> {
  const item = state?.item?.type === 'episode' ? state.item : null

  // One statement claims the moment and reads the episode the last claim saw.
  const claimed = (await db.execute(sql`
    with old as (select ${playerWatch.episodeId} as episode_id from ${playerWatch} where ${playerWatch.userId} = ${userId})
    insert into ${playerWatch} (user_id, observed_at, episode_id)
    values (${userId}, ${at.toISOString()}, ${item?.id ?? null})
    on conflict (user_id) do update set observed_at = excluded.observed_at, episode_id = excluded.episode_id
      where ${playerWatch.observedAt} <= ${new Date(at.getTime() - OBSERVE_EVERY_MS).toISOString()}
    returning (select episode_id from old) as previous`)) as unknown as { rows: Array<{ previous: string | null }> }
  const [row] = claimed.rows
  if (!row) return false

  if (row.previous && row.previous !== item?.id) {
    await enqueue(db, [{ kind: 'episode', ref: episodeJobRef(userId, row.previous), userId }], at)
  }
  if (!item || !state || state.progress_ms === null) return true
  await recordEpisode(db, userId, item, state, at)
  return true
}

async function recordEpisode(db: Db, userId: string, item: SpotifyEpisode, state: SpotifyPlaybackState, at: Date) {
  const [known] = await db.select({ releaseDate: episodes.releaseDate }).from(episodes).where(eq(episodes.id, item.id))
  if (!known) await upsertEpisodes(db, [item])
  // The player can leave out the release date; a lookup fills it in (and the resume point).
  if (!known?.releaseDate && !item.release_date) {
    await enqueue(db, [{ kind: 'episode', ref: episodeJobRef(userId, item.id), userId }], at)
  }

  const positionMs = state.progress_ms ?? 0
  const [open] = await db
    .select()
    .from(episodeListens)
    .where(and(eq(episodeListens.userId, userId), eq(episodeListens.episodeId, item.id), eq(episodeListens.source, 'poll')))
    .orderBy(desc(episodeListens.lastSeenAt))
    .limit(1)
  const step = mergeListen(open && open.endPositionMs !== null ? { lastSeenAt: open.lastSeenAt.getTime(), positionMs: open.endPositionMs } : null, {
    at: at.getTime(),
    positionMs,
    isPlaying: state.is_playing,
    durationMs: item.duration_ms,
    changedAt: state.timestamp,
  })

  if (step.kind === 'continue' && open) {
    await db
      .update(episodeListens)
      .set({
        listenedMs: sql`${episodeListens.listenedMs} + ${step.listenedMs}`,
        endPositionMs: step.positionMs,
        lastSeenAt: at,
        ...(step.advanced && { endedAt: at }),
      })
      .where(eq(episodeListens.id, open.id))
  } else if (step.kind === 'start') {
    await db
      .insert(episodeListens)
      .values({
        userId,
        episodeId: item.id,
        startedAt: new Date(step.startedAt),
        endedAt: at,
        lastSeenAt: at,
        startPositionMs: Math.max(0, step.positionMs - step.listenedMs),
        endPositionMs: step.positionMs,
        listenedMs: step.listenedMs,
        contextUri: state.context?.uri ?? null,
        source: 'poll',
      })
      .onConflictDoNothing()
  }
  if (step.kind !== 'ignore') {
    await saveProgress(db, { userId, episodeId: item.id, resumePositionMs: positionMs, fullyPlayed: isFinished(positionMs, item.duration_ms) }, at)
  }
}
