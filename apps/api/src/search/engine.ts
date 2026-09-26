import type { Db } from '@replay-crate/db'
import { createElasticSearchIndex, type ElasticSearchIndex } from './elastic.ts'
import { createPostgresSearchIndex } from './postgres.ts'
import type { SearchIndex } from './types.ts'

/** Elasticsearch when there's a URL for it, Postgres otherwise. */
export function createSearchIndex(db: Db, { elasticsearchUrl }: { elasticsearchUrl?: string }): SearchIndex {
  return elasticsearchUrl ? createElasticSearchIndex({ node: elasticsearchUrl }) : createPostgresSearchIndex(db)
}

export const isElastic = (index: SearchIndex): index is ElasticSearchIndex => index.engine === 'elasticsearch'
