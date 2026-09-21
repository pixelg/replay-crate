import { schema, type Db } from '@replay-crate/db'
import { asc, eq, inArray } from 'drizzle-orm'

const { artists, trackArtists } = schema

export type ArtistRef = { id: string; name: string }

/** Artists per track, in credit order. */
export async function loadTrackArtists(db: Db, trackIds: string[]): Promise<Map<string, ArtistRef[]>> {
  const byTrack = new Map<string, ArtistRef[]>()
  if (!trackIds.length) return byTrack

  const rows = await db
    .select({ trackId: trackArtists.trackId, id: artists.id, name: artists.name })
    .from(trackArtists)
    .innerJoin(artists, eq(trackArtists.artistId, artists.id))
    .where(inArray(trackArtists.trackId, [...new Set(trackIds)]))
    .orderBy(asc(trackArtists.trackId), asc(trackArtists.position))

  for (const { trackId, ...artist } of rows) {
    const list = byTrack.get(trackId) ?? []
    list.push(artist)
    byTrack.set(trackId, list)
  }
  return byTrack
}

export type ContextRef = { type: string; uri: string; name: string | null; imageUrl: string | null }

export function toContext(row: {
  contextType: string | null
  contextUri: string | null
  contextName: string | null
  contextImageUrl: string | null
}): ContextRef | null {
  if (!row.contextUri || !row.contextType) return null
  return { type: row.contextType, uri: row.contextUri, name: row.contextName, imageUrl: row.contextImageUrl }
}
