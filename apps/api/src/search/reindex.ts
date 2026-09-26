// Rebuilds the search index from Postgres: `pnpm search:reindex` (every user) or
// `pnpm search:reindex <spotify user id>`. The running app picks up changes on its own; this is
// for a new or wiped index, or after changing how documents are built.
import { createDb } from '@replay-crate/db'
import { ENV } from 'varlock/env'
import { createSearchIndex } from './engine.ts'
import { drainAll, enqueueEverything } from './indexer.ts'

const db = createDb(ENV.DATABASE_URL)
const search = createSearchIndex(db)
const userId = process.argv[2]

const started = Date.now()
const queued = await enqueueEverything({ db }, userId)
console.log(`Queued ${queued} documents for ${userId ?? 'every user'}; indexing into ${search.engine}…`)
const result = await drainAll({ db, search })
console.log(`Done in ${((Date.now() - started) / 1000).toFixed(1)}s: ${result.indexed} indexed, ${result.removed} removed.`)
process.exit(0)
