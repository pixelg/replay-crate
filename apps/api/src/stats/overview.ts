import { schema, type Db } from '@replay-crate/db'
import { and, count, countDistinct, eq, gte, inArray, isNull, min, sql, sum } from 'drizzle-orm'
import { addDays, localDay, RANGE_DAYS, weekStart, type Range } from './ranges.ts'

const { artists, plays, syncGaps, trackArtists, tracks } = schema

/** Artists given their own area in the chart; the rest are "everyone else". */
export const TOP_ARTISTS = 5

export type Bucket = 'day' | 'week'
/** Plays and listening time, for one artist (or everyone else) in one bucket. */
export type Listening = { plays: number; minutes: number }
export type OverviewPoint = {
  date: string
  newTracks: number
  replays: number
  minutes: number
  /** Per top artist, in the order of `artists`. */
  byArtist: Listening[]
  /** Everyone else. */
  others: Listening
}
export type OverviewArtist = { id: string; name: string } & Listening

/**
 * Totals and a "listening over time" series for a range, in the user's time zone. Each
 * point splits plays into new tracks (a track's first-ever play) and replays, and by artist:
 * the range's top artists and everyone else. Short ranges are bucketed by day, a year or more
 * by week; empty buckets are filled with zeros.
 *
 * Artists count by their first credit, so a play is counted once. The top artists are picked by
 * plays, not time: a long track doesn't outrank a short one; time is there to chart, not to rank.
 */
export async function overview(db: Db, userId: string, { range, tz, now }: { range: Range; tz: string; now: Date }) {
  const days = RANGE_DAYS[range]
  const bucket: Bucket = days === null || days > 90 ? 'week' : 'day'
  const today = localDay(now, tz)

  let startDay: string | null = days === null ? null : addDays(today, -(days - 1))
  if (startDay === null) {
    const [first] = await db.select({ at: min(plays.playedAt) }).from(plays).where(eq(plays.userId, userId))
    startDay = first?.at ? localDay(new Date(first.at), tz) : null
  }
  if (startDay === null) {
    return {
      range,
      tz,
      bucket,
      totals: { plays: 0, minutes: 0, tracks: 0, artists: 0, newTracks: 0 },
      artists: [],
      series: [],
      openGaps: 0,
    }
  }

  const inRange = and(
    eq(plays.userId, userId),
    // Local midnight at the start of the first day.
    gte(plays.playedAt, sql`(${startDay}::timestamp at time zone ${tz})`),
  )
  const msPlayed = sql`coalesce(${plays.msPlayed}, ${tracks.durationMs})`

  const firstPlays = db
    .select({ trackId: plays.trackId, firstAt: min(plays.playedAt).as('first_at') })
    .from(plays)
    .where(eq(plays.userId, userId))
    .groupBy(plays.trackId)
    .as('first_plays')

  const rows = await db
    .select({
      bucket: sql<string>`to_char(date_trunc(${bucket}, ${plays.playedAt} at time zone ${tz}), 'YYYY-MM-DD')`,
      newTracks: sql<number>`count(*) filter (where ${plays.playedAt} = ${firstPlays.firstAt})`.mapWith(Number),
      replays: sql<number>`count(*) filter (where ${plays.playedAt} <> ${firstPlays.firstAt})`.mapWith(Number),
      ms: sql<number>`coalesce(sum(${msPlayed}), 0)`.mapWith(Number),
    })
    .from(plays)
    .innerJoin(tracks, eq(tracks.id, plays.trackId))
    .innerJoin(firstPlays, eq(firstPlays.trackId, plays.trackId))
    .where(inRange)
    // By position: the bucket expression carries parameters, so repeating it wouldn't match.
    .groupBy(sql`1`)

  // The range's top artists by plays (ties by name), then their plays and time per bucket.
  const bucketOf = sql<string>`to_char(date_trunc(${bucket}, ${plays.playedAt} at time zone ${tz}), 'YYYY-MM-DD')`
  const firstCredit = and(eq(trackArtists.trackId, plays.trackId), eq(trackArtists.position, 0))
  const top = await db
    .select({
      id: artists.id,
      name: artists.name,
      plays: count().as('artist_plays'),
      ms: sql<number>`coalesce(sum(${msPlayed}), 0)`.mapWith(Number),
    })
    .from(plays)
    .innerJoin(tracks, eq(tracks.id, plays.trackId))
    .innerJoin(trackArtists, firstCredit)
    .innerJoin(artists, eq(artists.id, trackArtists.artistId))
    .where(inRange)
    .groupBy(artists.id, artists.name)
    .orderBy(sql`artist_plays desc`, artists.name)
    .limit(TOP_ARTISTS)
  const topIndex = new Map(top.map((artist, index) => [artist.id, index]))
  const perArtist = top.length
    ? await db
        .select({
          bucket: bucketOf,
          artistId: trackArtists.artistId,
          plays: count(),
          ms: sql<number>`coalesce(sum(${msPlayed}), 0)`.mapWith(Number),
        })
        .from(plays)
        .innerJoin(tracks, eq(tracks.id, plays.trackId))
        .innerJoin(trackArtists, firstCredit)
        .where(and(inRange, inArray(trackArtists.artistId, [...topIndex.keys()])))
        .groupBy(sql`1`, trackArtists.artistId)
    : []

  const [totals] = await db
    .select({ plays: count(), ms: sum(msPlayed).mapWith(Number), tracks: countDistinct(plays.trackId) })
    .from(plays)
    .innerJoin(tracks, eq(tracks.id, plays.trackId))
    .where(inRange)
  const [artistTotals] = await db
    .select({ artists: countDistinct(trackArtists.artistId) })
    .from(plays)
    .innerJoin(trackArtists, eq(trackArtists.trackId, plays.trackId))
    .where(inRange)

  // Unfilled gaps reaching into the range: its numbers are a floor, not the full story.
  const [gaps] = await db
    .select({ open: count() })
    .from(syncGaps)
    .where(
      and(
        eq(syncGaps.userId, userId),
        isNull(syncGaps.filledAt),
        gte(syncGaps.before, sql`(${startDay}::timestamp at time zone ${tz})`),
      ),
    )

  const byBucket = new Map(rows.map((row) => [row.bucket, row]))
  const artistBuckets = new Map<string, Listening[]>()
  for (const row of perArtist) {
    const listening = artistBuckets.get(row.bucket) ?? top.map(() => ({ plays: 0, minutes: 0 }))
    listening[topIndex.get(row.artistId)!] = { plays: row.plays, minutes: row.ms / 60_000 }
    artistBuckets.set(row.bucket, listening)
  }
  const minutes = (ms: number) => Math.round(ms / 60_000)
  const step = bucket === 'week' ? 7 : 1
  const last = bucket === 'week' ? weekStart(today) : today
  const series: OverviewPoint[] = []
  for (let date = bucket === 'week' ? weekStart(startDay) : startDay; date <= last; date = addDays(date, step)) {
    const row = byBucket.get(date)
    const byArtist = artistBuckets.get(date) ?? top.map(() => ({ plays: 0, minutes: 0 }))
    const known = byArtist.reduce((sum, artist) => ({ plays: sum.plays + artist.plays, minutes: sum.minutes + artist.minutes }), {
      plays: 0,
      minutes: 0,
    })
    const allPlays = (row?.newTracks ?? 0) + (row?.replays ?? 0)
    const allMinutes = (row?.ms ?? 0) / 60_000
    series.push({
      date,
      newTracks: row?.newTracks ?? 0,
      replays: row?.replays ?? 0,
      minutes: minutes(row?.ms ?? 0),
      byArtist: byArtist.map((artist) => ({ plays: artist.plays, minutes: Math.round(artist.minutes) })),
      others: { plays: allPlays - known.plays, minutes: Math.max(0, Math.round(allMinutes - known.minutes)) },
    })
  }

  return {
    range,
    tz,
    bucket,
    totals: {
      plays: totals?.plays ?? 0,
      minutes: Math.round((totals?.ms ?? 0) / 60_000),
      tracks: totals?.tracks ?? 0,
      artists: artistTotals?.artists ?? 0,
      newTracks: series.reduce((total, point) => total + point.newTracks, 0),
    },
    artists: top.map((artist) => ({ id: artist.id, name: artist.name, plays: artist.plays, minutes: minutes(artist.ms) })),
    series,
    openGaps: gaps?.open ?? 0,
  }
}
