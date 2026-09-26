import { schema, type Db } from '@replay-crate/db'
import { and, asc, count, desc, eq, gt, gte, lt, max, or, sql, type SQL } from 'drizzle-orm'
import { loadTrackArtists } from '../history/queries.ts'

const { albums, plays, trackRatings, tracks } = schema

export const TRACK_SORTS = ['plays', 'last_played', 'name', 'rating'] as const
export type TrackSort = (typeof TRACK_SORTS)[number]

/**
 * Where the next page starts: the sort key and id of the last track on this one. Opaque to
 * clients (base64url JSON), so the format can change.
 */
export type TrackCursor = { sort: TrackSort; key: number | string; id: string }

export const encodeCursor = (cursor: TrackCursor) => Buffer.from(JSON.stringify(cursor)).toString('base64url')

export function decodeCursor(value: string): TrackCursor | null {
  try {
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString()) as Partial<TrackCursor>
    const numeric = cursor.sort === 'plays' || cursor.sort === 'rating'
    const validKey = numeric ? typeof cursor.key === 'number' : typeof cursor.key === 'string'
    return TRACK_SORTS.includes(cursor.sort as TrackSort) && validKey && typeof cursor.id === 'string'
      ? (cursor as TrackCursor)
      : null
  } catch {
    return null
  }
}

/**
 * Every track the user has played, with their play count and last play, one page at a time.
 * Most played and recently played sort newest/most first, names A–Z; ties go by track id, so
 * the keyset cursor never repeats or skips a track.
 */
export async function listTracks(
  db: Db,
  userId: string,
  {
    sort,
    limit,
    cursor,
    minRating,
  }: { sort: TrackSort; limit: number; cursor: TrackCursor | null; minRating?: number },
) {
  const mine = db.$with('mine').as(
    db
      .select({
        trackId: plays.trackId,
        playCount: count().as('play_count'),
        firstPlayedAt: sql<Date | string>`min(${plays.playedAt})`.as('first_played_at'),
        lastPlayedAt: max(plays.playedAt).as('last_played_at'),
      })
      .from(plays)
      .where(eq(plays.userId, userId))
      .groupBy(plays.trackId),
  )
  const name = sql<string>`lower(${tracks.name})`
  // Unrated sorts as 0: after every rated track.
  const stars = sql<number>`coalesce(${trackRatings.rating}, 0)`.mapWith(Number)
  const rated = and(eq(trackRatings.trackId, mine.trackId), eq(trackRatings.userId, userId))
  const filter = minRating ? gte(trackRatings.rating, minRating) : undefined

  // Order and "after the cursor" for each sort, with the track id breaking ties.
  const orders: Record<TrackSort, { orderBy: SQL[]; after: (key: number | string, id: string) => SQL | undefined }> = {
    plays: {
      orderBy: [desc(mine.playCount), asc(tracks.id)],
      after: (key, id) => or(lt(mine.playCount, key as number), and(eq(mine.playCount, key as number), gt(tracks.id, id))),
    },
    last_played: {
      orderBy: [desc(mine.lastPlayedAt), asc(tracks.id)],
      after: (key, id) =>
        or(
          sql`${mine.lastPlayedAt} < ${key}::timestamptz`,
          and(sql`${mine.lastPlayedAt} = ${key}::timestamptz`, gt(tracks.id, id)),
        ),
    },
    name: {
      orderBy: [asc(name), asc(tracks.id)],
      after: (key, id) => or(sql`${name} > ${key}`, and(sql`${name} = ${key}`, gt(tracks.id, id))),
    },
    rating: {
      orderBy: [desc(stars), asc(tracks.id)],
      after: (key, id) => or(sql`${stars} < ${key}`, and(sql`${stars} = ${key}`, gt(tracks.id, id))),
    },
  }
  const order = orders[sort]

  const rows = await db
    .with(mine)
    .select({
      id: tracks.id,
      name: tracks.name,
      durationMs: tracks.durationMs,
      explicit: tracks.explicit,
      albumId: albums.id,
      albumName: albums.name,
      albumThumbUrl: albums.thumbUrl,
      playCount: mine.playCount,
      firstPlayedAt: mine.firstPlayedAt,
      lastPlayedAt: mine.lastPlayedAt,
      sortName: name,
      rating: trackRatings.rating,
      stars,
    })
    .from(mine)
    .innerJoin(tracks, eq(tracks.id, mine.trackId))
    .innerJoin(albums, eq(albums.id, tracks.albumId))
    .leftJoin(trackRatings, rated)
    // A cursor from another sort starts this one from the top.
    .where(and(filter, cursor && cursor.sort === sort ? order.after(cursor.key, cursor.id) : undefined))
    .orderBy(...order.orderBy)
    .limit(limit + 1)

  const page = rows.slice(0, limit)
  const artists = await loadTrackArtists(
    db,
    page.map((row) => row.id),
  )
  const last = rows.length > limit ? page.at(-1)! : null
  // Across all pages, with the same filter.
  const [total] = await db
    .with(mine)
    .select({ n: count() })
    .from(mine)
    .leftJoin(trackRatings, rated)
    .where(filter)

  return {
    items: page.map((row) => ({
      track: {
        id: row.id,
        name: row.name,
        durationMs: row.durationMs,
        explicit: row.explicit,
        album: { id: row.albumId, name: row.albumName, thumbUrl: row.albumThumbUrl },
        artists: artists.get(row.id) ?? [],
        rating: row.rating,
      },
      playCount: row.playCount,
      firstPlayedAt: toIso(row.firstPlayedAt)!,
      lastPlayedAt: toIso(row.lastPlayedAt)!,
    })),
    nextCursor: last
      ? encodeCursor({
          sort,
          key: { plays: last.playCount, rating: last.stars, name: last.sortName, last_played: toIso(last.lastPlayedAt)! }[sort],
          id: last.id,
        })
      : null,
    total: total?.n ?? 0,
  }
}

/** Aggregates come back as Date or string depending on the driver. */
function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  return (value instanceof Date ? value : new Date(value)).toISOString()
}
