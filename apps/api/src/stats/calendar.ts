import { schema, type Db } from '@replay-crate/db'
import { and, count, eq, gte, lt, sql, type SQL } from 'drizzle-orm'

const { plays } = schema

export type CalendarDay = { date: string; plays: number }

/** Plays per local day of `year` in `tz`, oldest first. Days without plays are left out. */
export async function calendarDays(db: Db, userId: string, { year, tz }: { year: number; tz: string }): Promise<CalendarDay[]> {
  return db
    .select({ date: sql<string>`to_char(${plays.playedAt} at time zone ${tz}, 'YYYY-MM-DD')`, plays: count() })
    .from(plays)
    .where(
      and(
        eq(plays.userId, userId),
        // Local midnight on 1 January, to the next one: a range scan of (user_id, played_at).
        gte(plays.playedAt, sql`(${`${year}-01-01`}::timestamp at time zone ${tz})`),
        lt(plays.playedAt, sql`(${`${year + 1}-01-01`}::timestamp at time zone ${tz})`),
      ),
    )
    // By position: the day expression carries parameters, so repeating it wouldn't match.
    .groupBy(sql`1`)
    .orderBy(sql`1`)
}

/**
 * The local years (in `tz`) that have plays, oldest first. A loose index scan: one lookup of the
 * first play on or after each 1 January, rather than reading every play.
 */
export async function yearsWithPlays(db: Db, userId: string, tz: string): Promise<number[]> {
  const firstYearFrom = (from: SQL) => sql`(
    select extract(year from min(${plays.playedAt}) at time zone ${tz})::int from ${plays}
    where ${plays.userId} = ${userId} and ${plays.playedAt} >= ${from}
  )`
  const result = await db.execute(sql`
    with recursive years(year) as (
      select ${firstYearFrom(sql`'-infinity'::timestamptz`)}
      union all
      select ${firstYearFrom(sql`(make_date(year + 1, 1, 1)::timestamp at time zone ${tz})`)} from years where year is not null
    )
    select year from years where year is not null
  `)
  // `execute` is driver-specific; every driver we use (node-postgres, Neon HTTP, PGlite) returns `rows`.
  return (result as unknown as { rows: { year: number }[] }).rows.map((row) => Number(row.year))
}
