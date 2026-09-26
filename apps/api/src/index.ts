import { serve } from '@hono/node-server'
import { createDb } from '@replay-crate/db'
import { ENV } from 'varlock/env'
import { createTokenCipher } from './lib/crypto.ts'
import { createServer } from './server.ts'
import { createSpotifyGateway } from './spotify/gateway.ts'
import { startJobRunner } from './jobs/runner.ts'
import { startSyncScheduler } from './sync/scheduler.ts'
import { enqueueEverything, startSearchIndexer } from './search/indexer.ts'
import { createAnalytics, createSearchIndex, isElastic } from './search/engine.ts'

const db = createDb(ENV.DATABASE_URL)
const deps = {
  db,
  cipher: await createTokenCipher(ENV.TOKEN_ENCRYPTION_KEY),
  spotify: createSpotifyGateway(ENV.SPOTIFY_CLIENT_ID),
  redirectUri: ENV.SPOTIFY_REDIRECT_URI,
  cronSecret: ENV.CRON_SECRET,
  search: createSearchIndex(db, { elasticsearchUrl: ENV.ELASTICSEARCH_URL }),
  analytics: createAnalytics({ elasticsearchUrl: ENV.ELASTICSEARCH_URL }),
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
// Keeps the search index in step with what syncs and imports write.
if (isElastic(deps.search)) {
  try {
    const { created, stale } = await deps.search.ensureIndex()
    const { playsCreated } = (await deps.analytics?.ensureIndices()) ?? { playsCreated: false }
    // A brand-new index starts empty: queue the whole library for the indexer.
    if (created || playsCreated) {
      console.log(`Search: new Elasticsearch indices; indexing ${await enqueueEverything(deps)} documents`)
    }
    if (stale) console.warn('Search: the Elasticsearch index layout changed; run `pnpm search:reindex` to rebuild it')
  } catch (error) {
    console.error(`Search: Elasticsearch at ${ENV.ELASTICSEARCH_URL} isn't answering (\`pnpm search:up\`?)`, error)
  }
}
console.log(`Search: ${deps.search.engine}`)
startSearchIndexer(deps)
