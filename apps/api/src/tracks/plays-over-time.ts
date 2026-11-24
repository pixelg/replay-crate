import { schema, type Db } from '@replay-crate/db'
import { and, count, eq, gte, min, sql } from 'drizzle-orm'
import { addDays, localDay, weekStart } from '../stats/ranges.ts'

const { plays } = schema

export const TRACK_RANGES = ['90d', '1y', 'all'] as const
export type TrackRange = (typeof TRACK_RANGES)[number]
export type TrackBucket = 'week' | 'month' | 'year'

/** All time is charted by month up to this many months, then by year. */
const MAX_MONTHS = 36

/** The first day of the month `months` after `day`'s. */
function addMonths(day: string, months: number): string {
  const [year, month] = day.split('-').map(Number) as [number, number]
  const index = year * 12 + (month - 1) + months
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`
}

/**
 * A track's plays per bucket, in local days of `tz`, empty buckets as zeros, up to the bucket
 * holding today: the last 90 days by week (Monday first), the last 12 months by month, or
 * everything since its first play by month (by year past three years). `trackId` is the
 * recording's canonical track.
 */
export async function trackPlaysOverTime(
  db: Db,
  userId: string,
  trackId: string,
  { range, tz, now }: { range: TrackRange; tz: string; now: Date },
): Promise<{ bucket: TrackBucket; series: Array<{ date: string; plays: number }> }> {
  const today = localDay(now, tz)
  const mine = and(eq(plays.userId, userId), eq(plays.trackId, trackId))

  let bucket: TrackBucket
  let start: string
  if (range === '90d') {
    bucket = 'week'
    start = weekStart(addDays(today, -89))
  } else if (range === '1y') {
    bucket = 'month'
    start = addMonths(today, -11)
  } else {
    const [first] = await db.select({ at: min(plays.playedAt) }).from(plays).where(mine)
    if (!first?.at) return { bucket: 'month', series: [] }
    const firstDay = localDay(new Date(first.at), tz)
    const months = (Number(today.slice(0, 4)) - Number(firstDay.slice(0, 4))) * 12 + Number(today.slice(5, 7)) - Number(firstDay.slice(5, 7)) + 1
    bucket = months > MAX_MONTHS ? 'year' : 'month'
    start = bucket === 'year' ? `${firstDay.slice(0, 4)}-01-01` : addMonths(firstDay, 0)
  }

  const rows = await db
    .select({
      date: sql<string>`to_char(date_trunc(${bucket}, ${plays.playedAt} at time zone ${tz}), 'YYYY-MM-DD')`,
      plays: count(),
    })
    .from(plays)
    .where(and(mine, gte(plays.playedAt, sql`(${start}::timestamp at time zone ${tz})`)))
    // By position: the bucket expression carries parameters, so repeating it wouldn't match.
    .groupBy(sql`1`)
  const counts = new Map(rows.map((row) => [row.date, row.plays]))

  const next = (date: string) => (bucket === 'week' ? addDays(date, 7) : addMonths(date, bucket === 'year' ? 12 : 1))
  const series: Array<{ date: string; plays: number }> = []
  for (let date = start; date <= today; date = next(date)) series.push({ date, plays: counts.get(date) ?? 0 })
  return { bucket, series }
}
