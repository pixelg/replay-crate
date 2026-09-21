import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { HTTPException } from 'hono/http-exception'
import { authRoutes } from './auth/routes.ts'
import type { AppDeps } from './deps.ts'
import { historyRoutes } from './history/routes.ts'
import { playlistRoutes } from './playlists/routes.ts'
import { cronRoutes } from './sync/cron-routes.ts'

/**
 * Builds the API. Everything it talks to arrives through `deps`, so tests can
 * build the app with a PGlite database and a fake Spotify.
 */
export function createApp(deps: AppDeps) {
  const checkOrigin = csrf({ origin: new URL(deps.redirectUri).origin })

  const app = new Hono()
    .basePath('/api')
    // Cookies ride along on cross-site requests, so check Origin on writes. Bearer
    // tokens (native clients) are never sent automatically, so they skip the check.
    .use((c, next) => (c.req.header('Authorization')?.startsWith('Bearer ') ? next() : checkOrigin(c, next)))
    .get('/health', (c) => c.json({ ok: true }))
    .route('/', authRoutes(deps))
    .route('/', historyRoutes(deps))
    .route('/', playlistRoutes(deps))
    .route('/', cronRoutes(deps))

  app.onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse()
    console.error(error)
    return c.json({ error: 'internal_error' }, 500)
  })
  return app
}

export type AppType = ReturnType<typeof createApp>
export type { Me } from './auth/me.ts'
