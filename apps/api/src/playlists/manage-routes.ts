import { createRoute, z } from '@hono/zod-openapi'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { createRouter, errorResponses, signedIn } from '../lib/openapi.ts'
import { ArtistRef, IsoDateTime, jsonBody, jsonResponse } from '../lib/schemas.ts'
import { spotifyErrorResponse } from '../spotify/errors.ts'
import { EpisodeSummary } from '../podcasts/present.ts'
import { episodeRule, evaluateEpisodeRule } from './episode-rules.ts'
import {
  addItems as addPlaylistUris,
  addTracks,
  createPlaylistFor,
  discardUnsentMoves,
  episodeUri,
  moveItem as moveStoredItem,
  PlaylistNotEditableError,
  removeItems as removePlaylistUris,
  removeTracks,
  retryUnsentMoves,
} from './manage.ts'
import { MoveOutOfRangeError, UnsavedMovesError } from './edits.ts'
import { evaluateRule, playlistRule } from './rules.ts'

const trackIds = z.array(z.string().min(1).max(64).openapi({ description: 'Spotify track id.' })).max(500)
const episodeIds = z.array(z.string().min(1).max(64).openapi({ description: 'Spotify episode id.' })).max(500)
const PlaylistParams = z.object({ id: z.string().min(1).openapi({ description: 'Spotify playlist id.' }) })
const Ok = z.object({ ok: z.literal(true) })

/** Errors of every route that writes to a playlist on Spotify. */
const writeErrors = errorResponses(
  'invalid_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'reauth_required',
  'unsaved_moves',
  'rate_limited',
)

const preview = createRoute({
  method: 'post',
  path: '/playlists/preview',
  tags: ['Playlists'],
  operationId: 'previewPlaylistRule',
  summary: 'Tracks a rule would pick',
  description: 'Lets the user check the tracks before creating anything. Nothing is written.',
  security: signedIn,
  request: { body: jsonBody(z.object({ rule: playlistRule })) },
  responses: {
    200: jsonResponse(
      z.object({
        suggestedName: z.string(),
        tracks: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            durationMs: z.number().int(),
            album: z.object({ name: z.string(), thumbUrl: z.string().nullable() }),
            artists: z.array(ArtistRef),
            playCount: z.number().int(),
            lastPlayedAt: IsoDateTime.nullable(),
          }),
        ),
      }),
      'The picked tracks and a suggested name.',
    ),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

const previewEpisodes = createRoute({
  method: 'post',
  path: '/playlists/episode-preview',
  tags: ['Playlists'],
  operationId: 'previewEpisodePlaylistRule',
  summary: 'Episodes a rule would pick',
  description: 'The podcast counterpart of `/playlists/preview`: check the episodes before creating anything. Nothing is written.',
  security: signedIn,
  request: { body: jsonBody(z.object({ rule: episodeRule })) },
  responses: {
    200: jsonResponse(z.object({ suggestedName: z.string(), episodes: z.array(EpisodeSummary) }), 'The picked episodes and a suggested name.'),
    ...errorResponses('invalid_request', 'unauthorized'),
  },
})

const create = createRoute({
  method: 'post',
  path: '/playlists',
  tags: ['Playlists'],
  operationId: 'createPlaylist',
  summary: 'Create a playlist',
  description: 'Creates it on Spotify with the given tracks, then episodes, and records it here.',
  security: signedIn,
  request: {
    body: jsonBody(
      z.object({
        name: z.string().trim().min(1).max(100),
        description: z.string().trim().max(300).optional(),
        trackIds: trackIds.default([]),
        episodeIds: episodeIds.default([]),
      }),
    ),
  },
  responses: { 201: jsonResponse(z.object({ id: z.string() }), 'The new playlist.'), ...writeErrors },
})

const addItems = createRoute({
  method: 'post',
  path: '/playlists/{id}/items',
  tags: ['Playlists'],
  operationId: 'addPlaylistItems',
  summary: 'Add tracks',
  description: 'Appends, or inserts at `position`. Only playlists the user owns or collaborates on.',
  security: signedIn,
  request: {
    params: PlaylistParams,
    body: jsonBody(z.object({ trackIds: trackIds.min(1), position: z.number().int().min(0).optional() })),
  },
  responses: { 200: jsonResponse(Ok, 'Added.'), ...writeErrors },
})

const removeItems = createRoute({
  method: 'delete',
  path: '/playlists/{id}/items',
  tags: ['Playlists'],
  operationId: 'removePlaylistItems',
  summary: 'Remove tracks',
  description: 'Removes every occurrence of each track.',
  security: signedIn,
  request: { params: PlaylistParams, body: jsonBody(z.object({ trackIds: trackIds.min(1) })) },
  responses: { 200: jsonResponse(Ok, 'Removed.'), ...writeErrors },
})

const addEpisodes = createRoute({
  method: 'post',
  path: '/playlists/{id}/episodes',
  tags: ['Playlists'],
  operationId: 'addPlaylistEpisodes',
  summary: 'Add episodes',
  description: 'Appends podcast episodes, or inserts them at `position` (a Spotify position, among tracks and episodes alike).',
  security: signedIn,
  request: {
    params: PlaylistParams,
    body: jsonBody(z.object({ episodeIds: episodeIds.min(1), position: z.number().int().min(0).optional() })),
  },
  responses: { 200: jsonResponse(Ok, 'Added.'), ...writeErrors },
})

const removeEpisodes = createRoute({
  method: 'delete',
  path: '/playlists/{id}/episodes',
  tags: ['Playlists'],
  operationId: 'removePlaylistEpisodes',
  summary: 'Remove episodes',
  description: 'Removes every occurrence of each episode.',
  security: signedIn,
  request: { params: PlaylistParams, body: jsonBody(z.object({ episodeIds: episodeIds.min(1) })) },
  responses: { 200: jsonResponse(Ok, 'Removed.'), ...writeErrors },
})

const moveItem = createRoute({
  method: 'put',
  path: '/playlists/{id}/items/move',
  tags: ['Playlists'],
  operationId: 'movePlaylistItem',
  summary: 'Move a track or episode',
  description:
    'Moves the item at `from` so it ends up at `to` (0-based Spotify positions, counting tracks and episodes). ' +
    'Saved at once and sent to Spotify in the background, in order; `unsentMoves` on the playlist says what Spotify is still missing.',
  security: signedIn,
  request: {
    params: PlaylistParams,
    body: jsonBody(z.object({ from: z.number().int().min(0), to: z.number().int().min(0) })),
  },
  responses: { 200: jsonResponse(Ok, 'Moved.'), ...writeErrors },
})

const retryMoves = createRoute({
  method: 'post',
  path: '/playlists/{id}/moves/retry',
  tags: ['Playlists'],
  operationId: 'retryPlaylistMoves',
  summary: 'Send refused moves again',
  description: 'Queues the moves Spotify refused to be sent again, in order.',
  security: signedIn,
  request: { params: PlaylistParams },
  responses: { 200: jsonResponse(Ok, 'Queued.'), ...writeErrors },
})

const discardMoves = createRoute({
  method: 'delete',
  path: '/playlists/{id}/moves',
  tags: ['Playlists'],
  operationId: 'discardPlaylistMoves',
  summary: "Go back to Spotify's order",
  description: 'Forgets the moves Spotify does not have yet and re-reads the playlist from Spotify.',
  security: signedIn,
  request: { params: PlaylistParams },
  responses: { 200: jsonResponse(Ok, 'Re-read.'), ...writeErrors },
})

/** Creating playlists and changing their tracks. Every route writes to Spotify first. */
export function playlistManageRoutes(deps: AppDeps) {
  const auth = requireUser(deps)
  const now = deps.now ?? (() => new Date())

  /**
   * Runs a playlist change. Returns `{ value }` on success, or `{ response }` for the
   * failures users can hit (not in their library, Spotify refusing); anything else throws.
   */
  async function change<T>(c: Parameters<typeof spotifyErrorResponse>[0], run: () => Promise<T>) {
    try {
      return { value: await run(), response: null }
    } catch (error) {
      if (error instanceof PlaylistNotEditableError) {
        return { value: null, response: c.json({ error: 'not_found' as const }, 404) }
      }
      if (error instanceof UnsavedMovesError) {
        return { value: null, response: c.json({ error: 'unsaved_moves' as const }, 409) }
      }
      if (error instanceof MoveOutOfRangeError) {
        const issues = [{ path: 'to', message: error.message }]
        return { value: null, response: c.json({ error: 'invalid_request' as const, issues }, 400) }
      }
      const response = spotifyErrorResponse(c, error)
      if (response) return { value: null, response }
      throw error
    }
  }

  return createRouter()
    .openapi({ ...preview, middleware: auth }, async (c) => {
      const { rule } = c.req.valid('json')
      return c.json(await evaluateRule(deps.db, c.var.user.id, rule, now()), 200)
    })

    .openapi({ ...previewEpisodes, middleware: auth }, async (c) => {
      const { rule } = c.req.valid('json')
      return c.json(await evaluateEpisodeRule(deps.db, c.var.user.id, rule, now()), 200)
    })

    .openapi({ ...create, middleware: auth }, async (c) => {
      const result = await change(c, () => createPlaylistFor(deps, c.var.user.id, c.req.valid('json')))
      return result.response ?? c.json({ id: result.value!.id }, 201)
    })

    .openapi({ ...addItems, middleware: auth }, async (c) => {
      const { trackIds: ids, position } = c.req.valid('json')
      const result = await change(c, () => addTracks(deps, c.var.user.id, c.req.valid('param').id, ids, position))
      return result.response ?? c.json({ ok: true as const }, 200)
    })

    .openapi({ ...removeItems, middleware: auth }, async (c) => {
      const { trackIds: ids } = c.req.valid('json')
      const result = await change(c, () => removeTracks(deps, c.var.user.id, c.req.valid('param').id, ids))
      return result.response ?? c.json({ ok: true as const }, 200)
    })

    .openapi({ ...addEpisodes, middleware: auth }, async (c) => {
      const { episodeIds: ids, position } = c.req.valid('json')
      const result = await change(c, () => addPlaylistUris(deps, c.var.user.id, c.req.valid('param').id, ids.map(episodeUri), position))
      return result.response ?? c.json({ ok: true as const }, 200)
    })

    .openapi({ ...removeEpisodes, middleware: auth }, async (c) => {
      const { episodeIds: ids } = c.req.valid('json')
      const result = await change(c, () => removePlaylistUris(deps, c.var.user.id, c.req.valid('param').id, ids.map(episodeUri)))
      return result.response ?? c.json({ ok: true as const }, 200)
    })

    .openapi({ ...moveItem, middleware: auth }, async (c) => {
      const { from, to } = c.req.valid('json')
      const result = await change(c, () => moveStoredItem(deps, c.var.user.id, c.req.valid('param').id, from, to))
      return result.response ?? c.json({ ok: true as const }, 200)
    })

    .openapi({ ...retryMoves, middleware: auth }, async (c) => {
      const result = await change(c, () => retryUnsentMoves(deps, c.var.user.id, c.req.valid('param').id))
      return result.response ?? c.json({ ok: true as const }, 200)
    })

    .openapi({ ...discardMoves, middleware: auth }, async (c) => {
      const result = await change(c, () => discardUnsentMoves(deps, c.var.user.id, c.req.valid('param').id))
      return result.response ?? c.json({ ok: true as const }, 200)
    })
}
