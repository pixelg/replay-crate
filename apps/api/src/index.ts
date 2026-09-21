import { serve } from '@hono/node-server'
import { createDb } from '@replay-crate/db'
import { ENV } from 'varlock/env'
import { createTokenCipher } from './lib/crypto.ts'
import { createServer } from './server.ts'
import { createSpotifyGateway } from './spotify/gateway.ts'
import { startJobRunner } from './jobs/runner.ts'
import { startSyncScheduler } from './sync/scheduler.ts'

const deps = {
  db: createDb(ENV.DATABASE_URL),
  cipher: await createTokenCipher(ENV.TOKEN_ENCRYPTION_KEY),
  spotify: createSpotifyGateway(ENV.SPOTIFY_CLIENT_ID),
  redirectUri: ENV.SPOTIFY_REDIRECT_URI,
  cronSecret: ENV.CRON_SECRET,
}

const server = createServer(deps, { webDistDir: ENV.WEB_DIST_DIR })

serve({ fetch: server.fetch, hostname: '127.0.0.1', port: ENV.API_PORT }, (info) => {
  const serving = ENV.WEB_DIST_DIR ? `app + API from ${ENV.WEB_DIST_DIR}` : 'API'
  console.log(`Replay Crate ${serving} on http://${info.address}:${info.port}`)
})

if (ENV.SYNC_INTERVAL_MINUTES > 0) {
  startSyncScheduler(deps, { intervalMs: ENV.SYNC_INTERVAL_MINUTES * 60_000 })
  console.log(`Syncing recently played every ${ENV.SYNC_INTERVAL_MINUTES} minutes`)
}

// Background Spotify lookups (e.g. tracks named in an import), one at a time.
startJobRunner(deps)
