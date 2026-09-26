// Rebuilds the search index from Postgres: `pnpm search:reindex`, or `pnpm search:reindex <user id>`
// for one library. The running app keeps the index current on its own; this is for a wiped
// index, or after changing the index layout or how documents are built.
//
// Elasticsearch: a new index is built behind the aliases while search keeps answering from the
// old one, then swapped in (see elastic.ts). Postgres, or a single user: every document is queued
// in the outbox and indexed.
import { createDb } from '@replay-crate/db'
import { ENV } from 'varlock/env'
import { createSearchIndex, isElastic } from './engine.ts'
import { buildEverything, drainAll, enqueueEverything } from './indexer.ts'

const db = createDb(ENV.DATABASE_URL)
const search = createSearchIndex(db, { elasticsearchUrl: ENV.ELASTICSEARCH_URL })
const userId = process.argv[2]
const started = Date.now()
const took = () => `${((Date.now() - started) / 1000).toFixed(1)}s`

if (isElastic(search) && !userId) {
  await search.ensureIndex()
  const next = await search.beginRebuild()
  console.log(`Building ${next}; searches use the current index until it's ready…`)
  const written = await buildEverything({ db, search }, { log: (message) => console.log(`  ${message}`) })
  await search.finishRebuild(next)
  console.log(`Done in ${took()}: ${written} documents, now live behind ${search.readAlias}.`)
} else {
  const queued = await enqueueEverything({ db }, userId)
  console.log(`Queued ${queued} documents for ${userId ?? 'every user'}; indexing into ${search.engine}…`)
  const result = await drainAll({ db, search })
  console.log(`Done in ${took()}: ${result.indexed} indexed, ${result.removed} removed.`)
}
process.exit(0)
