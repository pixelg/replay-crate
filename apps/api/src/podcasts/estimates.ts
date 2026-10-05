import { schema, type Db } from '@replay-crate/db'
import { and, eq, gt, min, ne } from 'drizzle-orm'
import { saveProgress } from './catalog.ts'

const { episodeListens, episodeProgress, playerWatch } = schema

/** A resume point this little ahead of what the app knew is Spotify running ahead of the watcher, not a listen. */
export const MIN_ESTIMATE_MS = 2 * 60_000
/** The player showed the episode this recently: the watcher is on it and records the listen itself. */
const WATCHED_MS = 10 * 60_000

export type ResumePoint = {
  userId: string
  episode: { id: string; durationMs: number; releaseDate: string | null }
  resumePositionMs: number
  fullyPlayed: boolean
  /**
   * The episode was known not to be started by then (it was among its show's episodes at the
   * show's last refresh, with no progress): an estimate's window can start there.
   */
  unstartedAt?: Date | null
}

/**
 * Stores Spotify's resume point for an episode, first recording as an `estimate` listen what it
 * says was heard since the app last knew where the user was: Spotify never lists episodes in
 * recently-played, so listening while nobody watched the player (the phone, with the server off)
 * shows up only here. The listen spans the window it happened in (from when the app last knew the
 * position to `at`), not the listen itself, and holds the difference in position.
 *
 * No estimate when the position didn't move on (or went back: a replay can't be told apart), when
 * another listen already covers the window (the player, or an import), or for an episode the app
 * has no starting point for: one never seen with progress, released before the app began
 * watching the player. Returns whether it recorded one.
 */
export async function saveResumePoint(db: Db, point: ResumePoint, at: Date): Promise<boolean> {
  const { userId, episode } = point
  const estimated = await estimate(db, point, at)
  await saveProgress(
    db,
    { userId, episodeId: episode.id, resumePositionMs: point.resumePositionMs, fullyPlayed: point.fullyPlayed, authoritative: true },
    at,
  )
  return estimated
}

async function estimate(db: Db, point: ResumePoint, at: Date): Promise<boolean> {
  const { userId, episode } = point
  // Spotify puts a finished episode's resume point back to 0.
  const position = (p: { fullyPlayed: boolean; resumePositionMs: number }) => (p.fullyPlayed ? episode.durationMs : p.resumePositionMs)

  const [known] = await db
    .select()
    .from(episodeProgress)
    .where(and(eq(episodeProgress.userId, userId), eq(episodeProgress.episodeId, episode.id)))
  const from = known ? position(known) : 0
  const windowStart = known ? known.updatedAt : await unstartedSince(db, point)
  if (!windowStart || windowStart >= at) return false
  const heard = position(point) - from
  if (heard < MIN_ESTIMATE_MS) return false

  const [watched] = await db.select().from(playerWatch).where(eq(playerWatch.userId, userId))
  if (watched?.episodeId === episode.id && at.getTime() - watched.observedAt.getTime() < WATCHED_MS) return false
  const [covered] = await db
    .select({ id: episodeListens.id })
    .from(episodeListens)
    .where(
      and(
        eq(episodeListens.userId, userId),
        eq(episodeListens.episodeId, episode.id),
        ne(episodeListens.source, 'estimate'),
        gt(episodeListens.endedAt, windowStart),
      ),
    )
    .limit(1)
  if (covered) return false

  const inserted = await db
    .insert(episodeListens)
    .values({
      userId,
      episodeId: episode.id,
      startedAt: windowStart,
      endedAt: at,
      lastSeenAt: at,
      startPositionMs: from,
      endPositionMs: position(point),
      listenedMs: heard,
      source: 'estimate',
    })
    .onConflictDoNothing()
    .returning({ id: episodeListens.id })
  return inserted.length > 0
}

/**
 * Since when an episode with no stored progress is known to have been unstarted: the later of its
 * release and its show's last refresh, as long as the app was already watching the player by then.
 * Before that, it may have been heard before the app existed (an import's job, not a guess's).
 */
async function unstartedSince(db: Db, { userId, episode, unstartedAt }: ResumePoint): Promise<Date | null> {
  const [first] = await db
    .select({ at: min(episodeListens.startedAt) })
    .from(episodeListens)
    .where(and(eq(episodeListens.userId, userId), eq(episodeListens.source, 'poll')))
  const watchingSince = first?.at ? new Date(first.at) : null
  if (!watchingSince) return null
  const bounds = [releaseTime(episode.releaseDate), unstartedAt].filter((d) => d instanceof Date)
  if (!bounds.length) return null
  const since = new Date(Math.max(...bounds.map((d) => d.getTime())))
  return since >= watchingSince ? since : null
}

/** Spotify's release date (`2026-10-03`, or just a year or month) as the start of that day, UTC. */
function releaseTime(date: string | null): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return null
  return new Date(`${date}T00:00:00Z`)
}
