import { createHash } from 'node:crypto'
import { Client, errors, type estypes } from '@elastic/elasticsearch'
import { foldText, highlightRanges, type EntityType, type SearchFilter, type SearchQuery } from '@replay-crate/core'
import { queryWords } from './postgres.ts'
import type { DocKey, FacetBucket, SearchDoc, SearchFacets, SearchHit, SearchIndex, SearchOptions, SearchResult } from './types.ts'

// Search on Elasticsearch. One index of per-user documents behind two aliases:
//
//   <prefix>-library        reads
//   <prefix>-library-write  writes
//
// Normally both point at the same index, named after a hash of its settings and mappings. A
// rebuild (`pnpm search:reindex`) creates a fresh index, moves the write alias to it, fills it,
// then moves the read alias across and drops the old one, so search keeps answering throughout.
// Every write carries the time its document was built as an external version, so whichever of
// the rebuild and the live indexer wrote a document last with newer data wins, never the stale one.

const FACET_SIZE = 10

const ANALYSIS: estypes.IndicesIndexSettingsAnalysis = {
  normalizer: {
    folded: { type: 'custom', filter: ['lowercase', 'asciifolding'] },
  },
  analyzer: {
    // "Beyoncé" and "beyonce" index the same.
    folded: { type: 'custom', tokenizer: 'standard', filter: ['lowercase', 'asciifolding'] },
    // Word pairs, for the phrase suggester ("did you mean").
    folded_shingles: { type: 'custom', tokenizer: 'standard', filter: ['lowercase', 'asciifolding', 'shingles'] },
  },
  filter: {
    shingles: { type: 'shingle', min_shingle_size: 2, max_shingle_size: 3 },
  },
}

const asYouType = (extra: Record<string, estypes.MappingProperty> = {}): estypes.MappingProperty => ({
  // Indexes each word, and 2- and 3-word shingles and edge n-grams, for matching as you type.
  type: 'search_as_you_type',
  analyzer: 'folded',
  fields: { keyword: { type: 'keyword' }, ...extra },
})

const MAPPINGS: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: {
    userId: { type: 'keyword' },
    type: { type: 'keyword' },
    id: { type: 'keyword' },
    name: asYouType({
      folded: { type: 'keyword', normalizer: 'folded' },
      shingles: { type: 'text', analyzer: 'folded_shingles' },
    }),
    artists: asYouType({ folded: { type: 'keyword', normalizer: 'folded' } }),
    album: { type: 'text', analyzer: 'folded', fields: { folded: { type: 'keyword', normalizer: 'folded' } } },
    playlists: { type: 'keyword', normalizer: 'folded', fields: { text: { type: 'text', analyzer: 'folded' } } },
    contexts: { type: 'keyword', fields: { folded: { type: 'keyword', normalizer: 'folded' } } },
    year: { type: 'short' },
    playCount: { type: 'integer' },
    rating: { type: 'byte' },
    lastPlayedAt: { type: 'date' },
    playedAt: { type: 'date' },
    imageUrl: { type: 'keyword', index: false },
    trackId: { type: 'keyword' },
    /** When the document was built: its external version too. */
    builtAt: { type: 'date' },
  },
}

/** The index layout's fingerprint: a new one means documents need re-indexing into a new index. */
export const MAPPING_HASH = createHash('sha256')
  .update(JSON.stringify({ ANALYSIS, MAPPINGS }))
  .digest('hex')
  .slice(0, 8)

type Source = Omit<SearchDoc, 'userId'> & { userId: string; builtAt: string }

const docId = (key: DocKey) => `${key.userId}:${key.type}:${key.id}`

export type ElasticSearchIndex = SearchIndex & {
  client: Client
  readAlias: string
  writeAlias: string
  /**
   * Creates the index and aliases if they don't exist yet. Returns whether it did (so the caller
   * can queue a full backfill), and whether the live index's layout is out of date.
   */
  ensureIndex(): Promise<{ created: boolean; stale: boolean }>
  /** Starts a rebuild: a new index takes the writes. Returns its name. */
  beginRebuild(): Promise<string>
  /** Ends a rebuild: reads move to the new index, and the old one goes. */
  finishRebuild(index: string): Promise<void>
  /** Makes recent writes searchable now (tests). */
  refresh(): Promise<void>
  /** Deletes every index with this prefix (tests). */
  destroy(): Promise<void>
}

export function createElasticSearchIndex({
  node,
  prefix = 'rc',
  refresh = false,
  now = () => Date.now(),
}: {
  node: string
  /** Index names start with this; tests use their own. */
  prefix?: string
  /** Wait for writes to be searchable (tests). */
  refresh?: boolean
  now?: () => number
}): ElasticSearchIndex {
  const client = new Client({ node })
  const readAlias = `${prefix}-library`
  const writeAlias = `${prefix}-library-write`
  const indexName = (suffix = '') => `${prefix}-library-${MAPPING_HASH}${suffix}`

  async function aliasTargets(alias: string): Promise<string[]> {
    try {
      return Object.keys(await client.indices.getAlias({ name: alias }))
    } catch (error) {
      if (error instanceof errors.ResponseError && error.statusCode === 404) return []
      throw error
    }
  }

  async function createIndex(name: string) {
    await client.indices.create({
      index: name,
      settings: { number_of_shards: 1, number_of_replicas: 0, analysis: ANALYSIS },
      mappings: MAPPINGS,
    })
  }

  /** Bulk writes, ignoring version conflicts: those mean a newer version is already there. */
  async function bulk(operations: estypes.BulkRequest['operations']) {
    const response = await client.bulk({ operations, refresh: refresh ? 'wait_for' : false })
    if (!response.errors) return
    const failures = response.items
      .map((item) => Object.values(item)[0]!)
      .filter((result) => result.error && result.status !== 409 && !(result.status === 404 && result.result === 'not_found'))
    if (failures.length) {
      throw new Error(`Elasticsearch rejected ${failures.length} writes: ${JSON.stringify(failures[0]!.error)}`)
    }
  }

  return {
    engine: 'elasticsearch',
    client,
    readAlias,
    writeAlias,

    async ensureIndex() {
      const reading = await aliasTargets(readAlias)
      if (reading.length) {
        return { created: false, stale: !reading.some((index) => index.startsWith(indexName())) }
      }
      const name = indexName(`-${now()}`)
      await createIndex(name)
      await client.indices.updateAliases({
        actions: [
          { add: { index: name, alias: readAlias } },
          { add: { index: name, alias: writeAlias, is_write_index: true } },
        ],
      })
      return { created: true, stale: false }
    },

    async beginRebuild() {
      const name = indexName(`-${now()}`)
      await createIndex(name)
      const writing = await aliasTargets(writeAlias)
      await client.indices.updateAliases({
        actions: [
          ...writing.map((index) => ({ remove: { index, alias: writeAlias } })),
          { add: { index: name, alias: writeAlias, is_write_index: true } },
        ],
      })
      return name
    },

    async finishRebuild(name) {
      const reading = (await aliasTargets(readAlias)).filter((index) => index !== name)
      // One atomic switch: searches see the old index, then the new one, never neither.
      await client.indices.updateAliases({
        actions: [...reading.map((index) => ({ remove: { index, alias: readAlias } })), { add: { index: name, alias: readAlias } }],
      })
      if (reading.length) await client.indices.delete({ index: reading })
    },

    async refresh() {
      await client.indices.refresh({ index: [readAlias, writeAlias] })
    },

    async destroy() {
      // Deleting by wildcard is refused (action.destructive_requires_name), so by name.
      const names = Object.keys(await client.indices.get({ index: `${prefix}-library-*`, ignore_unavailable: true, allow_no_indices: true }))
      if (names.length) await client.indices.delete({ index: names })
    },

    async upsert(docs) {
      if (!docs.length) return
      const version = now()
      const builtAt = new Date(version).toISOString()
      await bulk(
        docs.flatMap((doc) => [
          { index: { _index: writeAlias, _id: docId(doc), version, version_type: 'external_gte' as const } },
          { ...doc, builtAt } satisfies Source,
        ]),
      )
    },

    async remove(keys) {
      if (!keys.length) return
      const version = now()
      await bulk(keys.map((key) => ({ delete: { _index: writeAlias, _id: docId(key), version, version_type: 'external_gte' as const } })))
    },

    search: (userId, query, options) => searchElastic(client, readAlias, userId, query, options),
  }
}

/** A filter as an Elasticsearch query (the caller puts it under must_not when negated). */
function filterQuery(filter: SearchFilter): estypes.QueryDslQueryContainer {
  if ('range' in filter) {
    const field = { rating: 'rating', plays: 'playCount', year: 'year' }[filter.field]
    return { range: { [field]: { ...(filter.range.min !== undefined && { gte: filter.range.min }), ...(filter.range.max !== undefined && { lte: filter.range.max }) } } }
  }
  if (filter.field === 'type') return { term: { type: filter.value } }
  // "Contains", case- and accent-insensitive, like the Postgres engine's `like '%…%'`.
  const contains = (field: string) => ({ wildcard: { [field]: { value: `*${foldText(filter.value)}*` } } })
  const onType = (type: EntityType, own: string, other: string): estypes.QueryDslQueryContainer => ({
    bool: {
      should: [
        { bool: { filter: [{ term: { type } }, contains(own)] } },
        { bool: { filter: [contains(other)], must_not: [{ term: { type } }] } },
      ],
      minimum_should_match: 1,
    },
  })
  switch (filter.field) {
    case 'artist':
      return onType('artist', 'name.folded', 'artists.folded')
    case 'album':
      return onType('album', 'name.folded', 'album.folded')
    case 'in':
      return onType('playlist', 'name.folded', 'playlists')
    case 'from':
      return contains('contexts.folded')
  }
}

async function searchElastic(
  client: Client,
  index: string,
  userId: string,
  query: SearchQuery,
  options: SearchOptions,
): Promise<SearchResult> {
  const words = queryWords(query.text)
  const text = words.join(' ')
  const phrases = query.phrases.map(foldText)
  if (!words.length && !query.filters.length) return { total: 0, groups: [], suggestion: null }

  const typeFilters = query.filters.filter((filter) => filter.field === 'type')
  const wanted = typeFilters.filter((filter) => !filter.negate).map((filter) => filter.value as EntityType)
  const unwanted = new Set(typeFilters.filter((filter) => filter.negate).map((filter) => filter.value))
  const types = (options.types ?? (['track', 'artist', 'album', 'playlist', 'play'] as EntityType[]))
    .filter((type) => !wanted.length || wanted.includes(type))
    .filter((type) => !unwanted.has(type))
  if (!types.length) return { total: 0, groups: [], suggestion: null }

  const filters = query.filters.filter((filter) => filter.field !== 'type')
  const textFields = ['name', 'name._2gram', 'name._3gram', 'artists', 'artists._2gram', 'artists._3gram', 'album']
  const matchText: estypes.QueryDslQueryContainer[] = words.length
    ? [
        {
          bool: {
            // Each word must match: as a word start (the last one as you type), or within a typo
            // or two (`fuzziness: AUTO`) for anything longer than a couple of letters.
            should: [
              { multi_match: { query: text, type: 'bool_prefix', fields: textFields, operator: 'and', fuzziness: 'AUTO', prefix_length: 1 } },
              { multi_match: { query: text, type: 'best_fields', fields: ['name', 'artists', 'album'], operator: 'and', fuzziness: 'AUTO', prefix_length: 1 } },
            ],
            minimum_should_match: 1,
          },
        },
        ...phrases.map((phrase) => ({ multi_match: { query: phrase, type: 'phrase' as const, fields: ['name', 'artists', 'album'] } })),
      ]
    : [{ match_all: {} }]

  const base: estypes.QueryDslBoolQuery = {
    filter: [{ term: { userId } }, ...filters.filter((filter) => !filter.negate).map(filterQuery)],
    must_not: filters.filter((filter) => filter.negate).map(filterQuery),
    must: matchText,
    // A closer name ranks higher: the whole name, then the name starting with what was typed.
    should: words.length
      ? [
          { term: { 'name.folded': { value: text, boost: 6 } } },
          { prefix: { 'name.folded': { value: text, boost: 3 } } },
          { match_phrase_prefix: { name: { query: text, boost: 2 } } },
        ]
      : [],
  }
  // Then the user's own plays and ratings, added to the text score.
  const scored = (bool: estypes.QueryDslBoolQuery): estypes.QueryDslQueryContainer => ({
    function_score: {
      query: { bool },
      functions: [
        { field_value_factor: { field: 'playCount', modifier: 'ln1p', factor: words.length ? 0.4 : 1, missing: 0 } },
        { field_value_factor: { field: 'rating', factor: words.length ? 0.2 : 0.5, missing: 0 } },
      ],
      score_mode: 'sum',
      boost_mode: 'sum',
    },
  })
  const sort: estypes.SortCombinations[] = ['_score', { playedAt: { order: 'desc', missing: '_last' } }, { lastPlayedAt: { order: 'desc', missing: '_last' } }, 'name.keyword']

  // One round trip: a search per type, and one for the facets.
  const searches: estypes.MsearchRequestItem[] = types.flatMap((type) => [
    { index },
    {
      query: scored({ ...base, filter: [...(base.filter as estypes.QueryDslQueryContainer[]), { term: { type } }] }),
      sort,
      from: options.offset ?? 0,
      size: options.limit,
      track_total_hits: true,
    },
  ])
  const focus = types.length === 1 ? types[0]! : 'track'
  searches.push(
    { index },
    {
      size: 0,
      track_total_hits: true,
      query: { bool: { ...base, filter: [...(base.filter as estypes.QueryDslQueryContainer[]), { terms: { type: types } }] } },
      aggs: options.facets
        ? {
            types: { terms: { field: 'type', size: 10 } },
            focus: {
              filter: { term: { type: focus } },
              aggs: {
                decades: { histogram: { field: 'year', interval: 10, min_doc_count: 1 } },
                ratings: { terms: { field: 'rating', size: 5, order: { _key: 'desc' } } },
                artists: { terms: { field: 'artists.keyword', size: FACET_SIZE, order: [{ _count: 'desc' }, { _key: 'asc' }] } },
                contexts: { terms: { field: 'contexts', size: FACET_SIZE, order: [{ _count: 'desc' }, { _key: 'asc' }] } },
              },
            },
          }
        : undefined,
    },
  )
  const { responses } = await client.msearch<Source>({ searches })
  for (const response of responses) if ('error' in response) throw new Error(`Elasticsearch search failed: ${JSON.stringify(response.error)}`)
  const ok = responses as estypes.MsearchMultiSearchItem<Source>[]

  const highlightWords = [...words, ...phrases.flatMap(queryWords)]
  const groups = types.flatMap((type, i) => {
    const response = ok[i]!
    const total = typeof response.hits.total === 'number' ? response.hits.total : (response.hits.total?.value ?? 0)
    if (!total) return []
    const hits: SearchHit[] = response.hits.hits.map((hit) => {
      const { userId: _, builtAt: __, ...doc } = hit._source!
      return {
        ...doc,
        score: hit._score ?? 0,
        highlights: {
          name: highlightRanges(doc.name, highlightWords),
          artists: doc.artists.map((artist) => highlightRanges(artist, highlightWords)),
        },
      }
    })
    return [{ type, total, hits }]
  })

  const summary = ok.at(-1)!
  const total = typeof summary.hits.total === 'number' ? summary.hits.total : (summary.hits.total?.value ?? 0)
  const result: SearchResult = { total, groups, suggestion: null }
  if (options.facets) result.facets = facets(summary.aggregations)
  if (total === 0 && words.length) result.suggestion = await suggest(client, index, userId, text)
  return result
}

function facets(aggregations: Record<string, estypes.AggregationsAggregate> | undefined): SearchFacets {
  type Buckets = { buckets: { key: string | number; doc_count: number }[] }
  const buckets = <V extends string | number>(aggregate: unknown): FacetBucket<V>[] =>
    ((aggregate as Buckets | undefined)?.buckets ?? []).map((bucket) => ({ value: bucket.key as V, count: bucket.doc_count }))
  const focus = aggregations?.focus as Record<string, unknown> | undefined
  return {
    types: buckets<EntityType>(aggregations?.types),
    decades: buckets<number>(focus?.decades),
    ratings: buckets<number>(focus?.ratings),
    artists: buckets<string>(focus?.artists),
    contexts: buckets<string>(focus?.contexts),
  }
}

/**
 * "Did you mean". First the phrase suggester: it proposes corrections word by word (candidates
 * from the name's words, ranked by how the name's word pairs run), and the collate query keeps
 * only corrections that find something in this user's library. When no correction does (a word
 * too far off to fix), the closest name in the library instead, as the Postgres engine does.
 */
async function suggest(client: Client, index: string, userId: string, text: string): Promise<string | null> {
  const response = await client.search({
    index,
    size: 1,
    _source: ['name'],
    // The fallback: any word close enough, best match first.
    query: {
      bool: {
        filter: [{ term: { userId } }],
        must_not: [{ term: { type: 'play' } }],
        must: [{ match: { name: { query: text, fuzziness: 'AUTO', operator: 'or' } } }],
      },
    },
    suggest: {
      text,
      corrected: {
        phrase: {
          field: 'name.shingles',
          size: 1,
          max_errors: 2,
          confidence: 0,
          direct_generator: [{ field: 'name', suggest_mode: 'always', min_word_length: 3 }],
          collate: {
            query: {
              source: JSON.stringify({
                bool: { filter: [{ term: { userId } }], must: [{ match: { name: { query: '{{suggestion}}', operator: 'and' } } }] },
              }),
            },
          },
        },
      },
    },
  })
  const corrections = (response.suggest?.corrected?.[0]?.options ?? []) as estypes.SearchPhraseSuggestOption[]
  const closest = (response.hits.hits[0]?._source as { name?: string } | undefined)?.name
  return corrections[0]?.text ?? closest ?? null
}
