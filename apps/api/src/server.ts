import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { createApp } from './app.ts'
import type { AppDeps } from './deps.ts'

/**
 * The API plus, optionally, the built web app on the same origin (`webDistDir`): hashed
 * assets are cached for a year, and any other non-API path gets index.html so the
 * client-side router can take over. This is how `pnpm serve` runs, and how a hosted
 * deploy would too.
 */
export function createServer(deps: AppDeps, { webDistDir }: { webDistDir?: string } = {}) {
  const api = createApp(deps)
  if (!webDistDir) return api

  return (
    new Hono()
      .route('/', api)
      // Unknown API paths stay JSON 404s instead of falling through to the web app.
      .all('/api/*', (c) => c.json({ error: 'not_found' }, 404))
      // Vite fingerprints everything in /assets, so those never change; index.html must
      // always be revalidated so a new build is picked up.
      .use('/*', async (c, next) => {
        await next()
        if (c.res.ok) {
          c.res.headers.set(
            'Cache-Control',
            c.req.path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
          )
        }
      })
      .use('/*', serveStatic({ root: webDistDir }))
      .get('*', serveStatic({ root: webDistDir, path: 'index.html' }))
  )
}
