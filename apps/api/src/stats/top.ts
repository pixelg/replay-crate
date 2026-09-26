import { schema, type Db } from '@replay-crate/db'
import { and, asc, count, countDistinct, desc, eq, gte, inArray, sql, sum } from 'drizzle-orm'
import { loadTrackArtists } from '../history/queries.ts'
import { loadRatings } from '../tracks/ratings.ts'
import { rangeStart, type Range } from './ranges.ts'

const { albumArtists, albums, artists, plays, trackArtists, tracks } = schema

export type TopType = 'tracks' | 'artists' | 'albums'
export type TopMetric = 'plays' | 'minutes'
export type TopItem = {
  rank: number
  id: string
  name: string
  subtitle: string | null
  imageUrl: string | null
  plays: number
  minutes: number
  rating: number | null
}

/** Most played tracks, artists or albums in a rolling range, by play count or listening time. */
export async function top(
  db: Db,
  userId: string,
  { type, range, metric, limit, now }: { type: TopType; range: Range; metric: TopMetric; limit: number; now: Date },
): Promise<TopItem[]> {
  const since = rangeStart(range, now)
  const inRange = and(eq(plays.userId, userId), since ? gte(plays.playedAt, since) : undefined)
  const playCount = count()
  const ms = sum(sql`coalesce(${plays.msPlayed}, ${tracks.durationMs})`).mapWith(Number)
  const [first, second] = metric === 'plays' ? [playCount, ms] : [ms, playCount]

  type Row = { id: string; name: string; imageUrl: string | null; plays: number; ms: number }
  let rows: Row[]
  let subtitles = new Map<string, string | null>()

  switch (type) {
    case 'tracks': {
      rows = await db
        .select({ id: tracks.id, name: tracks.name, imageUrl: albums.thumbUrl, plays: playCount, ms })
        .from(plays)
        .innerJoin(tracks, eq(tracks.id, plays.trackId))
        .innerJoin(albums, eq(albums.id, tracks.albumId))
        .where(inRange)
        .groupBy(tracks.id, tracks.name, albums.thumbUrl)
        .orderBy(desc(first), desc(second), asc(tracks.name))
        .limit(limit)
      const credits = await loadTrackArtists(
        db,
        rows.map((row) => row.id),
      )
      subtitles = new Map(rows.map((row) => [row.id, credits.get(row.id)?.map((a) => a.name).join(', ') ?? null]))
      break
    }
    case 'artists': {
      // Every credited artist gets the play: a feature is still listening to that artist.
      const trackCount = countDistinct(plays.trackId)
      const artistRows = await db
        .select({ id: artists.id, name: artists.name, imageUrl: artists.imageUrl, plays: playCount, ms, trackCount })
        .from(plays)
        .innerJoin(tracks, eq(tracks.id, plays.trackId))
        .innerJoin(trackArtists, eq(trackArtists.trackId, plays.trackId))
        .innerJoin(artists, eq(artists.id, trackArtists.artistId))
        .where(inRange)
        .groupBy(artists.id, artists.name, artists.imageUrl)
        .orderBy(desc(first), desc(second), asc(artists.name))
        .limit(limit)
      rows = artistRows
      subtitles = new Map(artistRows.map((row) => [row.id, `${row.trackCount} ${row.trackCount === 1 ? 'track' : 'tracks'}`]))
      break
    }
    case 'albums': {
      rows = await db
        .select({ id: albums.id, name: albums.name, imageUrl: albums.thumbUrl, plays: playCount, ms })
        .from(plays)
        .innerJoin(tracks, eq(tracks.id, plays.trackId))
        .innerJoin(albums, eq(albums.id, tracks.albumId))
        .where(inRange)
        .groupBy(albums.id, albums.name, albums.thumbUrl)
        .orderBy(desc(first), desc(second), asc(albums.name))
        .limit(limit)
      const ids = rows.map((row) => row.id)
      const primary = ids.length
        ? await db
            .select({ albumId: albumArtists.albumId, name: artists.name })
            .from(albumArtists)
            .innerJoin(artists, eq(artists.id, albumArtists.artistId))
            .where(and(inArray(albumArtists.albumId, ids), eq(albumArtists.position, 0)))
        : []
      subtitles = new Map(primary.map((row) => [row.albumId, row.name]))
      break
    }
  }

  const ratings = type === 'tracks' ? await loadRatings(db, userId, rows.map((row) => row.id)) : new Map<string, number>()
  return rows.map((row, index) => ({
    rank: index + 1,
    id: row.id,
    name: row.name,
    subtitle: subtitles.get(row.id) ?? null,
    imageUrl: row.imageUrl,
    plays: row.plays,
    minutes: Math.round((row.ms ?? 0) / 60_000),
    rating: ratings.get(row.id) ?? null,
  }))
}
