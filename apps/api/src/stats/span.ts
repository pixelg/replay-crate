import { schema, type Db } from '@replay-crate/db'
import { eq, min } from 'drizzle-orm'
import { addDays, localDay, periodDays, RANGE_DAYS, weekStart, type Span } from './ranges.ts'

const { plays } = schema

export type Bucket = 'day' | 'week'
/** A span as local days of `tz`, and how its chart is bucketed. */
export type SpanDays = {
  today: string
  /** The first local day; null when the span is all time and there are no plays yet. */
  startDay: string | null
  /** The day after the last one; null for a rolling range, which ends now. */
  endDay: string | null
  bucket: Bucket
}

/**
 * The local days a span covers. Up to 90 days are bucketed by day, longer spans (a year, all
 * time) by week: 365 daily points are too spiky to read. All time starts at the first play.
 */
export async function spanDays(db: Db, userId: string, { span, tz, now }: { span: Span; tz: string; now: Date }): Promise<SpanDays> {
  const today = localDay(now, tz)
  if ('period' in span) {
    const days = periodDays(span.period)
    return { today, startDay: days.from, endDay: days.to, bucket: span.period.length === 4 ? 'week' : 'day' }
  }
  const days = RANGE_DAYS[span.range]
  const bucket: Bucket = days === null || days > 90 ? 'week' : 'day'
  if (days !== null) return { today, startDay: addDays(today, -(days - 1)), endDay: null, bucket }
  const [first] = await db.select({ at: min(plays.playedAt) }).from(plays).where(eq(plays.userId, userId))
  return { today, startDay: first?.at ? localDay(new Date(first.at), tz) : null, endDay: null, bucket }
}

/** Every bucket's start from the span's first to its last (today, for one still going). */
export function bucketDates({ today, startDay, endDay, bucket }: SpanDays & { startDay: string }): string[] {
  const step = bucket === 'week' ? 7 : 1
  const lastDay = endDay === null || addDays(endDay, -1) > today ? today : addDays(endDay, -1)
  const last = bucket === 'week' ? weekStart(lastDay) : lastDay
  const dates: string[] = []
  for (let date = bucket === 'week' ? weekStart(startDay) : startDay; date <= last; date = addDays(date, step)) dates.push(date)
  return dates
}
