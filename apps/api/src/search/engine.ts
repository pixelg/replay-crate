import type { Db } from '@replay-crate/db'
import { createPostgresSearchIndex } from './postgres.ts'
import type { SearchIndex } from './types.ts'

/** The search engine for this environment. Postgres for now; Elasticsearch arrives in #116. */
export function createSearchIndex(db: Db): SearchIndex {
  return createPostgresSearchIndex(db)
}
