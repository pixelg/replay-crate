import { schema, type Db } from '@replay-crate/db'
import { and, asc, eq, inArray } from 'drizzle-orm'

const { playlistItems, playlists, userPlaylists } = schema

export type PlaylistRef = { id: string; name: string }

/** The user's playlists holding each track, in their Spotify order. Tracks on none are left out. */
export async function loadTrackPlaylists(db: Db, userId: string, trackIds: string[]): Promise<Map<string, PlaylistRef[]>> {
  const byTrack = new Map<string, PlaylistRef[]>()
  if (!trackIds.length) return byTrack
  // Distinct: a track can sit in a playlist more than once.
  const rows = await db
    .selectDistinct({ trackId: playlistItems.trackId, id: playlists.id, name: playlists.name, position: userPlaylists.position })
    .from(playlistItems)
    .innerJoin(userPlaylists, and(eq(userPlaylists.playlistId, playlistItems.playlistId), eq(userPlaylists.userId, userId)))
    .innerJoin(playlists, eq(playlists.id, playlistItems.playlistId))
    .where(inArray(playlistItems.trackId, [...new Set(trackIds)]))
    .orderBy(asc(playlistItems.trackId), asc(userPlaylists.position))
  for (const { trackId, id, name } of rows) byTrack.set(trackId, [...(byTrack.get(trackId) ?? []), { id, name }])
  return byTrack
}
