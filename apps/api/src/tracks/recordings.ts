import { schema, type Db } from '@replay-crate/db'
import { inArray, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm'

// One recording, several Spotify tracks: the same ISRC on a single, an album, a deluxe edition.
// Plays and ratings live on the recording's canonical track (`tracks.recording_of` points the
// other copies at it; migration 0025). Spotify's own lists (playlists, what's playing) name
// whichever copy they hold, so lookups by such an id go through these.

const { tracks } = schema

/** A `tracks` row's recording: its canonical track's id. */
export const recordingId = sql<string>`coalesce(${tracks.recordingOf}, ${tracks.id})`

/** The canonical track of `trackId`'s recording: itself unless it's another copy. */
export async function canonicalTrackId(db: Db, trackId: string): Promise<string> {
  const { rows } = (await db.execute(sql`select track_recording(${trackId}) as id`)) as unknown as { rows: { id: string }[] }
  return rows[0]?.id ?? trackId
}

/** Each of `trackIds`' recording (canonical track id); ids not in the catalog map to themselves. */
export async function recordingsOf(db: Db, trackIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(trackIds)]
  const known = ids.length
    ? await db.select({ id: tracks.id, recording: recordingId }).from(tracks).where(inArray(tracks.id, ids))
    : []
  const byId = new Map(known.map((row) => [row.id, row.recording]))
  return new Map(ids.map((id) => [id, byId.get(id) ?? id]))
}

/**
 * The recording of each of Spotify's `items`, by id when the catalog has the track, else by ISRC
 * when it has another copy; null for recordings it doesn't know.
 */
export async function recordingsOfSpotifyTracks(
  db: Db,
  items: Array<{ id: string; external_ids?: { isrc?: string } }>,
): Promise<Map<string, string | null>> {
  if (!items.length) return new Map()
  const ids = [...new Set(items.map((item) => item.id))]
  const isrcs = [...new Set(items.flatMap((item) => (item.external_ids?.isrc ? [item.external_ids.isrc] : [])))]
  const rows = await db
    .select({ id: tracks.id, isrc: tracks.isrc, recording: recordingId })
    .from(tracks)
    .where(isrcs.length ? or(inArray(tracks.id, ids), inArray(tracks.isrc, isrcs)) : inArray(tracks.id, ids))
  const byId = new Map(rows.map((row) => [row.id, row.recording]))
  const byIsrc = new Map(rows.flatMap((row) => (row.isrc ? [[row.isrc, row.recording] as const] : [])))
  const isrcOf = (item: (typeof items)[number]) => item.external_ids?.isrc
  return new Map(items.map((item) => [item.id, byId.get(item.id) ?? byIsrc.get(isrcOf(item) ?? '') ?? null]))
}

/** True where `column` (a track id) is any copy of the recording whose canonical track is `canonicalId`. */
export const isCopyOf = (column: SQLWrapper, canonicalId: string | SQLWrapper): SQL =>
  sql`${column} in (select id from tracks where id = ${canonicalId} or recording_of = ${canonicalId})`
