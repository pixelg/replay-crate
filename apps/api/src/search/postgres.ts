import { foldText, highlightRanges, type EntityType, type SearchFilter, type SearchQuery } from '@replay-crate/core'
import { schema, type Db } from '@replay-crate/db'
import { sql, type SQL } from 'drizzle-orm'
import type { DocKey, FacetBucket, SearchDoc, SearchFacets, SearchHit, SearchIndex, SearchOptions, SearchResult } from './types.ts'

const { searchDocs } = schema

/** Words as the index sees them: folded, letters and digits only ("AC/DC" → ac, dc). */
export const queryWords = (text: string) => foldText(text).match(/[\p{L}\p{N}]+/gu) ?? []

const FACET_SIZE = 10

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows
}

/** The text a document is found by: its name first, then who made it and where it's from. */
const searchText = (doc: SearchDoc) => [doc.name, ...doc.artists, doc.album ?? ''].join(' ')
const folded = (column: SQL) => sql`f_unaccent(lower(${column}))`

/** A filter as a condition on `d`, or null when the document has nothing to compare (excluded unless negated). */
function filterCondition(filter: SearchFilter): SQL {
  const like = (column: SQL) => sql`${folded(column)} like ${`%${foldText('value' in filter ? filter.value : '')}%`}`
  const anyLike = (column: SQL) => sql`exists (select 1 from unnest(${column}) as v(x) where ${like(sql`v.x`)})`
  if ('range' in filter) {
    const column = { rating: sql`d.rating`, plays: sql`d.play_count`, year: sql`d.year` }[filter.field]
    const { min, max } = filter.range
    return sql.join(
      [...(min !== undefined ? [sql`${column} >= ${min}`] : []), ...(max !== undefined ? [sql`${column} <= ${max}`] : [])],
      sql` and `,
    )
  }
  switch (filter.field) {
    case 'artist':
      return sql`case when d.type = 'artist' then ${like(sql`d.name`)} else ${anyLike(sql`d.artists`)} end`
    case 'album':
      return sql`case when d.type = 'album' then ${like(sql`d.name`)} else ${like(sql`d.album`)} end`
    case 'in':
      return sql`case when d.type = 'playlist' then ${like(sql`d.name`)} else ${anyLike(sql`d.playlists`)} end`
    case 'from':
      return anyLike(sql`d.contexts`)
    case 'type':
      return sql`d.type = ${filter.value}`
  }
}

/**
 * Search on Postgres alone: trigram matching (pg_trgm) over folded text in `search_docs`.
 * Each word must start a word in the document or be close to one (typos: word_similarity, the
 * `<%` operator, which the GIN index serves). Ranking adds the user's plays and rating.
 */
export function createPostgresSearchIndex(db: Db): SearchIndex {
  return {
    engine: 'postgres',

    async upsert(docs) {
      if (!docs.length) return
      const values = docs.map((doc) => ({
        userId: doc.userId,
        type: doc.type,
        id: doc.id,
        name: doc.name,
        artists: doc.artists,
        album: doc.album,
        playlists: doc.playlists,
        contexts: doc.contexts,
        year: doc.year,
        playCount: doc.playCount,
        rating: doc.rating,
        lastPlayedAt: doc.lastPlayedAt ? new Date(doc.lastPlayedAt) : null,
        playedAt: doc.playedAt ? new Date(doc.playedAt) : null,
        imageUrl: doc.imageUrl,
        trackId: doc.trackId,
        searchText: sql`f_unaccent(lower(${searchText(doc)}))`,
      }))
      const excluded = (column: string) => sql.raw(`excluded.${column}`)
      await db
        .insert(searchDocs)
        .values(values)
        .onConflictDoUpdate({
          target: [searchDocs.userId, searchDocs.type, searchDocs.id],
          set: Object.fromEntries(
            [
              ['name', 'name'],
              ['artists', 'artists'],
              ['album', 'album'],
              ['playlists', 'playlists'],
              ['contexts', 'contexts'],
              ['year', 'year'],
              ['playCount', 'play_count'],
              ['rating', 'rating'],
              ['lastPlayedAt', 'last_played_at'],
              ['playedAt', 'played_at'],
              ['imageUrl', 'image_url'],
              ['trackId', 'track_id'],
              ['searchText', 'search_text'],
            ].map(([key, column]) => [key, excluded(column!)]),
          ),
        })
    },

    async remove(keys) {
      if (!keys.length) return
      const tuples = sql.join(
        keys.map((key: DocKey) => sql`(${key.userId}, ${key.type}, ${key.id})`),
        sql`, `,
      )
      await db.execute(sql`delete from search_docs where (user_id, type, id) in (${tuples})`)
    },

    async search(userId, query, options) {
      return searchPostgres(db, userId, query, options)
    },
  }
}

async function searchPostgres(db: Db, userId: string, query: SearchQuery, options: SearchOptions): Promise<SearchResult> {
  const words = queryWords(query.text)
  const phrases = query.phrases.map(foldText)
  if (!words.length && !query.filters.length) return { total: 0, groups: [], suggestion: null }

  // Types: those asked for, narrowed by type: filters.
  const typeFilters = query.filters.filter((filter) => filter.field === 'type')
  const wanted = typeFilters.filter((filter) => !filter.negate).map((filter) => filter.value as EntityType)
  const unwanted = new Set(typeFilters.filter((filter) => filter.negate).map((filter) => filter.value))
  const types = (options.types ?? ['track', 'artist', 'album', 'playlist', 'play'])
    .filter((type) => !wanted.length || wanted.includes(type))
    .filter((type) => !unwanted.has(type))
  if (!types.length) return { total: 0, groups: [], suggestion: null }

  const conditions: SQL[] = [
    sql`d.user_id = ${userId}`,
    sql`d.type in (${sql.join(
      types.map((type) => sql`${type}`),
      sql`, `,
    )})`,
  ]
  for (const word of words) {
    // Starts a word, or (for longer words) is close to one.
    const starts = sql`d.search_text ~ ${`(^|[^[:alnum:]])${word}`}`
    conditions.push(word.length >= 4 ? sql`(${starts} or ${word} <% d.search_text)` : starts)
  }
  for (const phrase of phrases) conditions.push(sql`d.search_text like ${`%${phrase}%`}`)
  for (const filter of query.filters) {
    if (filter.field === 'type') continue
    const condition = sql`coalesce((${filterCondition(filter)}), false)`
    conditions.push(filter.negate ? sql`not ${condition}` : condition)
  }

  const text = words.join(' ')
  const name = folded(sql`d.name`)
  const score = words.length
    ? sql`(
        ${sql.join(
          words.map((word) => sql`word_similarity(${word}, d.search_text)`),
          sql` + `,
        )}
        + case when ${name} = ${text} then 2 when ${name} like ${`${text}%`} then 1 else 0 end
        + ln(1 + d.play_count) * 0.2 + coalesce(d.rating, 0) * 0.1
      )`
    : sql`(ln(1 + d.play_count) + coalesce(d.rating, 0) * 0.5)`

  const matched = sql`matched as (
    select d.*, ${score} as score from search_docs d where ${sql.join(conditions, sql` and `)}
  )`
  const offset = options.offset ?? 0
  type HitRow = {
    type: EntityType
    id: string
    name: string
    artists: string[]
    album: string | null
    playlists: string[]
    contexts: string[]
    year: number | null
    play_count: number
    rating: number | null
    last_played_at: Date | string | null
    played_at: Date | string | null
    image_url: string | null
    track_id: string | null
    score: number
    type_total: number | string
  }
  const hitRows = await rows<HitRow>(
    db,
    sql`with ${matched}, ranked as (
      select *, row_number() over (
          partition by type order by score desc, coalesce(played_at, last_played_at) desc nulls last, name, id
        ) as rn,
        count(*) over (partition by type) as type_total
      from matched
    )
    select * from ranked where rn > ${offset} and rn <= ${offset + options.limit} order by type, rn`,
  )

  const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString())
  const groups = new Map<EntityType, { type: EntityType; total: number; hits: SearchHit[] }>()
  const highlightWords = [...words, ...phrases.flatMap(queryWords)]
  for (const row of hitRows) {
    const group = groups.get(row.type) ?? { type: row.type, total: Number(row.type_total), hits: [] }
    group.hits.push({
      type: row.type,
      id: row.id,
      name: row.name,
      artists: row.artists,
      album: row.album,
      playlists: row.playlists,
      contexts: row.contexts,
      year: row.year,
      playCount: row.play_count,
      rating: row.rating,
      lastPlayedAt: iso(row.last_played_at),
      playedAt: iso(row.played_at),
      imageUrl: row.image_url,
      trackId: row.track_id,
      score: Number(row.score),
      highlights: {
        name: highlightRanges(row.name, highlightWords),
        artists: row.artists.map((artist) => highlightRanges(artist, highlightWords)),
      },
    })
    groups.set(row.type, group)
  }
  // Groups in the order types were asked for.
  const ordered = types.flatMap((type) => (groups.has(type) ? [groups.get(type)!] : []))
  // Counts per type come from the window, so a group past its last page still reports its total.
  let total = ordered.reduce((sum, group) => sum + group.total, 0)
  if (offset > 0 || options.facets) {
    total = Number(
      (await rows<{ n: number }>(db, sql`with ${matched} select count(*)::int as n from matched`))[0]?.n ?? 0,
    )
  }

  const result: SearchResult = { total, groups: ordered, suggestion: null }
  if (options.facets) result.facets = await facets(db, matched, types)
  if (total === 0 && words.length) result.suggestion = await suggest(db, userId, text)
  return result
}

/**
 * Counts to narrow by. Types over everything that matched; the rest over the tracks that matched
 * (or the one type being searched), so a play and its track don't count twice.
 */
async function facets(db: Db, matched: SQL, types: EntityType[]): Promise<SearchFacets> {
  const focus = types.length === 1 ? types[0]! : 'track'
  const count = async <V extends string | number>(select: SQL): Promise<FacetBucket<V>[]> =>
    (await rows<{ value: V; count: number | string }>(db, sql`with ${matched} ${select}`)).map((row) => ({
      value: row.value,
      count: Number(row.count),
    }))
  const [typeBuckets, decades, ratings, artists, contexts] = await Promise.all([
    count<EntityType>(sql`select type as value, count(*) as count from matched group by type order by count desc`),
    count<number>(sql`select (year / 10) * 10 as value, count(*) as count from matched
      where type = ${focus} and year is not null group by 1 order by 1`),
    count<number>(sql`select rating as value, count(*) as count from matched
      where type = ${focus} and rating is not null group by 1 order by 1 desc`),
    count<string>(sql`select a as value, count(*) as count from matched, unnest(artists) as a
      where type = ${focus} group by a order by count desc, a limit ${FACET_SIZE}`),
    count<string>(sql`select c as value, count(*) as count from matched, unnest(contexts) as c
      where type = ${focus} group by c order by count desc, c limit ${FACET_SIZE}`),
  ])
  return { types: typeBuckets, decades, ratings, artists, contexts }
}

/** The name in the library closest to what was typed, for "did you mean". */
async function suggest(db: Db, userId: string, text: string): Promise<string | null> {
  const [best] = await rows<{ name: string }>(
    db,
    sql`select name from search_docs
      where user_id = ${userId} and type <> 'play' and ${text} <% search_text
      order by word_similarity(${text}, search_text) desc, play_count desc limit 1`,
  )
  if (best) return best.name
  // Too far off for the index's threshold: the most similar name at all, if it's similar enough.
  const [near] = await rows<{ name: string }>(
    db,
    sql`select name from search_docs
      where user_id = ${userId} and type <> 'play' and word_similarity(${text}, search_text) > 0.3
      order by word_similarity(${text}, search_text) desc, play_count desc limit 1`,
  )
  return near?.name ?? null
}
