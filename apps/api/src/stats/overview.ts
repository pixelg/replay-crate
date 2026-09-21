import { schema, type Db } from '@replay-crate/db'
import { and, count, countDistinct, eq, gte, min, sql, sum } from 'drizzle-orm'
import { addDays, localDay, RANGE_DAYS, weekStart, type Range } from './ranges.ts'

const { plays, trackArtists, tracks } = schema

export type Bucket = 'day' | 'week'
export type OverviewPoint = { date: string; newTracks: number; replays: number; minutes: number }

/**
 * Totals and a "listening over time" series for a range, in the user's time zone. Each
 * point splits plays into new tracks (a track's first-ever play) and replays. Short
 * ranges are bucketed by day, a year or more by week; empty buckets are filled with zeros.
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
    return { range, tz, bucket, totals: { plays: 0, minutes: 0, tracks: 0, artists: 0, newTracks: 0 }, series: [] }
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

  const byBucket = new Map(rows.map((row) => [row.bucket, row]))
  const step = bucket === 'week' ? 7 : 1
  const last = bucket === 'week' ? weekStart(today) : today
  const series: OverviewPoint[] = []
  for (let date = bucket === 'week' ? weekStart(startDay) : startDay; date <= last; date = addDays(date, step)) {
    const row = byBucket.get(date)
    series.push({
      date,
      newTracks: row?.newTracks ?? 0,
      replays: row?.replays ?? 0,
      minutes: Math.round((row?.ms ?? 0) / 60_000),
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
    series,
  }
}
