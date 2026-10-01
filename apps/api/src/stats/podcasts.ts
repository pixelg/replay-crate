import { schema, type Db } from '@replay-crate/db'
import { and, count, countDistinct, desc, eq, gte, inArray, lt, min, sql, type SQL } from 'drizzle-orm'
import { addDays, localDay, periodDays, RANGE_DAYS, rangeStart, weekStart, type Span } from './ranges.ts'
import type { Bucket } from './overview.ts'

// Podcast stats: the music ones' counterparts over episode listens, measured in time heard
// (`listened_ms`, the episode's own time) and listens, by show rather than artist.

const { episodeListens, episodeProgress, episodes, shows } = schema

/** Shows given their own area in the chart; the rest are "everything else". */
export const TOP_SHOWS = 5

const ms = sql<number>`coalesce(sum(${episodeListens.listenedMs}), 0)`.mapWith(Number)
const minutes = (value: number) => Math.round(value / 60_000)

/** Listens ending in a span: local days in `tz` for a period, a rolling window ending `now` otherwise. */
function listensIn(userId: string, span: Span, tz: string, now: Date): SQL {
  if ('period' in span) {
    const { from, to } = periodDays(span.period)
    return and(
      eq(episodeListens.userId, userId),
      gte(episodeListens.endedAt, sql`(${from}::timestamp at time zone ${tz})`),
      lt(episodeListens.endedAt, sql`(${to}::timestamp at time zone ${tz})`),
    )!
  }
  const since = rangeStart(span.range, now)
  return and(eq(episodeListens.userId, userId), since ? gte(episodeListens.endedAt, since) : undefined)!
}

export type ShowListening = { listens: number; minutes: number }

/**
 * Totals and listening over time for a rolling range or a calendar year or month, like the music
 * overview: time heard per day (or week, past 90 days), split by the span's top shows by time,
 * with the rest as `others`. `finished` counts the span's episodes now played to the end.
 */
export async function podcastOverview(db: Db, userId: string, { span, tz, now }: { span: Span; tz: string; now: Date }) {
  const today = localDay(now, tz)
  const echo = 'period' in span ? { period: span.period } : { range: span.range }
  let startDay: string | null
  let endDay: string | null = null
  let bucket: Bucket
  if ('period' in span) {
    const days = periodDays(span.period)
    startDay = days.from
    endDay = days.to
    bucket = span.period.length === 4 ? 'week' : 'day'
  } else {
    const days = RANGE_DAYS[span.range]
    bucket = days === null || days > 90 ? 'week' : 'day'
    startDay = days === null ? null : addDays(today, -(days - 1))
    if (startDay === null) {
      const [first] = await db.select({ at: min(episodeListens.endedAt) }).from(episodeListens).where(eq(episodeListens.userId, userId))
      startDay = first?.at ? localDay(new Date(first.at), tz) : null
    }
  }
  const empty = { listens: 0, minutes: 0, episodes: 0, shows: 0, finished: 0 }
  if (startDay === null) return { ...echo, tz, bucket, totals: empty, shows: [], series: [] }

  const midnight = (day: string) => sql`(${day}::timestamp at time zone ${tz})`
  const inRange = and(
    eq(episodeListens.userId, userId),
    gte(episodeListens.endedAt, midnight(startDay)),
    endDay === null ? undefined : lt(episodeListens.endedAt, midnight(endDay)),
  )
  const bucketOf = sql<string>`to_char(date_trunc(${bucket}, ${episodeListens.endedAt} at time zone ${tz}), 'YYYY-MM-DD')`

  const rows = await db
    .select({ bucket: bucketOf, listens: count(), ms })
    .from(episodeListens)
    .where(inRange)
    // By position: the bucket expression carries parameters, so repeating it wouldn't match.
    .groupBy(sql`1`)
  const top = await db
    .select({ id: shows.id, name: shows.name, thumbUrl: shows.thumbUrl, listens: count(), ms: ms.as('show_ms') })
    .from(episodeListens)
    .innerJoin(episodes, eq(episodes.id, episodeListens.episodeId))
    .innerJoin(shows, eq(shows.id, episodes.showId))
    .where(inRange)
    .groupBy(shows.id)
    .orderBy(sql`show_ms desc`, shows.name)
    .limit(TOP_SHOWS)
  const topIndex = new Map(top.map((show, index) => [show.id, index]))
  const perShow = top.length
    ? await db
        .select({ bucket: bucketOf, showId: episodes.showId, listens: count(), ms })
        .from(episodeListens)
        .innerJoin(episodes, eq(episodes.id, episodeListens.episodeId))
        .where(and(inRange, inArray(episodes.showId, [...topIndex.keys()])))
        .groupBy(sql`1`, episodes.showId)
    : []
  const [totals] = await db
    .select({ listens: count(), ms, episodes: countDistinct(episodeListens.episodeId) })
    .from(episodeListens)
    .where(inRange)
  const [showTotal] = await db
    .select({ shows: countDistinct(episodes.showId) })
    .from(episodeListens)
    .innerJoin(episodes, eq(episodes.id, episodeListens.episodeId))
    .where(inRange)
  const [finished] = await db
    .select({ n: countDistinct(episodeListens.episodeId) })
    .from(episodeListens)
    .innerJoin(
      episodeProgress,
      and(eq(episodeProgress.userId, episodeListens.userId), eq(episodeProgress.episodeId, episodeListens.episodeId)),
    )
    .where(and(inRange, eq(episodeProgress.fullyPlayed, true)))

  const byBucket = new Map(rows.map((row) => [row.bucket, row]))
  const showBuckets = new Map<string, ShowListening[]>()
  for (const row of perShow) {
    const listening = showBuckets.get(row.bucket) ?? top.map(() => ({ listens: 0, minutes: 0 }))
    listening[topIndex.get(row.showId)!] = { listens: row.listens, minutes: row.ms / 60_000 }
    showBuckets.set(row.bucket, listening)
  }
  const step = bucket === 'week' ? 7 : 1
  const lastDay = endDay === null || addDays(endDay, -1) > today ? today : addDays(endDay, -1)
  const last = bucket === 'week' ? weekStart(lastDay) : lastDay
  const series = []
  for (let date = bucket === 'week' ? weekStart(startDay) : startDay; date <= last; date = addDays(date, step)) {
    const row = byBucket.get(date)
    const byShow = showBuckets.get(date) ?? top.map(() => ({ listens: 0, minutes: 0 }))
    const known = byShow.reduce((sum, show) => ({ listens: sum.listens + show.listens, minutes: sum.minutes + show.minutes }), {
      listens: 0,
      minutes: 0,
    })
    const allMinutes = (row?.ms ?? 0) / 60_000
    series.push({
      date,
      listens: row?.listens ?? 0,
      minutes: minutes(row?.ms ?? 0),
      byShow: byShow.map((show) => ({ listens: show.listens, minutes: Math.round(show.minutes) })),
      others: { listens: (row?.listens ?? 0) - known.listens, minutes: Math.max(0, Math.round(allMinutes - known.minutes)) },
    })
  }

  return {
    ...echo,
    tz,
    bucket,
    totals: {
      listens: totals?.listens ?? 0,
      minutes: minutes(totals?.ms ?? 0),
      episodes: totals?.episodes ?? 0,
      shows: showTotal?.shows ?? 0,
      finished: finished?.n ?? 0,
    },
    shows: top.map((show) => ({ id: show.id, name: show.name, thumbUrl: show.thumbUrl, listens: show.listens, minutes: minutes(show.ms) })),
    series,
  }
}

export type PodcastTopType = 'shows' | 'episodes'
export type PodcastTopMetric = 'minutes' | 'listens'

/** Most listened shows or episodes in a span, by time heard or listens. */
export async function podcastTop(
  db: Db,
  userId: string,
  { type, metric, span, tz, limit, now }: { type: PodcastTopType; metric: PodcastTopMetric; span: Span; tz: string; limit: number; now: Date },
) {
  const inRange = listensIn(userId, span, tz, now)
  const listens = count()
  const [first, second] = metric === 'minutes' ? [ms, listens] : [listens, ms]
  const rows =
    type === 'shows'
      ? await db
          .select({
            id: shows.id,
            name: shows.name,
            imageUrl: shows.thumbUrl,
            subtitle: sql<string>`count(distinct ${episodeListens.episodeId})::int`.mapWith(Number),
            listens,
            ms,
          })
          .from(episodeListens)
          .innerJoin(episodes, eq(episodes.id, episodeListens.episodeId))
          .innerJoin(shows, eq(shows.id, episodes.showId))
          .where(inRange)
          .groupBy(shows.id)
          .orderBy(desc(first), desc(second), shows.name)
          .limit(limit)
      : await db
          .select({
            id: episodes.id,
            name: episodes.name,
            imageUrl: sql<string | null>`coalesce(${episodes.thumbUrl}, ${shows.thumbUrl})`,
            subtitle: shows.name,
            listens,
            ms,
          })
          .from(episodeListens)
          .innerJoin(episodes, eq(episodes.id, episodeListens.episodeId))
          .innerJoin(shows, eq(shows.id, episodes.showId))
          .where(inRange)
          .groupBy(episodes.id, shows.id)
          .orderBy(desc(first), desc(second), episodes.name)
          .limit(limit)
  return rows.map((row, index) => ({
    rank: index + 1,
    id: row.id,
    name: row.name,
    subtitle:
      typeof row.subtitle === 'number' ? `${row.subtitle} ${row.subtitle === 1 ? 'episode' : 'episodes'}` : (row.subtitle ?? null),
    imageUrl: row.imageUrl,
    listens: row.listens,
    minutes: minutes(row.ms),
  }))
}

/** Time heard and listens per local day of `year` in `tz`, oldest first; days without listens left out. */
export async function podcastCalendarDays(db: Db, userId: string, { year, tz }: { year: number; tz: string }) {
  return db
    .select({ date: sql<string>`to_char(${episodeListens.endedAt} at time zone ${tz}, 'YYYY-MM-DD')`, listens: count(), ms })
    .from(episodeListens)
    .where(
      and(
        eq(episodeListens.userId, userId),
        gte(episodeListens.endedAt, sql`(${`${year}-01-01`}::timestamp at time zone ${tz})`),
        lt(episodeListens.endedAt, sql`(${`${year + 1}-01-01`}::timestamp at time zone ${tz})`),
      ),
    )
    .groupBy(sql`1`)
    .orderBy(sql`1`)
    .then((days) => days.map((day) => ({ date: day.date, listens: day.listens, minutes: minutes(day.ms) })))
}

/** The local years (in `tz`) with listens, oldest first. */
export async function yearsWithListens(db: Db, userId: string, tz: string): Promise<number[]> {
  const rows = await db
    .selectDistinct({ year: sql<number>`extract(year from ${episodeListens.endedAt} at time zone ${tz})::int`.mapWith(Number) })
    .from(episodeListens)
    .where(eq(episodeListens.userId, userId))
  return rows.map((row) => row.year).toSorted((a, b) => a - b)
}

/** Listens per calendar month in `tz`, newest first: the podcast timeline the stats' period picker reads. */
export async function listenMonths(db: Db, userId: string, tz: string) {
  const rows = await db
    .select({ month: sql<string>`to_char(${episodeListens.endedAt} at time zone ${tz}, 'YYYY-MM')`, listens: count() })
    .from(episodeListens)
    .where(eq(episodeListens.userId, userId))
    .groupBy(sql`1`)
  return rows.toSorted((a, b) => b.month.localeCompare(a.month))
}
