import { schema, type Db } from '@replay-crate/db'
import type { ImportedPlay } from '@replay-crate/core'
import { and, count, desc, eq, gte, isNull, lte, sql } from 'drizzle-orm'
import { enqueue } from '../jobs/queue.ts'

const { importPlays, imports, jobs, syncGaps } = schema

/**
 * An imported play and a recorded play of the same track this close together are the same
 * play: the export's `ts` and the API's `played_at` both mark roughly when it finished.
 * TODO(#19): confirm against a real export and tighten if possible.
 */
export const DUPLICATE_WINDOW = '90 seconds'
const CHUNK = 2_000

export async function createImport(db: Db, userId: string, now: Date): Promise<number> {
  const [row] = await db.insert(imports).values({ userId, createdAt: now }).returning({ id: imports.id })
  return row!.id
}

/** The user's import, or null if it isn't theirs. */
export async function findImport(db: Db, userId: string, importId: number) {
  const [row] = await db
    .select()
    .from(imports)
    .where(and(eq(imports.id, importId), eq(imports.userId, userId)))
  return row ?? null
}

/** Stages a chunk of uploaded plays and widens the import's date range. */
export async function addPlays(db: Db, importId: number, userId: string, plays: ImportedPlay[]): Promise<void> {
  if (!plays.length) return
  for (let i = 0; i < plays.length; i += CHUNK) {
    await db.insert(importPlays).values(
      plays.slice(i, i + CHUNK).map((play) => ({
        importId,
        userId,
        trackId: play.trackId,
        playedAt: new Date(play.ts),
        msPlayed: play.ms,
      })),
    )
  }
  const times = plays.map((play) => play.ts).sort()
  await db
    .update(imports)
    .set({
      playCount: sql`${imports.playCount} + ${plays.length}`,
      earliest: sql`least(${imports.earliest}, ${new Date(times[0]!)})`,
      latest: sql`greatest(${imports.latest}, ${new Date(times.at(-1)!)})`,
    })
    .where(eq(imports.id, importId))
}

/**
 * Moves staged plays whose track is in the catalog into `plays` (optionally only for
 * `trackIds`), skipping any already recorded within DUPLICATE_WINDOW, then clears them
 * from staging. Safe to run repeatedly.
 */
export async function promote(db: Db, trackIds?: string[]): Promise<void> {
  if (trackIds && !trackIds.length) return
  const onlyTracks = trackIds
    ? sql`and ip.track_id in (${sql.join(
        trackIds.map((id) => sql`${id}`),
        sql`, `,
      )})`
    : sql``

  await db.execute(sql`
    insert into plays (user_id, track_id, played_at, ms_played, source)
    select ip.user_id, ip.track_id, ip.played_at, ip.ms_played, 'import'
    from import_plays ip
    where exists (select 1 from tracks t where t.id = ip.track_id) ${onlyTracks}
      and not exists (
        select 1 from plays p
        where p.user_id = ip.user_id
          and p.track_id = ip.track_id
          and p.played_at between ip.played_at - interval '${sql.raw(DUPLICATE_WINDOW)}'
                              and ip.played_at + interval '${sql.raw(DUPLICATE_WINDOW)}'
      )
    on conflict (user_id, played_at) do nothing
  `)
  await db.execute(sql`
    delete from import_plays ip
    where exists (select 1 from tracks t where t.id = ip.track_id) ${onlyTracks}
  `)
}

/**
 * Spotify no longer has this track: its staged plays can't be linked to the catalog.
 * Count them against their imports and drop them.
 */
export async function discardTrack(db: Db, trackId: string): Promise<void> {
  const perImport = await db
    .select({ importId: importPlays.importId, n: count() })
    .from(importPlays)
    .where(eq(importPlays.trackId, trackId))
    .groupBy(importPlays.importId)
  for (const { importId, n } of perImport) {
    await db
      .update(imports)
      .set({ unavailable: sql`${imports.unavailable} + ${n}` })
      .where(eq(imports.id, importId))
  }
  await db.delete(importPlays).where(eq(importPlays.trackId, trackId))
}

/**
 * All plays are uploaded: move over what we can now, queue a Spotify lookup for every
 * track we don't know yet (its plays move over when it arrives), and mark any history
 * gaps this import covers as filled.
 */
export async function finishUpload(db: Db, importId: number, userId: string, now: Date) {
  await db.update(imports).set({ uploadedAt: now }).where(eq(imports.id, importId))
  await promote(db)

  const unknown = await db
    .selectDistinct({ trackId: importPlays.trackId })
    .from(importPlays)
    .where(eq(importPlays.importId, importId))
  await enqueue(
    db,
    unknown.map(({ trackId }) => ({ kind: 'track' as const, ref: trackId, userId })),
    now,
  )

  const [range] = await db
    .select({ earliest: imports.earliest, latest: imports.latest })
    .from(imports)
    .where(eq(imports.id, importId))
  if (range?.earliest && range.latest) {
    await db
      .update(syncGaps)
      .set({ filledAt: now })
      .where(
        and(
          eq(syncGaps.userId, userId),
          isNull(syncGaps.filledAt),
          // The import spans the whole window the gap left unrecorded.
          gte(syncGaps.after, range.earliest),
          lte(syncGaps.before, range.latest),
        ),
      )
  }
  return { tracksToFetch: unknown.length }
}

/** The user's most recent import with how much is still waiting on Spotify. */
export async function latestImport(db: Db, userId: string) {
  const [row] = await db.select().from(imports).where(eq(imports.userId, userId)).orderBy(desc(imports.id)).limit(1)
  if (!row) return null
  const [waiting] = await db.select({ n: count() }).from(importPlays).where(eq(importPlays.importId, row.id))
  const [queued] = await db
    .select({ n: count() })
    .from(jobs)
    .where(and(eq(jobs.userId, userId), eq(jobs.kind, 'track')))
  return {
    id: row.id,
    playCount: row.playCount,
    earliest: row.earliest?.toISOString() ?? null,
    latest: row.latest?.toISOString() ?? null,
    unavailable: row.unavailable,
    createdAt: row.createdAt.toISOString(),
    uploadedAt: row.uploadedAt?.toISOString() ?? null,
    /** Plays still waiting for their track's details. */
    waitingPlays: waiting?.n ?? 0,
    /** Tracks still to look up on Spotify. */
    tracksToFetch: queued?.n ?? 0,
    done: Boolean(row.uploadedAt) && (waiting?.n ?? 0) === 0,
  }
}
