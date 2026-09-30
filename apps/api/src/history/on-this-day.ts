import { schema, type Db } from '@replay-crate/db'
import { eq, inArray, min, sql } from 'drizzle-orm'
import { loadTrackGenres, type GenreRef } from '../genres/queries.ts'
import { localDay } from '../stats/ranges.ts'
import { loadRatings } from '../tracks/ratings.ts'
import { loadTrackArtists, type ArtistRef } from './queries.ts'

const { albums, plays, tracks } = schema

/** Tracks listed per earlier year, most played first. */
export const TRACKS_PER_YEAR = 5

export type PlayTrack = {
  id: string
  name: string
  durationMs: number
  explicit: boolean
  album: { id: string; name: string; thumbUrl: string | null }
  artists: ArtistRef[]
  genres: GenreRef[]
  rating: number | null
}
export type OnThisDayYear = { year: number; date: string; plays: number; tracks: { track: PlayTrack; plays: number }[] }

/** Whether `YYYY-MM-DD` is a day on the calendar (2023-02-29 isn't). */
export function isCalendarDay(day: string): boolean {
  const time = Date.parse(`${day}T00:00:00Z`)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(time) && new Date(time).toISOString().startsWith(day)
}

/**
 * `date`'s month and day in every earlier year that has plays on it, newest year first: that
 * local day's plays (in `tz`) and its most played tracks (ties: the one played first that day).
 * 29 February only exists in leap years, so it looks back at those alone.
 */
export async function onThisDay(db: Db, userId: string, { date, tz }: { date: string; tz: string }): Promise<OnThisDayYear[]> {
  const [first] = await db.select({ at: min(plays.playedAt) }).from(plays).where(eq(plays.userId, userId))
  if (!first?.at) return []
  const firstYear = Number(localDay(new Date(first.at), tz).slice(0, 4))
  const monthDay = date.slice(4)
  const days: string[] = []
  for (let year = Number(date.slice(0, 4)) - 1; year >= firstYear; year--) {
    const day = `${String(year).padStart(4, '0')}${monthDay}`
    if (isCalendarDay(day)) days.push(day)
  }
  if (!days.length) return []

  // Each day is a range scan of (user_id, played_at) between its local midnights.
  const result = await db.execute(sql`
    with per_track as (
      select d.day, p.track_id, count(*)::int as plays, min(p.played_at) as first_at
      from unnest(array[${sql.join(
        days.map((day) => sql`${day}`),
        sql`, `,
      )}]::date[]) as d(day)
      join ${plays} p on p.user_id = ${userId}
        and p.played_at >= (d.day::timestamp at time zone ${tz})
        and p.played_at < ((d.day + 1)::timestamp at time zone ${tz})
      group by d.day, p.track_id
    )
    select to_char(day, 'YYYY-MM-DD') as day, track_id, plays, total from (
      select *, row_number() over (partition by day order by plays desc, first_at) as rank,
        sum(plays) over (partition by day)::int as total
      from per_track
    ) ranked
    where rank <= ${TRACKS_PER_YEAR}
    order by day desc, rank
  `)
  // `execute` is driver-specific; every driver we use (node-postgres, Neon HTTP, PGlite) returns `rows`.
  const rows = (result as unknown as { rows: { day: string; track_id: string; plays: number; total: number }[] }).rows
  if (!rows.length) return []

  const ids = [...new Set(rows.map((row) => row.track_id))]
  const [trackRows, artistsByTrack, genresByTrack, ratings] = await Promise.all([
    db
      .select({
        id: tracks.id,
        name: tracks.name,
        durationMs: tracks.durationMs,
        explicit: tracks.explicit,
        albumId: albums.id,
        albumName: albums.name,
        albumThumbUrl: albums.thumbUrl,
      })
      .from(tracks)
      .innerJoin(albums, eq(tracks.albumId, albums.id))
      .where(inArray(tracks.id, ids)),
    loadTrackArtists(db, ids),
    loadTrackGenres(db, ids),
    loadRatings(db, userId, ids),
  ])
  const byId = new Map(
    trackRows.map((row): [string, PlayTrack] => [
      row.id,
      {
        id: row.id,
        name: row.name,
        durationMs: row.durationMs,
        explicit: row.explicit,
        album: { id: row.albumId, name: row.albumName, thumbUrl: row.albumThumbUrl },
        artists: artistsByTrack.get(row.id) ?? [],
        genres: genresByTrack.get(row.id) ?? [],
        rating: ratings.get(row.id) ?? null,
      },
    ]),
  )

  const years: OnThisDayYear[] = []
  for (const row of rows) {
    let year = years.at(-1)
    if (year?.date !== row.day) {
      year = { year: Number(row.day.slice(0, 4)), date: row.day, plays: Number(row.total), tracks: [] }
      years.push(year)
    }
    // plays.track_id is a foreign key, so every track is there.
    year.tracks.push({ track: byId.get(row.track_id)!, plays: Number(row.plays) })
  }
  return years
}
