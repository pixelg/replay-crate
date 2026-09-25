import { createRoute, z } from '@hono/zod-openapi'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { createRouter, errorResponses, signedIn } from '../lib/openapi.ts'
import { ArtistRef, IsoDateTime, jsonBody, jsonResponse } from '../lib/schemas.ts'
import { spotifyErrorResponse } from '../spotify/errors.ts'
import { addTracks, createPlaylistFor, moveTrack, PlaylistNotEditableError, removeTracks } from './manage.ts'
import { evaluateRule, playlistRule } from './rules.ts'

const trackIds = z.array(z.string().min(1).max(64).openapi({ description: 'Spotify track id.' })).max(500)
const PlaylistParams = z.object({ id: z.string().min(1).openapi({ description: 'Spotify playlist id.' }) })
const Ok = z.object({ ok: z.literal(true) })

/** Errors of every route that writes to a playlist on Spotify. */
const writeErrors = errorResponses(
  'invalid_request',
  'unauthorized',
  'forbidden',
  'not_found',
  'reauth_required',
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

const create = createRoute({
  method: 'post',
  path: '/playlists',
  tags: ['Playlists'],
  operationId: 'createPlaylist',
  summary: 'Create a playlist',
  description: 'Creates it on Spotify with the given tracks, then records it here.',
  security: signedIn,
  request: {
    body: jsonBody(
      z.object({
        name: z.string().trim().min(1).max(100),
        description: z.string().trim().max(300).optional(),
        trackIds: trackIds.default([]),
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

const moveItem = createRoute({
  method: 'put',
  path: '/playlists/{id}/items/move',
  tags: ['Playlists'],
  operationId: 'movePlaylistItem',
  summary: 'Move a track',
  description: 'Moves the track at `from` so it ends up at `to` (0-based positions).',
  security: signedIn,
  request: {
    params: PlaylistParams,
    body: jsonBody(z.object({ from: z.number().int().min(0), to: z.number().int().min(0) })),
  },
  responses: { 200: jsonResponse(Ok, 'Moved.'), ...writeErrors },
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

    .openapi({ ...moveItem, middleware: auth }, async (c) => {
      const { from, to } = c.req.valid('json')
      const result = await change(c, () => moveTrack(deps, c.var.user.id, c.req.valid('param').id, from, to))
      return result.response ?? c.json({ ok: true as const }, 200)
    })
}
