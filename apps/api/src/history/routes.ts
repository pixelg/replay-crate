import { createRoute, z } from '@hono/zod-openapi'
import { schema } from '@replay-crate/db'
import { SpotifyApiError } from '@replay-crate/spotify'
import { and, desc, eq, isNull, lt } from 'drizzle-orm'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { createRouter, errorResponses, signedIn } from '../lib/openapi.ts'
import { ArtistRef, ContextRef, IsoDateTime, jsonResponse } from '../lib/schemas.ts'
import { ReauthRequiredError } from '../spotify/access-token.ts'
import { syncRecentlyPlayed } from '../sync/recently-played.ts'
import { loadTrackArtists, toContext } from './queries.ts'

const { albums, contexts, plays, syncGaps, tracks } = schema

/** Manual syncs closer together than this reuse the last result instead of calling Spotify. */
const MIN_SYNC_INTERVAL_MS = 30_000

const PlayItem = z
  .object({
    playedAt: IsoDateTime,
    msPlayed: z.number().int().nullable().openapi({ description: 'Known for imported plays; null for polled ones.' }),
    source: z.enum(schema.playSource.enumValues),
    context: ContextRef.nullable(),
    track: z.object({
      id: z.string().openapi({ description: 'Spotify track id.' }),
      name: z.string(),
      durationMs: z.number().int(),
      explicit: z.boolean(),
      album: z.object({ id: z.string(), name: z.string(), thumbUrl: z.string().nullable() }),
      artists: z.array(ArtistRef),
    }),
  })
  .openapi('PlayItem')

const listPlays = createRoute({
  method: 'get',
  path: '/history/plays',
  tags: ['History'],
  operationId: 'listPlays',
  summary: 'Play history',
  description: 'Newest first. Pass `nextCursor` back as `before` for the next page.',
  security: signedIn,
  request: {
    query: z.object({
      before: IsoDateTime.optional().openapi({ description: 'Only plays strictly older than this.' }),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
  },
  responses: {
    200: jsonResponse(
      z.object({
        items: z.array(PlayItem),
        nextCursor: IsoDateTime.nullable().openapi({ description: 'null on the last page.' }),
        lastSyncedAt: IsoDateTime.nullable(),
      }),
      'A page of plays.',
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

    .openapi({ ...listPlays, middleware: auth }, async (c) => {
      const user = c.var.user
      const { before, limit } = c.req.valid('query')

      const rows = await db
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
        .where(and(eq(plays.userId, user.id), before ? lt(plays.playedAt, new Date(before)) : undefined))
        .orderBy(desc(plays.playedAt))
        .limit(limit + 1)

      const page = rows.slice(0, limit)
      const artistsByTrack = await loadTrackArtists(
        db,
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
            },
          })),
          nextCursor: rows.length > limit ? page.at(-1)!.playedAt.toISOString() : null,
          lastSyncedAt: user.lastSyncedAt?.toISOString() ?? null,
        },
        200,
      )
    })
}
