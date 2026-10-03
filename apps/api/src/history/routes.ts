import { createRoute, z } from '@hono/zod-openapi'
import { schema } from '@replay-crate/db'
import { SpotifyApiError } from '@replay-crate/spotify'
import { and, asc, count, desc, eq, gt, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { createRouter, errorResponses, invalidRequest, signedIn } from '../lib/openapi.ts'
import { loadTrackGenres } from '../genres/queries.ts'
import { ArtistRef, ContextRef, GenreRef, IsoDateTime, jsonResponse, LibraryTrack, PlaylistRef, Rating } from '../lib/schemas.ts'
import { loadTrackPlaylists } from '../playlists/queries.ts'
import { localDay, timeZone } from '../stats/ranges.ts'
import { pauseSpotify, pausedUntil } from '../jobs/budget.ts'
import { listTracks } from '../tracks/library.ts'
import { loadRatings } from '../tracks/ratings.ts'
import { ReauthRequiredError } from '../spotify/access-token.ts'
import { syncRecentlyPlayed } from '../sync/recently-played.ts'
import { isCalendarDay, onThisDay, TRACKS_PER_YEAR } from './on-this-day.ts'
import { PlayFilterQuery, playFilter } from './filters.ts'
import { loadTrackArtists, toContext } from './queries.ts'

const { albums, contexts, plays, syncGaps, tracks } = schema

/** Manual syncs closer together than this reuse the last result instead of calling Spotify. */
const MIN_SYNC_INTERVAL_MS = 30_000

/** A track the way History shows it. */
const PlayTrack = z.object({
  id: z.string().openapi({ description: 'Spotify track id.' }),
  name: z.string(),
  durationMs: z.number().int(),
  explicit: z.boolean(),
  album: z.object({ id: z.string(), name: z.string(), thumbUrl: z.string().nullable() }),
  artists: z.array(ArtistRef),
  genres: z.array(GenreRef).openapi({ description: "Its artists' genres, the primary artist's first; at most 3." }),
  rating: Rating,
})

const PlayItem = z
  .object({
    playedAt: IsoDateTime,
    msPlayed: z.number().int().nullable().openapi({ description: 'Known for imported plays; null for polled ones.' }),
    source: z.enum(schema.playSource.enumValues),
    context: ContextRef.nullable(),
    track: PlayTrack.extend({
      playlists: z.array(PlaylistRef).openapi({ description: "The user's playlists holding it now, the one it was added to most recently first." }),
    }),
  })
  .openapi('PlayItem')

const listPlays = createRoute({
  method: 'get',
  path: '/history/plays',
  tags: ['History'],
  operationId: 'listPlays',
  summary: 'Play history',
  description:
    'Newest first. Three ways to page, one at a time: pass `nextCursor` back as `before` for older plays (infinite ' +
    'scroll); pass `after` for the plays just newer than a time, to scroll back up from a point in the past (still ' +
    'listed newest first, and their `nextCursor` goes back in as `after` for newer ones still); or pass `offset` for ' +
    'numbered pages, which also returns `total` and `olderPlayedAt`. `genre` keeps only plays of tracks whose artists ' +
    'have that genre (see `/genres`), and `since` / `until` only plays in that stretch of time, with any way of paging; ' +
    'likewise `rated`, `newSince` and `context`. `order=oldest` lists oldest first, with `offset` only.',
  security: signedIn,
  request: {
    query: PlayFilterQuery.extend({
      before: IsoDateTime.optional().openapi({ description: 'Only plays strictly older than this.' }),
      after: IsoDateTime.optional().openapi({ description: 'Only plays strictly newer than this: the `limit` closest to it.' }),
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).optional().openapi({ description: 'Plays to skip, for numbered pages.' }),
      order: z.enum(['newest', 'oldest']).default('newest').openapi({ description: '`oldest` lists from the oldest play; with `offset` only.' }),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        items: z.array(PlayItem),
        nextCursor: IsoDateTime.nullable().openapi({
          description: 'Where the next page starts, in the direction paged (older, or newer with `after`); null on the last page.',
        }),
        lastSyncedAt: IsoDateTime.nullable(),
        total: z
          .number()
          .int()
          .optional()
          .openapi({ description: 'All of the user’s plays that the filters keep. With `offset` only.' }),
        olderPlayedAt: IsoDateTime.nullable().optional().openapi({
          description:
            'When the play just after this page was played (null on the last page, and oldest first), so a gap across ' +
            'the page boundary can still be shown. With `offset` only.',
        }),
      }),
      'A page of plays.',
    ),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

/** How many places `/history/contexts` lists. */
const CONTEXTS_LISTED = 50

const listPlayedTracks = createRoute({
  method: 'get',
  path: '/history/tracks',
  tags: ['History'],
  operationId: 'listPlayedTracks',
  summary: 'The tracks in a stretch of history',
  description:
    'The tracks in the plays the filters keep (as for `/history/plays`), most played first, each with its plays among ' +
    'them: how many, and the first and last. Numbered pages by `offset`.',
  security: signedIn,
  request: {
    query: PlayFilterQuery.extend({
      limit: z.coerce.number().int().min(1).max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({ items: z.array(LibraryTrack), total: z.number().int().openapi({ description: 'Tracks across all pages.' }) }),
      'A page of tracks.',
    ),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

const listPlayContexts = createRoute({
  method: 'get',
  path: '/history/contexts',
  tags: ['History'],
  operationId: 'listPlayContexts',
  summary: 'Where plays came from',
  description:
    'The places (playlists, albums, artists, Liked Songs…) the plays the filters keep came from, most plays first: ' +
    `the top ${CONTEXTS_LISTED}, to filter \`/history/plays\` by \`context\`. Plays from no context aren't listed.`,
  security: signedIn,
  request: { query: PlayFilterQuery.omit({ context: true }) },
  responses: {
    200: jsonResponse(
      z.object({ contexts: z.array(z.object({ context: ContextRef, plays: z.number().int() }).openapi('PlayContextCount')) }),
      'Where the plays came from.',
    ),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

const sync = createRoute({
  method: 'post',
  path: '/history/sync',
  tags: ['History'],
  operationId: 'syncHistory',
  summary: 'Pull recent plays from Spotify',
  description:
    "Records the user's recently played tracks. Within 30 s of the last sync it returns `skipped` " +
    "without calling Spotify. `missedPlays` means more than Spotify's last 50 plays happened since the " +
    'previous sync, so there is a gap (see `/history/gaps`).',
  security: signedIn,
  responses: {
    200: jsonResponse(
      z.object({
        status: z.enum(['synced', 'skipped']),
        inserted: z.number().int(),
        lastSyncedAt: IsoDateTime,
        missedPlays: z.boolean(),
      }),
      'Synced, or skipped because the last sync was moments ago.',
    ),
    ...errorResponses('unauthorized', 'reauth_required', 'rate_limited'),
  },
})

const getTimeline = createRoute({
  method: 'get',
  path: '/history/timeline',
  tags: ['History'],
  operationId: 'getHistoryTimeline',
  summary: 'Plays per month',
  description:
    'How many plays each calendar month holds, newest first, for jumping around the history: a month is the plays ' +
    '`before` the start of the next one. Months are counted in `tz` (pass the zone the history is shown in); months ' +
    'without plays are left out.',
  security: signedIn,
  request: {
    query: z.object({
      tz: timeZone.default('UTC').openapi({ description: 'IANA time zone for month boundaries.', example: 'Europe/Berlin' }),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        months: z.array(
          z
            .object({ month: z.string().openapi({ description: 'YYYY-MM.', example: '2019-03' }), plays: z.number().int() })
            .openapi('TimelineMonth'),
        ),
      }),
      'Months with plays.',
    ),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

const listGaps = createRoute({
  method: 'get',
  path: '/history/gaps',
  tags: ['History'],
  operationId: 'listGaps',
  summary: 'Gaps in the history',
  description: 'Unfilled stretches where plays may be missing, newest first. An import fills them.',
  security: signedIn,
  responses: {
    200: jsonResponse(
      z.object({
        gaps: z.array(
          z
            .object({ id: z.number().int(), after: IsoDateTime, before: IsoDateTime, detectedAt: IsoDateTime })
            .openapi('HistoryGap'),
        ),
      }),
      'Open gaps.',
    ),
    ...errorResponses('unauthorized'),
  },
})

const getOnThisDay = createRoute({
  method: 'get',
  path: '/history/on-this-day',
  tags: ['History'],
  operationId: 'getOnThisDay',
  summary: 'This day in earlier years',
  description:
    "The same month and day in every earlier year with plays on it, newest year first: that day's plays, in the " +
    `user's time zone, and its ${TRACKS_PER_YEAR} most played tracks. 29 February looks back at leap years only.`,
  security: signedIn,
  request: {
    query: z.object({
      date: z
        .string()
        .refine(isCalendarDay, 'Expected a date, YYYY-MM-DD')
        .optional()
        .openapi({ description: 'Defaults to today.', example: '2026-09-28' }),
      tz: timeZone.default('UTC').openapi({ description: 'IANA time zone for day boundaries.', example: 'America/Los_Angeles' }),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        date: z.string(),
        years: z.array(
          z
            .object({
              year: z.number().int(),
              date: z.string().openapi({ description: 'That day in this year, YYYY-MM-DD.' }),
              plays: z.number().int(),
              tracks: z
                .array(z.object({ track: PlayTrack, plays: z.number().int() }))
                .openapi({ description: 'Most played first.' }),
            })
            .openapi('OnThisDayYear'),
        ),
      }),
      'Earlier years, or none.',
    ),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

export function historyRoutes(deps: AppDeps) {
  const { db } = deps
  const now = deps.now ?? (() => new Date())
  const auth = requireUser(deps)

  return createRouter()
    .openapi({ ...sync, middleware: auth }, async (c) => {
      const user = c.var.user
      if (user.lastSyncedAt && now().getTime() - user.lastSyncedAt.getTime() < MIN_SYNC_INTERVAL_MS) {
        return c.json(
          { status: 'skipped' as const, inserted: 0, lastSyncedAt: user.lastSyncedAt.toISOString(), missedPlays: false },
          200,
        )
      }
      // While Spotify's Retry-After runs, say so without asking it again (the app syncs on its own
      // when the track changes, so this would otherwise be a stream of refused calls).
      const paused = await pausedUntil(db, now())
      if (paused) {
        return c.json({ error: 'rate_limited' as const, retryAfter: Math.ceil((paused.getTime() - now().getTime()) / 1000) }, 503)
      }
      try {
        const result = await syncRecentlyPlayed(deps, user.id)
        return c.json(
          {
            status: 'synced' as const,
            inserted: result.inserted,
            lastSyncedAt: result.syncedAt.toISOString(),
            missedPlays: result.gap !== null,
          },
          200,
        )
      } catch (error) {
        if (error instanceof ReauthRequiredError) return c.json({ error: 'reauth_required' as const }, 409)
        if (error instanceof SpotifyApiError && error.status === 429) {
          await pauseSpotify(db, new Date(now().getTime() + (error.retryAfter ?? 60) * 1000), now())
          return c.json({ error: 'rate_limited' as const, retryAfter: error.retryAfter ?? null }, 503)
        }
        throw error
      }
    })

    .openapi({ ...listGaps, middleware: auth }, async (c) => {
      const gaps = await db
        .select({ id: syncGaps.id, after: syncGaps.after, before: syncGaps.before, detectedAt: syncGaps.detectedAt })
        .from(syncGaps)
        .where(and(eq(syncGaps.userId, c.var.user.id), isNull(syncGaps.filledAt)))
        .orderBy(desc(syncGaps.before))
      return c.json(
        {
          gaps: gaps.map((gap) => ({
            id: gap.id,
            after: gap.after.toISOString(),
            before: gap.before.toISOString(),
            detectedAt: gap.detectedAt.toISOString(),
          })),
        },
        200,
      )
    })

    .openapi({ ...getTimeline, middleware: auth }, async (c) => {
      const { tz } = c.req.valid('query')
      // One grouped pass over the user's plays (about 0.1 s for 125k in PGlite). Grouping by the
      // month's start rather than its text lets Postgres hash the groups instead of sorting every play.
      const byMonth = db
        .select({
          start: sql<string>`date_trunc('month', ${plays.playedAt} at time zone ${tz})`.as('start'),
          plays: count().as('plays'),
        })
        .from(plays)
        .where(eq(plays.userId, c.var.user.id))
        // By position: the expression carries a parameter, so repeating it wouldn't match.
        .groupBy(sql`1`)
        .as('by_month')
      const months = await db
        .select({ month: sql<string>`to_char(${byMonth.start}, 'YYYY-MM')`, plays: byMonth.plays })
        .from(byMonth)
        .orderBy(desc(byMonth.start))
      return c.json({ months }, 200)
    })

    .openapi({ ...getOnThisDay, middleware: auth }, async (c) => {
      const { tz, ...query } = c.req.valid('query')
      const date = query.date ?? localDay(now(), tz)
      return c.json({ date, years: await onThisDay(db, c.var.user.id, { date, tz }) }, 200)
    })

    .openapi({ ...listPlays, middleware: auth }, async (c) => {
      const user = c.var.user
      const { before, after, limit, offset, order, ...filter } = c.req.valid('query')
      if (order === 'oldest' && offset === undefined) {
        return c.json(invalidRequest({ issues: [{ path: ['order'], message: 'List oldest first with offset' }] }), 400)
      }
      if (before !== undefined && offset !== undefined) {
        return c.json(invalidRequest({ issues: [{ path: ['offset'], message: 'Pass either before or offset, not both' }] }), 400)
      }
      if (after !== undefined && (before !== undefined || offset !== undefined)) {
        return c.json(invalidRequest({ issues: [{ path: ['after'], message: 'Pass after on its own, not with before or offset' }] }), 400)
      }
      const mine = playFilter(user.id, filter)
      const byTime = order === 'oldest' ? asc(plays.playedAt) : desc(plays.playedAt)

      // Numbered pages skip plays by position. Skip on `plays` alone (an index-only scan of
      // (user_id, played_at)), then join just this page, rather than joining every skipped row.
      const window =
        offset === undefined
          ? undefined
          : db
              .select({ playedAt: plays.playedAt })
              .from(plays)
              .where(mine)
              .orderBy(byTime)
              .limit(limit + 1)
              .offset(offset)
              .as('window')

      const query = db
        .select({
          playedAt: plays.playedAt,
          msPlayed: plays.msPlayed,
          source: plays.source,
          contextType: plays.contextType,
          contextUri: plays.contextUri,
          contextName: contexts.name,
          contextImageUrl: contexts.imageUrl,
          trackId: tracks.id,
          trackName: tracks.name,
          durationMs: tracks.durationMs,
          explicit: tracks.explicit,
          albumId: albums.id,
          albumName: albums.name,
          albumThumbUrl: albums.thumbUrl,
        })
        .from(plays)
        .innerJoin(tracks, eq(plays.trackId, tracks.id))
        .innerJoin(albums, eq(tracks.albumId, albums.id))
        .leftJoin(contexts, eq(plays.contextUri, contexts.uri))
        .$dynamic()
      // With `after`, the plays closest to it are the oldest of the newer ones: fetch upwards, list newest first.
      const rows = await (window ? query.innerJoin(window, eq(plays.playedAt, window.playedAt)) : query)
        .where(
          and(
            mine,
            before ? lt(plays.playedAt, new Date(before)) : undefined,
            after ? gt(plays.playedAt, new Date(after)) : undefined,
          ),
        )
        .orderBy(after ? asc(plays.playedAt) : byTime)
        .limit(limit + 1)

      const page = after ? rows.slice(0, limit).reverse() : rows.slice(0, limit)
      const more = rows.length > limit
      const artistsByTrack = await loadTrackArtists(
        db,
        page.map((row) => row.trackId),
      )
      const genresByTrack = await loadTrackGenres(
        db,
        page.map((row) => row.trackId),
      )
      const ratings = await loadRatings(
        db,
        user.id,
        page.map((row) => row.trackId),
      )
      const playlistsByTrack = await loadTrackPlaylists(
        db,
        user.id,
        page.map((row) => row.trackId),
      )

      return c.json(
        {
          items: page.map((row) => ({
            playedAt: row.playedAt.toISOString(),
            msPlayed: row.msPlayed,
            source: row.source,
            context: toContext(row),
            track: {
              id: row.trackId,
              name: row.trackName,
              durationMs: row.durationMs,
              explicit: row.explicit,
              album: { id: row.albumId, name: row.albumName, thumbUrl: row.albumThumbUrl },
              artists: artistsByTrack.get(row.trackId) ?? [],
              genres: genresByTrack.get(row.trackId) ?? [],
              rating: ratings.get(row.trackId) ?? null,
              playlists: playlistsByTrack.get(row.trackId) ?? [],
            },
          })),
          nextCursor: more ? (after ? page[0]! : page.at(-1)!).playedAt.toISOString() : null,
          lastSyncedAt: user.lastSyncedAt?.toISOString() ?? null,
          ...(offset !== undefined && {
            // plays.track_id is a foreign key, so the joins above drop nothing: this counts the same rows.
            // (`mine` includes the genre and time filters.)
            total: (await db.select({ n: count() }).from(plays).where(mine))[0]?.n ?? 0,
            olderPlayedAt: (order === 'newest' && rows[limit]?.playedAt.toISOString()) || null,
          }),
        },
        200,
      )
    })

    // After listPlays: the spec registers ContextRef where it first meets it, and plays' nullable
    // context has always defined it.
    .openapi({ ...listPlayedTracks, middleware: auth }, async (c) => {
      const { limit, offset, ...filter } = c.req.valid('query')
      const userId = c.var.user.id
      const { items, total } = await listTracks(db, userId, { sort: 'plays', limit, offset, cursor: null, plays: playFilter(userId, filter) })
      return c.json({ items, total }, 200)
    })

    .openapi({ ...listPlayContexts, middleware: auth }, async (c) => {
      const rows = await db
        .select({
          contextType: plays.contextType,
          contextUri: plays.contextUri,
          contextName: contexts.name,
          contextImageUrl: contexts.imageUrl,
          plays: count(),
        })
        .from(plays)
        .leftJoin(contexts, eq(plays.contextUri, contexts.uri))
        .where(and(playFilter(c.var.user.id, c.req.valid('query')), isNotNull(plays.contextUri)))
        .groupBy(plays.contextType, plays.contextUri, contexts.name, contexts.imageUrl)
        .orderBy(desc(count()), asc(plays.contextUri))
        .limit(CONTEXTS_LISTED)
      const listed = rows.flatMap((row) => {
        const context = toContext(row)
        return context ? [{ context, plays: row.plays }] : []
      })
      return c.json({ contexts: listed }, 200)
    })
}
