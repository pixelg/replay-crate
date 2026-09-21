import { serve } from '@hono/node-server'
import { ENV } from 'varlock/env'
import { createApp } from './app.ts'

const app = createApp()

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: ENV.API_PORT }, (info) => {
  console.log(`API listening on http://${info.address}:${info.port}`)
})
