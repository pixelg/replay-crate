import { createRoute, z } from '@hono/zod-openapi'
import { schema } from '@replay-crate/db'
import { SpotifyApiError } from '@replay-crate/spotify'
import { eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { missingScopes } from '../auth/me.ts'
import { requireUser } from '../auth/middleware.ts'
import type { AppDeps } from '../deps.ts'
import { createRouter, errorResponses, signedIn } from '../lib/openapi.ts'
import { jsonBody, jsonResponse } from '../lib/schemas.ts'
import { getAccessToken } from '../spotify/access-token.ts'
import { spotifyErrorResponse } from '../spotify/errors.ts'
import { upsertCatalog } from '../sync/catalog.ts'
import { Device, Playback, Queue, ratingsFor, toDevice, toItem, toPlayback } from './present.ts'

/** Scopes the player needs; users who connected before it existed lack them. */
const PLAYER_SCOPES = ['user-read-playback-state', 'user-read-currently-playing', 'user-modify-playback-state']

const deviceId = z.string().min(1).optional().openapi({ description: 'The device to act on. Defaults to the active one.' })

/** What a player call can fail with (see playerErrorResponse). */
const PLAYER_ERRORS = [
  'unauthorized',
  'forbidden',
  'not_found',
  'reauth_required',
  'rate_limited',
  'no_active_device',
  'premium_required',
  'missing_scopes',
  'command_refused',
] as const
const readErrors = errorResponses(...PLAYER_ERRORS)
const commandErrors = errorResponses('invalid_request', ...PLAYER_ERRORS)

const read = <const P extends string, S extends z.ZodType>(path: P, operationId: string, summary: string, response: S, description?: string) =>
  createRoute({
    method: 'get',
    path,
    tags: ['Player'],
    operationId,
    summary,
    description,
    security: signedIn,
    responses: { 200: jsonResponse(response, summary), ...readErrors },
  })

/** A playback command: a JSON body, 204 once Spotify has passed it to the device. */
const command = <const M extends 'put' | 'post', const P extends string, B extends z.ZodObject>(
  method: M,
  path: P,
  operationId: string,
  summary: string,
  body: B,
  description?: string,
) =>
  createRoute({
    method,
    path,
    tags: ['Player'],
    operationId,
    summary,
    description,
    security: signedIn,
    request: { body: jsonBody(body) },
    responses: { 204: { description: 'Sent to the device.' }, ...commandErrors },
  })

const getPlayback = read(
  '/player',
  'getPlayback',
  'What is playing',
  z.object({ playback: Playback.nullable().openapi({ description: 'Null when no device is active.' }) }),
  "The active device, the item and how far in, shuffle and repeat. The item's track is added to the catalog, so it can be linked and rated.",
)
const getQueue = read('/player/queue', 'getPlayerQueue', 'Up next', Queue)
const getDevices = read('/player/devices', 'getPlayerDevices', 'Devices you can play on', z.object({ devices: z.array(Device) }))

const play = command(
  'put',
  '/player/play',
  'play',
  'Play or resume',
  z.object({
    deviceId,
    uris: z.array(z.string()).min(1).max(100).optional().openapi({ description: 'Tracks to play, as spotify:track: URIs.' }),
    contextUri: z.string().optional().openapi({ description: 'An album, playlist or artist to play.', example: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' }),
    offset: z
      .union([z.object({ position: z.number().int().min(0) }), z.object({ uri: z.string() })])
      .optional()
      .openapi({ description: 'Where in `uris` or the context to start.' }),
    positionMs: z.number().int().min(0).optional(),
  }),
  'With `uris` or `contextUri`, starts playing them; with neither, resumes what was paused.',
)
const pause = command('put', '/player/pause', 'pause', 'Pause', z.object({ deviceId }))
const next = command('post', '/player/next', 'skipToNext', 'Skip to the next item', z.object({ deviceId }))
const previous = command(
  'post',
  '/player/previous',
  'skipToPrevious',
  'Go back',
  z.object({ deviceId }),
  'To the previous item, or to the start of this one once a few seconds in.',
)
const seek = command('put', '/player/seek', 'seek', 'Seek', z.object({ deviceId, positionMs: z.number().int().min(0) }))
const repeat = command('put', '/player/repeat', 'setRepeat', 'Set repeat', z.object({ deviceId, state: z.enum(['off', 'track', 'context']) }))
const shuffle = command('put', '/player/shuffle', 'setShuffle', 'Turn shuffle on or off', z.object({ deviceId, on: z.boolean() }))
const volume = command(
  'put',
  '/player/volume',
  'setVolume',
  'Set the volume',
  z.object({ deviceId, percent: z.number().int().min(0).max(100) }),
  'Devices with `supportsVolume: false` refuse (command_refused, VOLUME_CONTROL_DISALLOW).',
)
const enqueue = command(
  'post',
  '/player/queue',
  'addToQueue',
  'Add to the queue',
  z.object({ deviceId, uri: z.string().openapi({ description: 'A spotify:track: or spotify:episode: URI.' }) }),
)
const transfer = command(
  'put',
  '/player/device',
  'transferPlayback',
  'Move playback to a device',
  z.object({
    deviceId: z.string().min(1),
    play: z.boolean().optional().openapi({ description: 'Start playing there; otherwise keep the current state.' }),
  }),
)

/** Maps what Spotify's player can refuse to our error codes; null for anything else. */
function playerErrorResponse(c: Context, error: unknown) {
  if (error instanceof SpotifyApiError) {
    if (error.reason === 'NO_ACTIVE_DEVICE') return c.json({ error: 'no_active_device' as const }, 409)
    if (error.reason === 'PREMIUM_REQUIRED') return c.json({ error: 'premium_required' as const }, 403)
    if (error.status === 403 && error.reason && error.reason !== 'UNKNOWN') {
      return c.json({ error: 'command_refused' as const, reason: error.reason }, 403)
    }
  }
  return spotifyErrorResponse(c, error)
}

export function playerRoutes(deps: AppDeps) {
  const { db, spotify } = deps
  const auth = requireUser(deps)

  /**
   * Runs a Spotify call as the signed-in user: checks they granted the player scopes, gets a
   * fresh token, and turns Spotify's refusals into error responses.
   */
  async function withSpotify<T>(c: Context<{ Variables: { user: typeof schema.users.$inferSelect } }>, run: (token: string) => Promise<T>) {
    const user = c.var.user
    const scopes = missingScopes(user.scope).filter((scope) => PLAYER_SCOPES.includes(scope))
    if (scopes.length) return { response: c.json({ error: 'missing_scopes' as const, scopes }, 403) }
    try {
      return { value: await run(await getAccessToken(deps, user.id)) }
    } catch (error) {
      const response = playerErrorResponse(c, error)
      if (response) return { response }
      throw error
    }
  }

  return (
    createRouter()
      .openapi({ ...getPlayback, middleware: auth }, async (c) => {
        const result = await withSpotify(c, (token) => spotify.getPlaybackState(token))
        if (result.response) return result.response
        const state = result.value
        if (!state) return c.json({ playback: null }, 200)

        // New tracks join the catalog so the app can link and rate what's playing.
        const item = state.item
        if (item?.type === 'track' && item.id && !item.is_local) {
          const [known] = await db.select({ id: schema.tracks.id }).from(schema.tracks).where(eq(schema.tracks.id, item.id))
          if (!known) await upsertCatalog(db, [item])
        }
        return c.json({ playback: await toPlayback(db, c.var.user.id, state) }, 200)
      })

      .openapi({ ...getQueue, middleware: auth }, async (c) => {
        const result = await withSpotify(c, (token) => spotify.getQueue(token))
        if (result.response) return result.response
        const { currently_playing, queue } = result.value
        const ratings = await ratingsFor(db, c.var.user.id, [...(currently_playing ? [currently_playing] : []), ...queue])
        return c.json(
          {
            currentlyPlaying: currently_playing ? toItem(currently_playing, ratings) : null,
            queue: queue.map((item) => toItem(item, ratings)),
          },
          200,
        )
      })

      .openapi({ ...getDevices, middleware: auth }, async (c) => {
        const result = await withSpotify(c, (token) => spotify.getDevices(token))
        return result.response ?? c.json({ devices: result.value.map(toDevice) }, 200)
      })

      .openapi({ ...play, middleware: auth }, async (c) => {
        const { deviceId: target, ...request } = c.req.valid('json')
        const result = await withSpotify(c, (token) => spotify.play(token, { ...request, deviceId: target }))
        return result.response ?? c.body(null, 204)
      })
      .openapi({ ...pause, middleware: auth }, async (c) => {
        const result = await withSpotify(c, (token) => spotify.pause(token, c.req.valid('json')))
        return result.response ?? c.body(null, 204)
      })
      .openapi({ ...next, middleware: auth }, async (c) => {
        const result = await withSpotify(c, (token) => spotify.skipToNext(token, c.req.valid('json')))
        return result.response ?? c.body(null, 204)
      })
      .openapi({ ...previous, middleware: auth }, async (c) => {
        const result = await withSpotify(c, (token) => spotify.skipToPrevious(token, c.req.valid('json')))
        return result.response ?? c.body(null, 204)
      })
      .openapi({ ...seek, middleware: auth }, async (c) => {
        const { positionMs, ...target } = c.req.valid('json')
        const result = await withSpotify(c, (token) => spotify.seek(token, positionMs, target))
        return result.response ?? c.body(null, 204)
      })
      .openapi({ ...repeat, middleware: auth }, async (c) => {
        const { state, ...target } = c.req.valid('json')
        const result = await withSpotify(c, (token) => spotify.setRepeat(token, state, target))
        return result.response ?? c.body(null, 204)
      })
      .openapi({ ...shuffle, middleware: auth }, async (c) => {
        const { on, ...target } = c.req.valid('json')
        const result = await withSpotify(c, (token) => spotify.setShuffle(token, on, target))
        return result.response ?? c.body(null, 204)
      })
      .openapi({ ...volume, middleware: auth }, async (c) => {
        const { percent, ...target } = c.req.valid('json')
        const result = await withSpotify(c, (token) => spotify.setVolume(token, percent, target))
        return result.response ?? c.body(null, 204)
      })
      .openapi({ ...enqueue, middleware: auth }, async (c) => {
        const { uri, ...target } = c.req.valid('json')
        const result = await withSpotify(c, (token) => spotify.addToQueue(token, uri, target))
        return result.response ?? c.body(null, 204)
      })
      .openapi({ ...transfer, middleware: auth }, async (c) => {
        const { deviceId: target, play: start } = c.req.valid('json')
        const result = await withSpotify(c, (token) => spotify.transferPlayback(token, target, { play: start }))
        return result.response ?? c.body(null, 204)
      })
  )
}
