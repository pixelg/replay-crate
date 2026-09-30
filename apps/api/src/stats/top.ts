import { schema, type Db } from '@replay-crate/db'
import { and, asc, count, countDistinct, desc, eq, gte, inArray, lt, sql, sum } from 'drizzle-orm'
import { loadTrackArtists } from '../history/queries.ts'
import { loadRatings } from '../tracks/ratings.ts'
import { periodDays, rangeStart, type Span } from './ranges.ts'

const { albumArtists, albums, artistGenres, artists, genres, plays, trackArtists, tracks } = schema

export type TopType = 'tracks' | 'artists' | 'albums' | 'genres'
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

/**
 * Most played tracks, artists, albums or genres in a rolling range or a calendar year or month
 * (local days in `tz`), by play count or listening time. A play counts for every genre its
 * track's artists have (once each), and only for artists whose genres have been looked up.
 */
export async function top(
  db: Db,
  userId: string,
  {
    type,
    span,
    tz,
    metric,
    limit,
    now,
  }: { type: TopType; span: Span; tz: string; metric: TopMetric; limit: number; now: Date },
): Promise<TopItem[]> {
  let inRange
  if ('period' in span) {
    const { from, to } = periodDays(span.period)
    inRange = and(
      eq(plays.userId, userId),
      gte(plays.playedAt, sql`(${from}::timestamp at time zone ${tz})`),
      lt(plays.playedAt, sql`(${to}::timestamp at time zone ${tz})`),
    )
  } else {
    const since = rangeStart(span.range, now)
    inRange = and(eq(plays.userId, userId), since ? gte(plays.playedAt, since) : undefined)
  }
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
    case 'genres': {
      // Each play once per genre, even when two of its artists share the genre.
      const pairs = db
        .selectDistinct({
          playId: plays.id,
          genreId: artistGenres.genreId,
          ms: sql<number>`coalesce(${plays.msPlayed}, ${tracks.durationMs})`.as('ms'),
        })
        .from(plays)
        .innerJoin(tracks, eq(tracks.id, plays.trackId))
        .innerJoin(trackArtists, eq(trackArtists.trackId, plays.trackId))
        .innerJoin(artistGenres, eq(artistGenres.artistId, trackArtists.artistId))
        .where(inRange)
        .as('pairs')
      const genrePlays = count()
      const genreMs = sum(pairs.ms).mapWith(Number)
      const [byFirst, bySecond] = metric === 'plays' ? [genrePlays, genreMs] : [genreMs, genrePlays]
      const genreRows = await db
        .select({ id: genres.id, name: genres.name, plays: genrePlays, ms: genreMs })
        .from(pairs)
        .innerJoin(genres, eq(genres.id, pairs.genreId))
        .groupBy(genres.id, genres.name)
        .orderBy(desc(byFirst), desc(bySecond), asc(genres.name))
        .limit(limit)
      rows = genreRows.map((row) => ({ ...row, id: String(row.id), imageUrl: null }))
      // How many of the span's artists each genre covers.
      const ids = genreRows.map((row) => row.id)
      const artistCounts = ids.length
        ? await db
            .select({ genreId: artistGenres.genreId, artists: countDistinct(trackArtists.artistId) })
            .from(plays)
            .innerJoin(trackArtists, eq(trackArtists.trackId, plays.trackId))
            .innerJoin(artistGenres, eq(artistGenres.artistId, trackArtists.artistId))
            .where(and(inRange, inArray(artistGenres.genreId, ids)))
            .groupBy(artistGenres.genreId)
        : []
      subtitles = new Map(
        artistCounts.map((row) => [String(row.genreId), `${row.artists} ${row.artists === 1 ? 'artist' : 'artists'}`]),
      )
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
