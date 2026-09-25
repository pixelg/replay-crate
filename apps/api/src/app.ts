import { OpenAPIHono } from '@hono/zod-openapi'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { requestId } from 'hono/request-id'
import { authRoutes } from './auth/routes.ts'
import type { AppDeps } from './deps.ts'
import { historyRoutes } from './history/routes.ts'
import { importRoutes } from './imports/routes.ts'
import { defaultHook, SECURITY_SCHEMES, TAGS } from './lib/openapi.ts'
import { playlistManageRoutes } from './playlists/manage-routes.ts'
import { playlistRoutes } from './playlists/routes.ts'
import { statsRoutes } from './stats/routes.ts'
import { cronRoutes } from './sync/cron-routes.ts'

/** Every endpoint lives under this prefix; the spec is at `${API_BASE}/openapi.json`. */
export const API_BASE = '/api/v1'

/**
 * Builds the API. Everything it talks to arrives through `deps`, so tests can
 * build the app with a PGlite database and a fake Spotify.
 */
export function createApp(deps: AppDeps) {
  const checkOrigin = csrf({ origin: new URL(deps.redirectUri).origin })

  const root = new OpenAPIHono({ defaultHook }).basePath(API_BASE)
  // Built from the routes' createRoute() definitions when requested.
  root.doc31('/openapi.json', {
    openapi: '3.1.0',
    info: {
      title: 'Replay Crate API',
      version: '1.0.0',
      description:
        'Records every Spotify play, counts plays per track, manages playlists and serves listening metrics. ' +
        'Every error is JSON `{ error: <code>, ...details }`, and every response carries `X-Request-Id`.',
    },
    tags: [...TAGS],
  })
  for (const [name, scheme] of Object.entries(SECURITY_SCHEMES)) {
    root.openAPIRegistry.registerComponent('securitySchemes', name, scheme)
  }

  // One chain, so AppType (and the typed client) sees every route. Mounting an OpenAPIHono
  // router with .route() also adds its routes to the spec.
  const app = root
    // Every response carries X-Request-Id; errors log it so a report can be matched to the log.
    .use(requestId())
    // Cookies ride along on cross-site requests, so check Origin on writes. Bearer
    // tokens (native clients) are never sent automatically, so they skip the check.
    .use((c, next) => (c.req.header('Authorization')?.startsWith('Bearer ') ? next() : checkOrigin(c, next)))
    .get('/health', (c) => c.json({ ok: true }))
    .route('/', authRoutes(deps))
    .route('/', historyRoutes(deps))
    // Before playlistRoutes so /playlists/preview isn't taken for a playlist id.
    .route('/', playlistManageRoutes(deps))
    .route('/', playlistRoutes(deps))
    .route('/', statsRoutes(deps))
    .route('/', importRoutes(deps))
    .route('/', cronRoutes(deps))

  // Every error response is JSON: `{ error: <code>, ...details }`.
  app.notFound((c) => c.json({ error: 'not_found' }, 404))
  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      const status = error.status
      return c.json({ error: status === 403 ? 'forbidden' : 'http_error', message: error.message }, status)
    }
    const id = c.get('requestId')
    console.error(`[${id}] ${c.req.method} ${c.req.path} failed:`, error)
    return c.json({ error: 'internal_error', requestId: id }, 500)
  })
  return app
}

export type AppType = ReturnType<typeof createApp>
export type { Me } from './auth/me.ts'
export type { PlaylistRule } from './playlists/rules.ts'
