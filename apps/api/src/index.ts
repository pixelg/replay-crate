import { serve } from '@hono/node-server'
import { createDb } from '@replay-crate/db'
import { ENV } from 'varlock/env'
import { createApp } from './app.ts'
import { createTokenCipher } from './lib/crypto.ts'
import { createSpotifyGateway } from './spotify/gateway.ts'

const app = createApp({
  db: createDb(ENV.DATABASE_URL),
  cipher: await createTokenCipher(ENV.TOKEN_ENCRYPTION_KEY),
  spotify: createSpotifyGateway(ENV.SPOTIFY_CLIENT_ID),
  redirectUri: ENV.SPOTIFY_REDIRECT_URI,
  cronSecret: ENV.CRON_SECRET,
})

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: ENV.API_PORT }, (info) => {
  console.log(`API listening on http://${info.address}:${info.port}`)
})
