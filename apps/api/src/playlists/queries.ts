import { schema, type Db } from '@replay-crate/db'
import { and, asc, eq, inArray, max, sql } from 'drizzle-orm'

const { playlistItems, playlists, userPlaylists } = schema

export type PlaylistRef = { id: string; name: string }

/** Playlists newest addition first: when the track last went in; then the user's Spotify order. */
export const latestAddedFirst = () => [sql`${max(playlistItems.addedAt)} desc nulls last`, asc(userPlaylists.position)]

/**
 * The user's playlists holding each track, the one it was added to most recently first. Tracks on
 * none are left out.
 */
export async function loadTrackPlaylists(db: Db, userId: string, trackIds: string[]): Promise<Map<string, PlaylistRef[]>> {
  const byTrack = new Map<string, PlaylistRef[]>()
  if (!trackIds.length) return byTrack
  // Grouped: a track can sit in a playlist more than once.
  const rows = await db
    .select({ trackId: playlistItems.trackId, id: playlists.id, name: playlists.name })
    .from(playlistItems)
    .innerJoin(userPlaylists, and(eq(userPlaylists.playlistId, playlistItems.playlistId), eq(userPlaylists.userId, userId)))
    .innerJoin(playlists, eq(playlists.id, playlistItems.playlistId))
    .where(inArray(playlistItems.trackId, [...new Set(trackIds)]))
    .groupBy(playlistItems.trackId, playlists.id, playlists.name, userPlaylists.position)
    .orderBy(asc(playlistItems.trackId), ...latestAddedFirst())
  for (const { trackId, id, name } of rows) byTrack.set(trackId, [...(byTrack.get(trackId) ?? []), { id, name }])
  return byTrack
}
