import { schema, type Db } from '@replay-crate/db'
import { and, asc, count, eq, isNotNull, isNull, lt, max, or, sql, type SQL } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { enqueue } from '../jobs/enqueue.ts'

// Moves are saved here first and sent to Spotify after (Spotify can be paused for hours, or
// refuse): the stored items take the new order at once, `playlist_edits` remembers what Spotify
// still needs, and one `playlist-edit` job per move sends the playlist's oldest move each time.

const { playlistEdits, playlists } = schema

const rows = async <T>(db: Db, query: SQL) => ((await db.execute(query)) as unknown as { rows: T[] }).rows

/** A move Spotify refused is waiting on the user (retry, or back to Spotify's order). */
export class UnsavedMovesError extends Error {
  constructor(playlistId: string) {
    super(`Playlist ${playlistId} has moves Spotify refused`)
    this.name = 'UnsavedMovesError'
  }
}

export class MoveOutOfRangeError extends Error {
  constructor() {
    super('Position is past the end of the playlist')
    this.name = 'MoveOutOfRangeError'
  }
}

/** `userId:playlistId:editId`: any job for the playlist sends its oldest move, so they stay in order. */
export const editJobRef = (userId: string, playlistId: string, editId: number) => `${userId}:${playlistId}:${editId}`

export function parseEditJobRef(ref: string) {
  const parts = ref.split(':')
  const editId = Number(parts.pop())
  const playlistId = parts.pop()!
  return { userId: parts.join(':'), playlistId, editId }
}

/** Moves the item at `from` to `to` in the stored playlist and queues the move for Spotify. */
export async function saveMove(deps: AppDeps, userId: string, playlistId: string, from: number, to: number): Promise<void> {
  if (from === to) return
  const { db } = deps
  const [last] = await rows<{ n: number | null }>(db, sql`
    select greatest(
      (select max(position) from playlist_items where playlist_id = ${playlistId}),
      (select max(position) from playlist_episodes where playlist_id = ${playlistId})
    ) as n`)
  if (last?.n == null || from > last.n || to > last.n) throw new MoveOutOfRangeError()

  // One statement, so the stored order and the record of it change together.
  const [edit] = await rows<{ id: number }>(
    db,
    sql`
      with moved as (select move_playlist_item(${playlistId}, ${from}::int, ${to}::int))
      insert into playlist_edits (user_id, playlist_id, from_position, to_position)
      select ${userId}, ${playlistId}, ${from}, ${to} from moved
      returning id`,
  )
  await enqueue(db, [{ kind: 'playlist-edit', ref: editJobRef(userId, playlistId, edit!.id), userId }], deps.now?.())
}

/** How long a sender holds a move while it calls Spotify; a crashed one's claim lapses after it. */
const SENDING_MS = 30_000

export type SendResult = 'sent' | 'none' | 'blocked' | 'busy'

/**
 * Sends the playlist's oldest unsent move to Spotify (one call), against the version the stored
 * items came from. 'none' when nothing is left, 'blocked' behind a refused one, 'busy' while
 * another sender (a job, or a request sending them at once) has it.
 */
export async function sendOldestMove(deps: AppDeps, userId: string, playlistId: string, accessToken: string): Promise<SendResult> {
  const { db } = deps
  const now = deps.now?.() ?? new Date()
  const mine = and(eq(playlistEdits.userId, userId), eq(playlistEdits.playlistId, playlistId))
  const [oldest] = await db.select().from(playlistEdits).where(mine).orderBy(asc(playlistEdits.id)).limit(1)
  if (!oldest) return 'none'
  const [refused] = await db.select({ id: playlistEdits.id }).from(playlistEdits).where(and(mine, isNotNull(playlistEdits.failedAt))).limit(1)
  if (refused) return 'blocked'
  // Claimed in one statement, so two senders never both send it.
  const [edit] = await db
    .update(playlistEdits)
    .set({ sendingUntil: new Date(now.getTime() + SENDING_MS) })
    .where(and(eq(playlistEdits.id, oldest.id), or(isNull(playlistEdits.sendingUntil), lt(playlistEdits.sendingUntil, now))))
    .returning()
  if (!edit) return 'busy'
  const [playlist] = await db.select({ snapshotId: playlists.itemsSnapshotId }).from(playlists).where(eq(playlists.id, playlistId))

  const { fromPosition: from, toPosition: to } = edit
  let snapshotId: string
  try {
    // Spotify inserts *before* an index of the original list, so moving down targets to + 1.
    ;({ snapshot_id: snapshotId } = await deps.spotify.reorderPlaylistItems(accessToken, playlistId, {
      rangeStart: from,
      insertBefore: to > from ? to + 1 : to,
      // The version this move was made on, so Spotify applies it to the list the user saw.
      snapshotId: playlist?.snapshotId ?? undefined,
    }))
  } catch (error) {
    await db.update(playlistEdits).set({ sendingUntil: null }).where(eq(playlistEdits.id, edit.id))
    throw error
  }
  // The stored items already have the move: they are now that version.
  await db.update(playlists).set({ itemsSnapshotId: snapshotId }).where(eq(playlists.id, playlistId))
  await db.delete(playlistEdits).where(eq(playlistEdits.id, edit.id))
  return 'sent'
}

/**
 * Sends every unsent move now, in order: before another change to the playlist (`wait`, which
 * waits out another sender and throws if a move was refused), or to get a move to Spotify without
 * waiting for its job (which then finds nothing left; stops at a refused move or another sender).
 */
export async function sendPendingMoves(
  deps: AppDeps,
  userId: string,
  playlistId: string,
  accessToken: string,
  { wait = true }: { wait?: boolean } = {},
): Promise<void> {
  for (let busy = 0; ; ) {
    const result = await sendOldestMove(deps, userId, playlistId, accessToken)
    if (result === 'none') return
    if (result === 'blocked') {
      if (wait) throw new UnsavedMovesError(playlistId)
      return
    }
    if (result === 'busy') {
      if (!wait || ++busy > 20) return
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
}

/** Spotify refused a move (the playlist changed there, most likely): it and the ones after wait on the user. */
export async function refuseMoves(deps: AppDeps, ref: string): Promise<void> {
  const { userId, playlistId } = parseEditJobRef(ref)
  await deps.db
    .update(playlistEdits)
    .set({ failedAt: deps.now?.() ?? new Date(), error: 'Spotify refused the move. The playlist may have changed in Spotify.' })
    .where(and(eq(playlistEdits.userId, userId), eq(playlistEdits.playlistId, playlistId), isNull(playlistEdits.failedAt)))
}

/** Whether anyone's moves are still waiting for Spotify (so re-reading it would undo them). */
export async function hasUnsentMoves(db: Db, playlistId: string): Promise<boolean> {
  const [row] = await db.select({ id: playlistEdits.id }).from(playlistEdits).where(eq(playlistEdits.playlistId, playlistId)).limit(1)
  return !!row
}

/** What the user's moves on this playlist are waiting for, or null when Spotify has them all. */
export async function unsentMoves(db: Db, userId: string, playlistId: string) {
  const [row] = await db
    .select({ moves: count(), failedAt: max(playlistEdits.failedAt), error: max(playlistEdits.error) })
    .from(playlistEdits)
    .where(and(eq(playlistEdits.userId, userId), eq(playlistEdits.playlistId, playlistId)))
  if (!row?.moves) return null
  return { moves: row.moves, failed: row.failedAt != null, error: row.error }
}

/** Tries the refused moves again, in order. */
export async function retryMoves(deps: AppDeps, userId: string, playlistId: string): Promise<void> {
  const mine = and(eq(playlistEdits.userId, userId), eq(playlistEdits.playlistId, playlistId))
  const edits = await deps.db.update(playlistEdits).set({ failedAt: null, error: null }).where(mine).returning({ id: playlistEdits.id })
  await enqueue(
    deps.db,
    edits.map((edit) => ({ kind: 'playlist-edit' as const, ref: editJobRef(userId, playlistId, edit.id), userId })),
    deps.now?.(),
  )
}

/** Forgets the unsent moves; the caller re-reads the playlist from Spotify. */
export async function discardMoves(db: Db, userId: string, playlistId: string): Promise<void> {
  await db.delete(playlistEdits).where(and(eq(playlistEdits.userId, userId), eq(playlistEdits.playlistId, playlistId)))
  // Forces the re-read even if Spotify's version hasn't changed.
  await db.update(playlists).set({ itemsSnapshotId: null }).where(eq(playlists.id, playlistId))
}
