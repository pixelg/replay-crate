import { Hono } from 'hono'
import { z } from 'zod'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { validate } from '../lib/validate.ts'
import { addPlays, createImport, findImport, finishUpload, latestImport } from './service.ts'

/** Most plays accepted per upload request; the web app sends bigger imports in chunks. */
export const MAX_PLAYS_PER_REQUEST = 5_000

const importedPlay = z.object({
  ts: z.iso.datetime({ offset: true }),
  ms: z.number().int().min(0),
  trackId: z.string().regex(/^[0-9A-Za-z]{22}$/),
})
const importId = z.object({ id: z.coerce.number().int().positive() })

/**
 * Importing Spotify's Extended Streaming History. The browser parses the export and sends
 * only timestamp, play time and track id, in chunks: create, add plays..., finish.
 */
export function importRoutes(deps: AppDeps) {
  const { db } = deps
  const auth = requireUser(deps)
  const now = deps.now ?? (() => new Date())

  return (
    new Hono()
      .post('/imports', auth, async (c) => c.json({ id: await createImport(db, c.get('user').id, now()) }, 201))

      .post(
        '/imports/:id/plays',
        auth,
        validate('param', importId),
        validate('json', z.object({ plays: z.array(importedPlay).min(1).max(MAX_PLAYS_PER_REQUEST) })),
        async (c) => {
          const user = c.get('user')
          const { id } = c.req.valid('param')
          const found = await findImport(db, user.id, id)
          if (!found) return c.json({ error: 'not_found' as const }, 404)
          if (found.uploadedAt) return c.json({ error: 'already_finished' as const }, 409)
          const { plays } = c.req.valid('json')
          await addPlays(db, id, user.id, plays)
          return c.json({ received: plays.length }, 200)
        },
      )

      .post('/imports/:id/finish', auth, validate('param', importId), async (c) => {
        const user = c.get('user')
        const { id } = c.req.valid('param')
        const found = await findImport(db, user.id, id)
        if (!found) return c.json({ error: 'not_found' as const }, 404)
        const result = await finishUpload(db, id, user.id, now())
        return c.json(result, 200)
      })

      /** Progress of the most recent import, or null if there's never been one. */
      .get('/imports/latest', auth, async (c) => c.json({ import: await latestImport(db, c.get('user').id) }, 200))
  )
}
