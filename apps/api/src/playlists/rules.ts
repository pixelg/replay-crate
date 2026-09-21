import { schema, type Db } from '@replay-crate/db'
import { and, count, desc, eq, gte, inArray, lt, max, sql } from 'drizzle-orm'
import { z } from 'zod'
import { loadTrackArtists } from '../history/queries.ts'

const { albums, plays, tracks } = schema

const DAY_MS = 24 * 60 * 60 * 1000

export const RANGES = { '7d': 7, '30d': 30, '90d': 90, '1y': 365, all: null } as const
const rangeLabels: Record<keyof typeof RANGES, string> = {
  '7d': 'last 7 days',
  '30d': 'last 30 days',
  '90d': 'last 90 days',
  '1y': 'last year',
  all: 'all time',
}

const range = z.enum(['7d', '30d', '90d', '1y', 'all'])
const limit = z.number().int().min(5).max(200).default(50)

/** Ways to pick tracks from the user's history for a new playlist. */
export const playlistRule = z.discriminatedUnion('kind', [
  /** Most played in a time range. */
  z.object({ kind: z.literal('top'), range: range.default('30d'), limit }),
  /** Everything played recently, newest first. */
  z.object({ kind: z.literal('recent'), range: range.default('7d'), limit }),
  /** Played 3+ times in the last two weeks. */
  z.object({ kind: z.literal('on_repeat'), limit }),
  /** Played a lot once, but not lately. */
  z.object({
    kind: z.literal('forgotten'),
    minPlays: z.number().int().min(2).max(500).default(5),
    idleDays: z.number().int().min(7).max(3650).default(90),
    limit,
  }),
])
export type PlaylistRule = z.infer<typeof playlistRule>

export async function evaluateRule(db: Db, userId: string, rule: PlaylistRule, now: Date) {
  const mine = eq(plays.userId, userId)
  const since = (days: number | null) => (days === null ? undefined : gte(plays.playedAt, new Date(now.getTime() - days * DAY_MS)))
  const playCount = count()
  const lastPlayedAt = max(plays.playedAt)

  const base = db.select({ trackId: plays.trackId, playCount, lastPlayedAt }).from(plays)

  const picked = await (() => {
    switch (rule.kind) {
      case 'top':
        return base
          .where(and(mine, since(RANGES[rule.range])))
          .groupBy(plays.trackId)
          .orderBy(desc(playCount), desc(lastPlayedAt))
          .limit(rule.limit)
      case 'recent':
        return base
          .where(and(mine, since(RANGES[rule.range])))
          .groupBy(plays.trackId)
          .orderBy(desc(lastPlayedAt))
          .limit(rule.limit)
      case 'on_repeat':
        return base
          .where(and(mine, since(14)))
          .groupBy(plays.trackId)
          .having(gte(playCount, 3))
          .orderBy(desc(playCount), desc(lastPlayedAt))
          .limit(rule.limit)
      case 'forgotten':
        return base
          .where(mine)
          .groupBy(plays.trackId)
          .having(
            and(
              gte(playCount, rule.minPlays),
              lt(lastPlayedAt, sql`${new Date(now.getTime() - rule.idleDays * DAY_MS)}`),
            ),
          )
          .orderBy(desc(playCount))
          .limit(rule.limit)
    }
  })()

  const ids = picked.map((row) => row.trackId)
  const details = ids.length
    ? await db
        .select({ id: tracks.id, name: tracks.name, durationMs: tracks.durationMs, albumName: albums.name, thumbUrl: albums.thumbUrl })
        .from(tracks)
        .innerJoin(albums, eq(albums.id, tracks.albumId))
        .where(inArray(tracks.id, ids))
    : []
  const byId = new Map(details.map((row) => [row.id, row]))
  const artists = await loadTrackArtists(db, ids)

  return {
    suggestedName: suggestName(rule),
    tracks: picked.flatMap((row) => {
      const track = byId.get(row.trackId)
      if (!track) return []
      return [
        {
          id: track.id,
          name: track.name,
          durationMs: track.durationMs,
          album: { name: track.albumName, thumbUrl: track.thumbUrl },
          artists: artists.get(track.id) ?? [],
          playCount: row.playCount,
          lastPlayedAt: toIso(row.lastPlayedAt),
        },
      ]
    }),
  }
}

function suggestName(rule: PlaylistRule): string {
  switch (rule.kind) {
    case 'top':
      return `Top ${rule.limit} · ${rangeLabels[rule.range]}`
    case 'recent':
      return `Recently played · ${rangeLabels[rule.range]}`
    case 'on_repeat':
      return 'On repeat'
    case 'forgotten':
      return 'Forgotten favourites'
  }
}

function toIso(value: Date | string | null | undefined): string | null {
  if (value == null) return null
  return (value instanceof Date ? value : new Date(value)).toISOString()
}
