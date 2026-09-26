import { Client, errors, type estypes } from '@elastic/elasticsearch'
import type { Db } from '@replay-crate/db'
import { sql } from 'drizzle-orm'

// Listening and search analytics, for the Kibana dashboards (infra/kibana). Elasticsearch only:
// two indices of events beside the search index.
//
//   <prefix>-plays           every play, with its minutes and local hour and weekday
//   <prefix>-search-queries  settled searches: what was asked, what came back, what was picked
//
// Plays arrive through the search indexer, so they follow the same outbox (and survive the
// same failures); searches are recorded by POST /search/events, fire and forget.

/** One play, flattened for charts. */
export type PlayEvent = {
  '@timestamp': string
  userId: string
  playId: string
  trackId: string
  track: string
  artists: string[]
  /** The first-credited artist, for "top artists". */
  artist: string
  album: string
  context: string | null
  contextType: string | null
  source: 'poll' | 'import'
  /** Listened for, when known (imports), else the track's length. */
  minutes: number
  /** 0–23, in the server's time zone (the user's, for a personal app). */
  hour: number
  /** "1 Mon" … "7 Sun": sorts in week order. */
  weekday: string
}

export type SearchEvent = {
  '@timestamp': string
  userId: string
  q: string
  text: string
  /** Filters as typed: `rating:>=4`. */
  filters: string[]
  /** Which filters were used: `rating`, `artist`. */
  filterFields: string[]
  total: number
  zeroResults: boolean
  source: 'palette' | 'page'
  pickedType: string | null
  pickedId: string | null
  /** 1 is the first result shown. */
  pickedRank: number | null
  engine: string
}

export interface Analytics {
  recordPlays(events: PlayEvent[], removed: { userId: string; playId: string }[]): Promise<void>
  recordSearch(event: SearchEvent): Promise<void>
}

const WEEKDAYS = ['7 Sun', '1 Mon', '2 Tue', '3 Wed', '4 Thu', '5 Fri', '6 Sat']

/** Play events for `ids` (play row ids) as they are now; missing ids were deleted. */
export async function playEvents(db: Db, userId: string, ids: string[]): Promise<PlayEvent[]> {
  if (!ids.length) return []
  type Row = {
    id: string
    played_at: Date | string
    track_id: string
    track: string
    artists: string[] | null
    album: string
    context: string | null
    context_type: string | null
    source: 'poll' | 'import'
    ms_played: number | null
    duration_ms: number
  }
  const rows = (
    (await db.execute(sql`
      select p.id::text as id, p.played_at, t.id as track_id, t.name as track, al.name as album,
        (select array_agg(ar.name order by ta.position) from track_artists ta join artists ar on ar.id = ta.artist_id
          where ta.track_id = t.id) as artists,
        c.name as context, p.context_type, p.source, p.ms_played, t.duration_ms
      from plays p join tracks t on t.id = p.track_id join albums al on al.id = t.album_id
      left join contexts c on c.uri = p.context_uri
      where p.user_id = ${userId} and p.id::text in (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `,
      )})`)) as unknown as { rows: Row[] }
  ).rows
  return rows.map((row) => {
    const playedAt = new Date(row.played_at)
    const artists = row.artists ?? []
    return {
      '@timestamp': playedAt.toISOString(),
      userId,
      playId: row.id,
      trackId: row.track_id,
      track: row.track,
      artists,
      artist: artists[0] ?? 'Unknown',
      album: row.album,
      context: row.context,
      contextType: row.context_type,
      source: row.source,
      minutes: Math.round(((row.ms_played ?? row.duration_ms) / 60_000) * 100) / 100,
      hour: playedAt.getHours(),
      weekday: WEEKDAYS[playedAt.getDay()]!,
    }
  })
}

const keyword = { type: 'keyword' } as const

const PLAYS_MAPPINGS: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: {
    '@timestamp': { type: 'date' },
    userId: keyword,
    playId: keyword,
    trackId: keyword,
    track: keyword,
    artists: keyword,
    artist: keyword,
    album: keyword,
    context: keyword,
    contextType: keyword,
    source: keyword,
    minutes: { type: 'float' },
    hour: { type: 'byte' },
    weekday: keyword,
  },
}

const SEARCHES_MAPPINGS: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: {
    '@timestamp': { type: 'date' },
    userId: keyword,
    q: { type: 'keyword', ignore_above: 256 },
    text: { type: 'keyword', ignore_above: 256 },
    filters: keyword,
    filterFields: keyword,
    total: { type: 'integer' },
    zeroResults: { type: 'boolean' },
    source: keyword,
    pickedType: keyword,
    pickedId: keyword,
    pickedRank: { type: 'short' },
    engine: keyword,
  },
}

export type ElasticAnalytics = Analytics & {
  playsIndex: string
  searchesIndex: string
  /** Creates the indices if missing; says whether the plays index is new (and needs a backfill). */
  ensureIndices(): Promise<{ playsCreated: boolean }>
  destroy(): Promise<void>
}

export function createElasticAnalytics({
  node,
  prefix = 'rc',
  refresh = false,
}: {
  node: string
  prefix?: string
  refresh?: boolean
}): ElasticAnalytics {
  const client = new Client({ node })
  const playsIndex = `${prefix}-plays`
  const searchesIndex = `${prefix}-search-queries`

  async function create(index: string, mappings: estypes.MappingTypeMapping): Promise<boolean> {
    try {
      await client.indices.create({ index, settings: { number_of_shards: 1, number_of_replicas: 0 }, mappings })
      return true
    } catch (error) {
      if (error instanceof errors.ResponseError && error.body?.error?.type === 'resource_already_exists_exception') return false
      throw error
    }
  }

  return {
    playsIndex,
    searchesIndex,

    async ensureIndices() {
      const playsCreated = await create(playsIndex, PLAYS_MAPPINGS)
      await create(searchesIndex, SEARCHES_MAPPINGS)
      return { playsCreated }
    },

    async destroy() {
      await client.indices.delete({ index: [playsIndex, searchesIndex], ignore_unavailable: true })
    },

    async recordPlays(events, removed) {
      const operations = [
        ...events.flatMap((event) => [{ index: { _index: playsIndex, _id: `${event.userId}:${event.playId}` } }, event]),
        ...removed.map((play) => ({ delete: { _index: playsIndex, _id: `${play.userId}:${play.playId}` } })),
      ]
      if (!operations.length) return
      const response = await client.bulk({ operations, refresh: refresh ? 'wait_for' : false })
      const failed = response.items.map((item) => Object.values(item)[0]!).find((result) => result.error && result.status !== 404)
      if (failed) throw new Error(`Elasticsearch rejected play events: ${JSON.stringify(failed.error)}`)
    },

    async recordSearch(event) {
      await client.index({ index: searchesIndex, document: event, refresh: refresh ? 'wait_for' : false })
    },
  }
}
