import { Hono } from 'hono'

/**
 * Builds the API. Dependencies (db, Spotify client, config) get passed in here as
 * they're added, so tests can build the app without touching env or network.
 */
export function createApp() {
  return new Hono().basePath('/api').get('/health', (c) => c.json({ ok: true }))
}

export type AppType = ReturnType<typeof createApp>
