import { createRoute, z } from '@hono/zod-openapi'
import { schema, type User } from '@replay-crate/db'
import { eq } from 'drizzle-orm'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { createRouter, errorResponses, signedIn } from '../lib/openapi.ts'
import { jsonBody, jsonResponse } from '../lib/schemas.ts'

// The user's settings that follow them to every device. (View choices for one device, such as
// the theme or the Music | Podcasts mode, stay in that browser.)

export const Settings = z
  .object({
    playTracksFrom: z.enum(schema.PLAY_TRACKS_FROM).openapi({
      description:
        "Where a track played on its own starts from: its album, or the playlist it was last played from (its album when there's none). Up next is the rest of it.",
    }),
  })
  .openapi('Settings')

const toSettings = (user: Pick<User, 'playTracksFrom'>): z.infer<typeof Settings> => ({ playTracksFrom: user.playTracksFrom })

const getSettings = createRoute({
  method: 'get',
  path: '/settings',
  tags: ['Settings'],
  operationId: 'getSettings',
  summary: 'Your settings',
  security: signedIn,
  responses: { 200: jsonResponse(Settings, 'Your settings.'), ...errorResponses('unauthorized') },
})

const updateSettings = createRoute({
  method: 'patch',
  path: '/settings',
  tags: ['Settings'],
  operationId: 'updateSettings',
  summary: 'Change your settings',
  description: 'Changes the settings given and leaves the rest.',
  security: signedIn,
  request: { body: jsonBody(Settings.partial()) },
  responses: { 200: jsonResponse(Settings, 'Your settings, changed.'), ...errorResponses('invalid_request', 'unauthorized') },
})

export function settingsRoutes(deps: AppDeps) {
  const { db } = deps
  const auth = requireUser(deps)
  return createRouter()
    .openapi({ ...getSettings, middleware: auth }, (c) => c.json(toSettings(c.var.user), 200))
    .openapi({ ...updateSettings, middleware: auth }, async (c) => {
      const changes = c.req.valid('json')
      if (!Object.keys(changes).length) return c.json(toSettings(c.var.user), 200)
      const [user] = await db.update(schema.users).set(changes).where(eq(schema.users.id, c.var.user.id)).returning()
      return c.json(toSettings(user!), 200)
    })
}
