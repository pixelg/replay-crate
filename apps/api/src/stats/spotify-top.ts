import { schema } from '@replay-crate/db'
import { pickImage, type TopTimeRange } from '@replay-crate/spotify'
import { and, count, eq, inArray, sql } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { getAccessToken } from '../spotify/access-token.ts'
import { upsertCatalog } from '../sync/catalog.ts'

const { artists, plays, trackArtists } = schema

export type SpotifyTopItem = {
  rank: number
  id: string
  name: string
  subtitle: string | null
  imageUrl: string | null
  /** Plays Replay Crate has recorded, for comparison with Spotify's ranking. */
  plays: number
}

/**
 * Spotify's own top tracks or artists, next to how often we've recorded each. Artist
 * images from this response are kept, since the artists in plays come without them.
 */
export async function spotifyTop(
  deps: AppDeps,
  userId: string,
  { type, timeRange }: { type: 'tracks' | 'artists'; timeRange: TopTimeRange },
): Promise<SpotifyTopItem[]> {
  const { db, spotify } = deps
  const accessToken = await getAccessToken(deps, userId)

  if (type === 'tracks') {
    const page = await spotify.getTopTracks(accessToken, timeRange)
    const topTracks = page.items.filter((t) => t.id && !t.is_local)
    await upsertCatalog(db, topTracks)
    const ids = topTracks.map((t) => t.id!)
    const counts = ids.length
      ? await db
          .select({ id: plays.trackId, plays: count() })
          .from(plays)
          .where(and(eq(plays.userId, userId), inArray(plays.trackId, ids)))
          .groupBy(plays.trackId)
      : []
    const byId = new Map(counts.map((row) => [row.id, row.plays]))
    return topTracks.map((t, index) => ({
      rank: index + 1,
      id: t.id!,
      name: t.name,
      subtitle: t.artists.map((artist) => artist.name).join(', '),
      imageUrl: pickImage(t.album.images, 64),
      plays: byId.get(t.id!) ?? 0,
    }))
  }

  const page = await spotify.getTopArtists(accessToken, timeRange)
  const topArtists = page.items
  if (topArtists.length) {
    await db
      .insert(artists)
      .values(topArtists.map((artist) => ({ id: artist.id, name: artist.name, imageUrl: pickImage(artist.images, 300) })))
      .onConflictDoUpdate({
        target: artists.id,
        set: { name: sql`excluded.name`, imageUrl: sql`excluded.image_url`, updatedAt: sql`now()` },
      })
  }
  const ids = topArtists.map((artist) => artist.id)
  const counts = ids.length
    ? await db
        .select({ id: trackArtists.artistId, plays: count() })
        .from(plays)
        .innerJoin(trackArtists, eq(trackArtists.trackId, plays.trackId))
        .where(and(eq(plays.userId, userId), inArray(trackArtists.artistId, ids)))
        .groupBy(trackArtists.artistId)
    : []
  const byId = new Map(counts.map((row) => [row.id, row.plays]))
  return topArtists.map((artist, index) => ({
    rank: index + 1,
    id: artist.id,
    name: artist.name,
    subtitle: null,
    imageUrl: pickImage(artist.images, 64),
    plays: byId.get(artist.id) ?? 0,
  }))
}
