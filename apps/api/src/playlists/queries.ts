import { schema, type Db } from '@replay-crate/db'
import { and, asc, eq, inArray, max, sql } from 'drizzle-orm'
import { recordingId, recordingsOf } from '../tracks/recordings.ts'

const { playlistItems, playlists, tracks, userPlaylists } = schema

export type PlaylistRef = { id: string; name: string }

/** Playlists newest addition first: when the track last went in; then the user's Spotify order. */
export const latestAddedFirst = () => [sql`${max(playlistItems.addedAt)} desc nulls last`, asc(userPlaylists.position)]

/**
 * The user's playlists holding each track (any copy of its recording), the one it was added to
 * most recently first. Tracks on none are left out.
 */
export async function loadTrackPlaylists(db: Db, userId: string, trackIds: string[]): Promise<Map<string, PlaylistRef[]>> {
  const byTrack = new Map<string, PlaylistRef[]>()
  if (!trackIds.length) return byTrack
  const recordings = await recordingsOf(db, trackIds)
  // Grouped: a track can sit in a playlist more than once, or as two copies.
  const rows = await db
    .select({ recording: recordingId, id: playlists.id, name: playlists.name })
    .from(playlistItems)
    .innerJoin(tracks, eq(tracks.id, playlistItems.trackId))
    .innerJoin(userPlaylists, and(eq(userPlaylists.playlistId, playlistItems.playlistId), eq(userPlaylists.userId, userId)))
    .innerJoin(playlists, eq(playlists.id, playlistItems.playlistId))
    .where(inArray(recordingId, [...new Set(recordings.values())]))
    .groupBy(recordingId, playlists.id, playlists.name, userPlaylists.position)
    .orderBy(asc(recordingId), ...latestAddedFirst())
  const byRecording = new Map<string, PlaylistRef[]>()
  for (const { recording, id, name } of rows) byRecording.set(recording, [...(byRecording.get(recording) ?? []), { id, name }])
  for (const [trackId, recording] of recordings) {
    const found = byRecording.get(recording)
    if (found) byTrack.set(trackId, found)
  }
  return byTrack
}
