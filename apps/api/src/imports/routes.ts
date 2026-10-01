import { createRoute, z } from '@hono/zod-openapi'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { createRouter, errorResponses, signedIn } from '../lib/openapi.ts'
import { IsoDateTime, jsonBody, jsonResponse } from '../lib/schemas.ts'
import { addListens } from './listens.ts'
import { addPlays, createImport, findImport, finishUpload, latestImport } from './service.ts'

/** Most plays and listens accepted per upload request; the web app sends bigger imports in chunks. */
export const MAX_PLAYS_PER_REQUEST = 5_000

const ImportedPlay = z
  .object({
    ts: IsoDateTime.openapi({ description: 'When the play ended, from the export.' }),
    ms: z.number().int().min(0).openapi({ description: 'Milliseconds played.' }),
    trackId: z.string().regex(/^[0-9A-Za-z]{22}$/).openapi({ description: 'Spotify track id.' }),
  })
  .openapi('ImportedPlay')
const ImportedListen = z
  .object({
    ts: IsoDateTime.openapi({ description: 'When the listen ended, from the export.' }),
    ms: z.number().int().min(0).openapi({ description: 'Milliseconds listened.' }),
    episodeId: z.string().regex(/^[0-9A-Za-z]{22}$/).openapi({ description: 'Spotify episode id.' }),
  })
  .openapi('ImportedListen')
const ImportParams = z.object({ id: z.coerce.number().int().positive() })

const create = createRoute({
  method: 'post',
  path: '/imports',
  tags: ['Imports'],
  operationId: 'createImport',
  summary: 'Start an import',
  description:
    'Step 1 of 3. The browser parses the Extended Streaming History export and uploads only timestamp, ' +
    'play time and track (or podcast episode) id: create, add plays and listens (in chunks), finish.',
  security: signedIn,
  responses: {
    201: jsonResponse(z.object({ id: z.number().int() }), 'The new import.'),
    ...errorResponses('unauthorized'),
  },
})

const upload = createRoute({
  method: 'post',
  path: '/imports/{id}/plays',
  tags: ['Imports'],
  operationId: 'addImportPlays',
  summary: 'Upload a chunk of plays',
  description:
    `Step 2 of 3. Up to ${MAX_PLAYS_PER_REQUEST} plays and podcast listens in all per request; call as often as needed. ` +
    'Listens are what the export splits at every pause, already joined.',
  security: signedIn,
  request: {
    params: ImportParams,
    body: jsonBody(
      z
        .object({
          plays: z.array(ImportedPlay).max(MAX_PLAYS_PER_REQUEST).default([]),
          listens: z.array(ImportedListen).max(MAX_PLAYS_PER_REQUEST).default([]),
        })
        .refine((body) => body.plays.length + body.listens.length > 0, { message: 'Send at least one play or listen', path: ['plays'] })
        .refine((body) => body.plays.length + body.listens.length <= MAX_PLAYS_PER_REQUEST, {
          message: `At most ${MAX_PLAYS_PER_REQUEST} plays and listens in all`,
          path: ['listens'],
        }),
    ),
  },
  responses: {
    200: jsonResponse(z.object({ received: z.number().int() }), 'Plays and listens staged.'),
    ...errorResponses('invalid_request', 'unauthorized', 'not_found', 'already_finished'),
  },
})

const finish = createRoute({
  method: 'post',
  path: '/imports/{id}/finish',
  tags: ['Imports'],
  operationId: 'finishImport',
  summary: 'Finish an import',
  description:
    'Step 3 of 3. Plays of known tracks and listens of known episodes move into the history now; unknown ' +
    'ones are queued for lookup and follow. Closes any history gap the import covers.',
  security: signedIn,
  request: { params: ImportParams },
  responses: {
    200: jsonResponse(
      z.object({
        tracksToFetch: z.number().int().openapi({ description: 'Tracks queued for a Spotify lookup.' }),
        episodesToFetch: z.number().int().openapi({ description: 'Podcast episodes queued for a Spotify lookup.' }),
      }),
      'Finished.',
    ),
    ...errorResponses('invalid_request', 'unauthorized', 'not_found'),
  },
})

const latest = createRoute({
  method: 'get',
  path: '/imports/latest',
  tags: ['Imports'],
  operationId: 'getLatestImport',
  summary: 'Progress of the latest import',
  security: signedIn,
  responses: {
    200: jsonResponse(
      z.object({
        import: z
          .object({
            id: z.number().int(),
            playCount: z.number().int(),
            earliest: IsoDateTime.nullable(),
            latest: IsoDateTime.nullable(),
            unavailable: z.number().int().openapi({ description: 'Plays of tracks Spotify no longer has.' }),
            createdAt: IsoDateTime,
            uploadedAt: IsoDateTime.nullable(),
            waitingPlays: z.number().int().openapi({ description: "Plays still waiting for their track's details." }),
            tracksToFetch: z.number().int().openapi({ description: 'Tracks still to look up on Spotify.' }),
            listenCount: z.number().int().openapi({ description: 'Podcast listens uploaded.' }),
            listensUnavailable: z.number().int().openapi({ description: 'Listens of episodes Spotify no longer has.' }),
            waitingListens: z.number().int().openapi({ description: "Listens still waiting for their episode's details." }),
            episodesToFetch: z.number().int().openapi({ description: 'Episodes still to look up on Spotify.' }),
            done: z.boolean(),
          })
          .nullable()
          .openapi('ImportStatus', { description: 'null if there has never been an import.' }),
      }),
      'The latest import.',
    ),
    ...errorResponses('unauthorized'),
  },
})

export function importRoutes(deps: AppDeps) {
  const { db } = deps
  const auth = requireUser(deps)
  const now = deps.now ?? (() => new Date())

  return createRouter()
    .openapi({ ...create, middleware: auth }, async (c) => c.json({ id: await createImport(db, c.var.user.id, now()) }, 201))

    .openapi({ ...upload, middleware: auth }, async (c) => {
      const user = c.var.user
      const { id } = c.req.valid('param')
      const found = await findImport(db, user.id, id)
      if (!found) return c.json({ error: 'not_found' as const }, 404)
      if (found.uploadedAt) return c.json({ error: 'already_finished' as const }, 409)
      const { plays, listens } = c.req.valid('json')
      await addPlays(db, id, user.id, plays)
      await addListens(db, id, user.id, listens)
      return c.json({ received: plays.length + listens.length }, 200)
    })

    .openapi({ ...finish, middleware: auth }, async (c) => {
      const user = c.var.user
      const { id } = c.req.valid('param')
      const found = await findImport(db, user.id, id)
      if (!found) return c.json({ error: 'not_found' as const }, 404)
      return c.json(await finishUpload(db, id, user.id, now()), 200)
    })

    .openapi({ ...latest, middleware: auth }, async (c) => c.json({ import: await latestImport(db, c.var.user.id) }, 200))
}
