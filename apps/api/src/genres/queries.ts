import { schema, type Db } from '@replay-crate/db'
import { asc, count, desc, eq, inArray, sql, type SQL } from 'drizzle-orm'

const { artistGenres, genres, plays, trackArtists } = schema

export type GenreRef = { id: number; name: string }

/** Genres shown per track in lists; a track's page shows them all. */
export const TRACK_GENRES = 3

/** Each artist's genres, strongest first. Artists without any are left out. */
export async function loadArtistGenres(db: Db, artistIds: string[]): Promise<Map<string, GenreRef[]>> {
  const byArtist = new Map<string, GenreRef[]>()
  if (!artistIds.length) return byArtist
  const rows = await db
    .select({ artistId: artistGenres.artistId, id: genres.id, name: genres.name })
    .from(artistGenres)
    .innerJoin(genres, eq(genres.id, artistGenres.genreId))
    .where(inArray(artistGenres.artistId, [...new Set(artistIds)]))
    .orderBy(asc(artistGenres.artistId), desc(artistGenres.weight), asc(genres.name))
  for (const { artistId, ...genre } of rows) byArtist.set(artistId, [...(byArtist.get(artistId) ?? []), genre])
  return byArtist
}

/**
 * A track's genres: its artists', the primary artist's first (strongest first within each
 * artist), each genre once, at most `limit`.
 */
export async function loadTrackGenres(db: Db, trackIds: string[], limit = TRACK_GENRES): Promise<Map<string, GenreRef[]>> {
  const byTrack = new Map<string, GenreRef[]>()
  if (!trackIds.length) return byTrack
  const rows = await db
    .select({ trackId: trackArtists.trackId, id: genres.id, name: genres.name })
    .from(trackArtists)
    .innerJoin(artistGenres, eq(artistGenres.artistId, trackArtists.artistId))
    .innerJoin(genres, eq(genres.id, artistGenres.genreId))
    .where(inArray(trackArtists.trackId, [...new Set(trackIds)]))
    .orderBy(asc(trackArtists.trackId), asc(trackArtists.position), desc(artistGenres.weight), asc(genres.name))
  for (const { trackId, ...genre } of rows) {
    const list = byTrack.get(trackId) ?? []
    if (list.length < limit && !list.some((known) => known.id === genre.id)) list.push(genre)
    byTrack.set(trackId, list)
  }
  return byTrack
}

/** Plays whose track has an artist in `genreId`: a condition on `plays`. */
export function playInGenre(genreId: number): SQL {
  return sql`exists (
    select 1 from ${trackArtists}
    join ${artistGenres} on ${artistGenres.artistId} = ${trackArtists.artistId}
    where ${trackArtists.trackId} = ${plays.trackId} and ${artistGenres.genreId} = ${genreId}
  )`
}

/**
 * The genres in a user's plays, most played first: each play counts once for every genre its
 * track's artists have (a play of a hip hop and jazz track counts for both).
 */
export async function genrePlayCounts(db: Db, userId: string): Promise<Array<GenreRef & { playCount: number }>> {
  // Distinct (play, genre) pairs, so a genre two artists on one track share counts that play once.
  const pairs = db
    .selectDistinct({ playId: plays.id, genreId: artistGenres.genreId })
    .from(plays)
    .innerJoin(trackArtists, eq(trackArtists.trackId, plays.trackId))
    .innerJoin(artistGenres, eq(artistGenres.artistId, trackArtists.artistId))
    .where(eq(plays.userId, userId))
    .as('pairs')
  return db
    .select({ id: genres.id, name: genres.name, playCount: count() })
    .from(pairs)
    .innerJoin(genres, eq(genres.id, pairs.genreId))
    .groupBy(genres.id, genres.name)
    .orderBy(desc(count()), asc(genres.name))
}
