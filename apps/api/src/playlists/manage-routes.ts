import { Hono } from 'hono'
import { z } from 'zod'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { validate } from '../lib/validate.ts'
import { spotifyErrorResponse } from '../spotify/errors.ts'
import { addTracks, createPlaylistFor, moveTrack, PlaylistNotEditableError, removeTracks } from './manage.ts'
import { evaluateRule, playlistRule } from './rules.ts'

const trackIds = z.array(z.string().min(1).max(64)).max(500)

const createBody = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().trim().max(300).optional(),
  isPublic: z.boolean().default(false),
  trackIds: trackIds.default([]),
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

  return (
    new Hono()
      /** Tracks a rule would pick, so the user can check them before creating anything. */
      .post('/playlists/preview', auth, validate('json', z.object({ rule: playlistRule })), async (c) => {
        const { rule } = c.req.valid('json')
        return c.json(await evaluateRule(deps.db, c.get('user').id, rule, now()), 200)
      })

      .post('/playlists', auth, validate('json', createBody), async (c) => {
        const result = await change(c, () => createPlaylistFor(deps, c.get('user').id, c.req.valid('json')))
        return result.response ?? c.json({ id: result.value!.id }, 201)
      })

      .post(
        '/playlists/:id/items',
        auth,
        validate('json', z.object({ trackIds: trackIds.min(1), position: z.number().int().min(0).optional() })),
        async (c) => {
          const { trackIds: ids, position } = c.req.valid('json')
          const result = await change(c, () => addTracks(deps, c.get('user').id, c.req.param('id'), ids, position))
          return result.response ?? c.json({ ok: true as const }, 200)
        },
      )

      .delete('/playlists/:id/items', auth, validate('json', z.object({ trackIds: trackIds.min(1) })), async (c) => {
        const { trackIds: ids } = c.req.valid('json')
        const result = await change(c, () => removeTracks(deps, c.get('user').id, c.req.param('id'), ids))
        return result.response ?? c.json({ ok: true as const }, 200)
      })

      .put(
        '/playlists/:id/items/move',
        auth,
        validate('json', z.object({ from: z.number().int().min(0), to: z.number().int().min(0) })),
        async (c) => {
          const { from, to } = c.req.valid('json')
          const result = await change(c, () => moveTrack(deps, c.get('user').id, c.req.param('id'), from, to))
          return result.response ?? c.json({ ok: true as const }, 200)
        },
      )
  )
}
