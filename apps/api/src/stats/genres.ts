import { schema, type Db } from '@replay-crate/db'
import { and, asc, count, countDistinct, desc, eq, gte, inArray, lt, sql, sum } from 'drizzle-orm'
import type { Span } from './ranges.ts'
import { bucketDates, spanDays } from './span.ts'

const { artistGenres, genres, plays, trackArtists, tracks } = schema

/** Genres given their own area in the chart. */
export const TOP_GENRES = 5
/** Genres listed as heard for the first time. */
export const NEW_GENRES = 12

type Listening = { plays: number; minutes: number }

/**
 * Genre stats for a rolling range or a calendar year or month, in the user's time zone: the
 * span's top genres by plays with their listening per bucket (bucketed like the overview), how
 * many genres were heard and how many of the plays have a genre at all, and the genres heard for
 * the first time in the span.
 *
 * A play counts for every genre its track's artists have, once each, so genres overlap: their
 * plays add up to more than the span's.
 */
export async function genreStats(db: Db, userId: string, { span, tz, now }: { span: Span; tz: string; now: Date }) {
  const echo = 'period' in span ? { period: span.period } : { range: span.range }
  const days = await spanDays(db, userId, { span, tz, now })
  const { startDay, endDay, bucket } = days
  if (startDay === null) {
    return { ...echo, tz, bucket, totals: { genres: 0, newGenres: 0, plays: 0, taggedPlays: 0 }, genres: [], series: [], newGenres: [] }
  }

  const midnight = (day: string) => sql`(${day}::timestamp at time zone ${tz})`
  const from = midnight(startDay)
  const inRange = and(eq(plays.userId, userId), gte(plays.playedAt, from), endDay === null ? undefined : lt(plays.playedAt, midnight(endDay)))

  // Each play once per genre, even when two of its artists share the genre.
  const pairs = db
    .selectDistinct({
      playId: plays.id,
      genreId: artistGenres.genreId,
      bucket: sql<string>`to_char(date_trunc(${bucket}, ${plays.playedAt} at time zone ${tz}), 'YYYY-MM-DD')`.as('bucket'),
      ms: sql<number>`coalesce(${plays.msPlayed}, ${tracks.durationMs})`.as('ms'),
    })
    .from(plays)
    .innerJoin(tracks, eq(tracks.id, plays.trackId))
    .innerJoin(trackArtists, eq(trackArtists.trackId, plays.trackId))
    .innerJoin(artistGenres, eq(artistGenres.artistId, trackArtists.artistId))
    .where(inRange)
    .as('pairs')
  const genreMs = sql<number>`coalesce(sum(${pairs.ms}), 0)`.mapWith(Number)

  const top = await db
    .select({ id: genres.id, name: genres.name, plays: count(), ms: genreMs })
    .from(pairs)
    .innerJoin(genres, eq(genres.id, pairs.genreId))
    .groupBy(genres.id, genres.name)
    .orderBy(desc(count()), desc(sum(pairs.ms)), asc(genres.name))
    .limit(TOP_GENRES)
  const topIndex = new Map(top.map((genre, index) => [genre.id, index]))

  const perGenre = top.length
    ? await db
        .select({ bucket: pairs.bucket, genreId: pairs.genreId, plays: count(), ms: genreMs })
        .from(pairs)
        .where(inArray(pairs.genreId, [...topIndex.keys()]))
        .groupBy(pairs.bucket, pairs.genreId)
    : []

  const [tagged] = await db.select({ genres: countDistinct(pairs.genreId), plays: countDistinct(pairs.playId) }).from(pairs)
  const [all] = await db.select({ plays: count() }).from(plays).where(inRange)

  // Genres whose first play ever falls in the span, with their plays in it (all of them, then).
  const firstAt = sql`min(${plays.playedAt})`
  const heardFirst = await db
    .select({
      id: genres.id,
      name: genres.name,
      firstPlayedAt: sql<Date>`min(${plays.playedAt})`.mapWith(plays.playedAt),
      plays: countDistinct(plays.id),
    })
    .from(plays)
    .innerJoin(trackArtists, eq(trackArtists.trackId, plays.trackId))
    .innerJoin(artistGenres, eq(artistGenres.artistId, trackArtists.artistId))
    .innerJoin(genres, eq(genres.id, artistGenres.genreId))
    // Up to the span's end: what came after it doesn't count, in it or as a first play.
    .where(and(eq(plays.userId, userId), endDay === null ? undefined : lt(plays.playedAt, midnight(endDay))))
    .groupBy(genres.id, genres.name)
    .having(sql`${firstAt} >= ${from}`)
    .orderBy(desc(countDistinct(plays.id)), asc(genres.name))

  const buckets = new Map<string, Listening[]>()
  for (const row of perGenre) {
    const listening = buckets.get(row.bucket) ?? top.map(() => ({ plays: 0, minutes: 0 }))
    listening[topIndex.get(row.genreId)!] = { plays: row.plays, minutes: Math.round(row.ms / 60_000) }
    buckets.set(row.bucket, listening)
  }

  return {
    ...echo,
    tz,
    bucket,
    totals: {
      genres: tagged?.genres ?? 0,
      newGenres: heardFirst.length,
      plays: all?.plays ?? 0,
      taggedPlays: tagged?.plays ?? 0,
    },
    genres: top.map((genre) => ({ id: genre.id, name: genre.name, plays: genre.plays, minutes: Math.round(genre.ms / 60_000) })),
    series: bucketDates({ ...days, startDay }).map((date) => ({
      date,
      byGenre: buckets.get(date) ?? top.map(() => ({ plays: 0, minutes: 0 })),
    })),
    newGenres: heardFirst
      .slice(0, NEW_GENRES)
      .map((genre) => ({ id: genre.id, name: genre.name, plays: genre.plays, firstPlayedAt: new Date(genre.firstPlayedAt).toISOString() })),
  }
}
