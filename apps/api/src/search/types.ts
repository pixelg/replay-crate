import type { EntityType, SearchQuery, TextRange } from '@replay-crate/core'

/**
 * One thing in one user's library, as the search index holds it: denormalised (artist names,
 * playlist names…) and carrying the user's own play count and rating, so the index can rank by
 * them. Built from SQL by `buildDocs`, whichever engine stores it.
 */
export type SearchDoc = {
  userId: string
  type: EntityType
  /** The entity's id: a Spotify id, or for a play its row id. */
  id: string
  /** Track, artist, album or playlist name; for a play, its track's name. */
  name: string
  /** A track's, album's or play's artists; a playlist's owner. */
  artists: string[]
  /** A track's or play's album. */
  album: string | null
  /** The user's playlists a track is on. */
  playlists: string[]
  /** Where the user played a track from (context names); a play's context. */
  contexts: string[]
  /** Release year: tracks, albums, plays. */
  year: number | null
  /** The user's plays: of a track, an artist's tracks, an album, or from a playlist. */
  playCount: number
  /** The user's rating of a track (or a play's track). */
  rating: number | null
  lastPlayedAt: string | null
  /** When a play happened. */
  playedAt: string | null
  imageUrl: string | null
  /** The track behind a play. */
  trackId: string | null
}

export type DocKey = Pick<SearchDoc, 'userId' | 'type' | 'id'>

/** A search result: the document, how well it matched, and what to bold. */
export type SearchHit = Omit<SearchDoc, 'userId'> & {
  score: number
  highlights: { name: TextRange[]; artists: TextRange[][] }
}

export type FacetBucket<V extends string | number = string> = { value: V; count: number }

export type SearchFacets = {
  types: FacetBucket<EntityType>[]
  /** Decades by their first year: 1990 for the 90s. */
  decades: FacetBucket<number>[]
  ratings: FacetBucket<number>[]
  artists: FacetBucket[]
  contexts: FacetBucket[]
}

export type SearchResult = {
  /** Matches across every group. */
  total: number
  /** One group per type with matches, best first within each. */
  groups: { type: EntityType; total: number; hits: SearchHit[] }[]
  facets?: SearchFacets
  /** When nothing matched: the closest name in the library, as a "did you mean". */
  suggestion: string | null
}

export type SearchOptions = {
  /** Only these types; every type when absent. */
  types?: EntityType[]
  /** Hits per group. */
  limit: number
  /** Skip this many hits in each group (for paging one type). */
  offset?: number
  facets?: boolean
}

/**
 * The search engine behind /search, kept in step with Postgres by the indexer. Elasticsearch
 * when it's configured, Postgres (trigram matching) otherwise; both pass the same contract
 * tests (`contract.ts`).
 */
export interface SearchIndex {
  readonly engine: 'elasticsearch' | 'postgres'
  upsert(docs: SearchDoc[]): Promise<void>
  remove(keys: DocKey[]): Promise<void>
  search(userId: string, query: SearchQuery, options: SearchOptions): Promise<SearchResult>
}
