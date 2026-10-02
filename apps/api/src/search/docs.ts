import type { EntityType } from '@replay-crate/core'
import { schema, type Db } from '@replay-crate/db'
import { sql, type SQL } from 'drizzle-orm'
import type { DocKey, SearchDoc } from './types.ts'

// Search documents, built from SQL. The indexer hands over what changed (outbox rows); `expand`
// works out every document that change touches, and `buildDocs` builds them as they are now.
// A document that no longer exists (a track that left the library) comes back as a removal.

/** Outbox kinds (see migration 0010_search_triggers). */
export type OutboxKind =
  | EntityType
  | 'context'
  | 'track-name'
  | 'artist-name'
  | 'album-name'
  | 'show-name'

export type Change = { userId: string | null; kind: string; ref: string }

/** Document ids to rebuild for one user, by type. */
export type Keys = Record<EntityType, Set<string>>

export const emptyKeys = (): Keys => ({
  track: new Set(),
  artist: new Set(),
  album: new Set(),
  playlist: new Set(),
  play: new Set(),
  show: new Set(),
  episode: new Set(),
})

/** `(a, b, c)` for an `in` list. Callers skip empty lists. */
const list = (values: Iterable<string>) =>
  sql`(${sql.join(
    [...values].map((value) => sql`${value}`),
    sql`, `,
  )})`

async function rows<T>(db: Db, query: SQL): Promise<T[]> {
  // `execute` is driver-specific; every driver we use (node-postgres, Neon HTTP, PGlite) returns `rows`.
  return ((await db.execute(query)) as unknown as { rows: T[] }).rows
}

/**
 * Every document the changes touch, per user. A change with no user (a renamed track) applies
 * to everyone: dev-mode Spotify apps have five users at most, and a library that just lost the
 * thing still needs its document removed.
 */
export async function expand(db: Db, changes: Change[]): Promise<Map<string, Keys>> {
  const byUser = new Map<string, Keys>()
  const everyone = changes.some((change) => change.userId === null)
    ? (await db.select({ id: schema.users.id }).from(schema.users)).map((user) => user.id)
    : []

  // First, what each change names directly, plus what to look up.
  type Pending = Keys & { tracksOfPlaylists: Set<string>; tracksOf: Set<string>; playsOfTracks: Set<string>; contexts: Set<string> }
  const pending = new Map<string, Pending>()
  const get = (userId: string) => {
    let keys = pending.get(userId)
    if (!keys) {
      keys = { ...emptyKeys(), tracksOfPlaylists: new Set(), tracksOf: new Set(), playsOfTracks: new Set(), contexts: new Set() }
      pending.set(userId, keys)
    }
    return keys
  }
  const tracksOfArtists = new Set<string>()
  const tracksOfAlbums = new Set<string>()
  const episodesOfShows = new Set<string>()
  for (const change of changes) {
    for (const userId of change.userId === null ? everyone : [change.userId]) {
      const keys = get(userId)
      switch (change.kind as OutboxKind) {
        case 'track':
          keys.track.add(change.ref)
          break
        case 'track-name':
          keys.track.add(change.ref)
          keys.playsOfTracks.add(change.ref)
          break
        case 'artist':
          keys.artist.add(change.ref)
          break
        case 'artist-name':
          keys.artist.add(change.ref)
          tracksOfArtists.add(change.ref)
          break
        case 'album':
          keys.album.add(change.ref)
          break
        case 'album-name':
          keys.album.add(change.ref)
          tracksOfAlbums.add(change.ref)
          break
        case 'playlist':
          keys.playlist.add(change.ref)
          keys.tracksOfPlaylists.add(change.ref)
          break
        case 'play':
          keys.play.add(change.ref)
          break
        case 'context':
          keys.contexts.add(change.ref)
          break
        case 'show':
          keys.show.add(change.ref)
          break
        case 'show-name':
          keys.show.add(change.ref)
          episodesOfShows.add(change.ref)
          break
        case 'episode':
          keys.episode.add(change.ref)
          break
      }
    }
  }

  // Catalog lookups, the same for everyone.
  const renamedTracks = new Set<string>()
  if (tracksOfArtists.size) {
    for (const row of await rows<{ track_id: string }>(
      db,
      sql`select distinct track_id from track_artists where artist_id in ${list(tracksOfArtists)}`,
    )) {
      renamedTracks.add(row.track_id)
    }
  }
  if (tracksOfAlbums.size) {
    for (const row of await rows<{ id: string }>(db, sql`select id from tracks where album_id in ${list(tracksOfAlbums)}`)) {
      renamedTracks.add(row.id)
    }
  }

  // A show's name is in its episodes' documents.
  const renamedEpisodes = new Set<string>()
  if (episodesOfShows.size) {
    for (const row of await rows<{ id: string }>(db, sql`select id from episodes where show_id in ${list(episodesOfShows)}`)) {
      renamedEpisodes.add(row.id)
    }
  }

  for (const [userId, keys] of pending) {
    for (const id of renamedEpisodes) keys.episode.add(id)
    // A playlist's name is in its episodes' documents too.
    if (keys.tracksOfPlaylists.size) {
      for (const row of await rows<{ episode_id: string }>(
        db,
        sql`select distinct episode_id from playlist_episodes where playlist_id in ${list(keys.tracksOfPlaylists)}`,
      )) {
        keys.episode.add(row.episode_id)
      }
    }
    // An episode's listens count towards its show.
    if (keys.episode.size) {
      for (const row of await rows<{ show_id: string }>(db, sql`select distinct show_id from episodes where id in ${list(keys.episode)}`)) {
        keys.show.add(row.show_id)
      }
    }
    for (const id of renamedTracks) {
      keys.track.add(id)
      keys.playsOfTracks.add(id)
    }
    if (keys.tracksOfPlaylists.size) {
      for (const row of await rows<{ track_id: string }>(
        db,
        // A copy of a recording counts as its canonical track (whose playlists this changes).
        sql`select distinct coalesce(t.recording_of, t.id) as track_id from playlist_items pi join tracks t on t.id = pi.track_id
          where pi.playlist_id in ${list(keys.tracksOfPlaylists)}`,
      )) {
        keys.track.add(row.track_id)
      }
    }
    if (keys.contexts.size) {
      for (const row of await rows<{ id: string; track_id: string }>(
        db,
        sql`select id::text as id, track_id from plays where user_id = ${userId} and context_uri in ${list(keys.contexts)}`,
      )) {
        keys.play.add(row.id)
        keys.track.add(row.track_id)
      }
    }
    if (keys.playsOfTracks.size) {
      for (const row of await rows<{ id: string }>(
        db,
        sql`select id::text as id from plays where user_id = ${userId} and track_id in ${list(keys.playsOfTracks)}`,
      )) {
        keys.play.add(row.id)
      }
    }
    // A play changes its playlist's "played from here" count.
    if (keys.play.size) {
      for (const row of await rows<{ playlist_id: string }>(
        db,
        sql`select distinct substring(context_uri from 'spotify:playlist:(.*)') as playlist_id from plays
            where user_id = ${userId} and context_type = 'playlist' and id::text in ${list(keys.play)}`,
      )) {
        if (row.playlist_id) keys.playlist.add(row.playlist_id)
      }
    }
    // A track's plays and library membership count towards its album and artists.
    if (keys.track.size) {
      for (const row of await rows<{ album_id: string; artist_id: string | null }>(
        db,
        sql`select t.album_id, ta.artist_id from tracks t left join track_artists ta on ta.track_id = t.id
            where t.id in ${list(keys.track)}`,
      )) {
        keys.album.add(row.album_id)
        if (row.artist_id) keys.artist.add(row.artist_id)
      }
    }
    byUser.set(userId, {
      track: keys.track,
      artist: keys.artist,
      album: keys.album,
      playlist: keys.playlist,
      play: keys.play,
      show: keys.show,
      episode: keys.episode,
    })
  }
  return byUser
}

/**
 * The user's library: tracks they've played, rated, or have on a playlist. Each recording once,
 * as its canonical track (plays and ratings are already on it; a playlist may hold another copy).
 */
const libraryTracks = (userId: string) => sql`(
  select track_id from plays where user_id = ${userId}
  union select track_id from track_ratings where user_id = ${userId}
  union select coalesce(t.recording_of, t.id) from playlist_items pi
    join user_playlists up on up.playlist_id = pi.playlist_id and up.user_id = ${userId}
    join tracks t on t.id = pi.track_id
)`

/** The user's podcast library: episodes they've listened to, rated, or have on a playlist. */
const libraryEpisodes = (userId: string) => sql`(
  select episode_id from episode_listens where user_id = ${userId}
  union select episode_id from episode_ratings where user_id = ${userId}
  union select pe.episode_id from playlist_episodes pe
    join user_playlists up on up.playlist_id = pe.playlist_id and up.user_id = ${userId}
)`
/** Shows of those episodes, and the shows the user follows. */
const libraryShows = (userId: string) => sql`(
  select e.show_id from episodes e where e.id in ${libraryEpisodes(userId)}
  union select show_id from user_shows where user_id = ${userId}
)`
const listenTimes = (from: SQL) =>
  sql`coalesce((select array_agg(to_char(l.ended_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') order by l.ended_at) ${from}), '{}')`

/** Play times as ISO strings, oldest first, from `plays p` joined as `from` says (and `where`). */
const iso8601 = sql.raw(`to_char(p.played_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`)
const playTimes = (from: SQL) => sql`coalesce((select array_agg(${iso8601} order by p.played_at) ${from}), '{}')`

const year = (column: SQL) => sql`case when ${column} ~ '^\\d{4}' then substring(${column} from 1 for 4)::int end`
const artistNames = (trackId: SQL) =>
  sql`coalesce((select array_agg(ar.name order by ta.position) from track_artists ta
      join artists ar on ar.id = ta.artist_id where ta.track_id = ${trackId}), '{}')`
/**
 * Genres of the artists `credits` lists (rows of `artist_id`, `position`), each once: the first
 * artist's first, strongest first within each.
 */
const genreNames = (credits: SQL) =>
  sql`(select coalesce(array_agg(name order by rank), '{}') from (
      select g.name, min(c.position * 1000 - ag.weight) as rank from ${credits} c
      join artist_genres ag on ag.artist_id = c.artist_id join genres g on g.id = ag.genre_id
      group by g.name) ranked)`
const trackGenres = (trackId: SQL) =>
  genreNames(sql`(select artist_id, position from track_artists where track_id = ${trackId})`)

type Row = {
  id: string
  name: string
  artists: string[] | null
  album: string | null
  playlists: string[] | null
  contexts: string[] | null
  genres: string[]
  year: number | null
  play_count: number | string
  rating: number | null
  last_played_at: Date | string | null
  played_at: Date | string | null
  play_times: string[]
  image_url: string | null
  track_id: string | null
}

const iso = (value: Date | string | null) => (value === null ? null : new Date(value).toISOString())

function toDoc(userId: string, type: EntityType, row: Row): SearchDoc {
  return {
    userId,
    type,
    id: row.id,
    name: row.name,
    artists: row.artists ?? [],
    album: row.album,
    playlists: row.playlists ?? [],
    contexts: row.contexts ?? [],
    genres: row.genres,
    year: row.year,
    playCount: Number(row.play_count),
    rating: row.rating,
    lastPlayedAt: iso(row.last_played_at),
    playedAt: iso(row.played_at),
    playTimes: row.play_times,
    imageUrl: row.image_url,
    trackId: row.track_id,
  }
}

const queries: Record<EntityType, (userId: string, ids: Set<string>) => SQL> = {
  track: (userId, ids) => sql`
    select t.id, t.name, al.name as album, ${year(sql`al.release_date`)} as year, al.thumb_url as image_url,
      ${artistNames(sql`t.id`)} as artists, ${trackGenres(sql`t.id`)} as genres,
      (select count(*) from plays p where p.user_id = ${userId} and p.track_id = t.id) as play_count,
      (select max(p.played_at) from plays p where p.user_id = ${userId} and p.track_id = t.id) as last_played_at,
      null as played_at,
      ${playTimes(sql`from plays p where p.user_id = ${userId} and p.track_id = t.id`)} as play_times,
      (select r.rating from track_ratings r where r.user_id = ${userId} and r.track_id = t.id) as rating,
      (select array_agg(distinct pl.name) from playlist_items pi
        join user_playlists up on up.playlist_id = pi.playlist_id and up.user_id = ${userId}
        join playlists pl on pl.id = pi.playlist_id
        where pi.track_id in (select c.id from tracks c where c.id = t.id or c.recording_of = t.id)) as playlists,
      (select array_agg(distinct c.name) from plays p join contexts c on c.uri = p.context_uri
        where p.user_id = ${userId} and p.track_id = t.id and c.name is not null) as contexts,
      null as track_id
    from tracks t join albums al on al.id = t.album_id
    where t.id in ${list(ids)} and t.id in ${libraryTracks(userId)}`,

  artist: (userId, ids) => sql`
    select ar.id, ar.name, null as album, null::int as year,
      -- Artists rarely have their own image yet; one of their albums' art stands in.
      coalesce(ar.image_url, (select al.thumb_url from track_artists ta join tracks t on t.id = ta.track_id
        join albums al on al.id = t.album_id where ta.artist_id = ar.id and al.thumb_url is not null limit 1)) as image_url,
      '{}'::text[] as artists,
      ${genreNames(sql`(select ar.id as artist_id, 0 as position)`)} as genres,
      (select count(*) from plays p join track_artists ta on ta.track_id = p.track_id
        where p.user_id = ${userId} and ta.artist_id = ar.id) as play_count,
      (select max(p.played_at) from plays p join track_artists ta on ta.track_id = p.track_id
        where p.user_id = ${userId} and ta.artist_id = ar.id) as last_played_at,
      ${playTimes(sql`from plays p join track_artists ta on ta.track_id = p.track_id where p.user_id = ${userId} and ta.artist_id = ar.id`)}
        as play_times,
      null as played_at, null::smallint as rating, null::text[] as playlists, null::text[] as contexts, null as track_id
    from artists ar
    where ar.id in ${list(ids)}
      and exists (select 1 from track_artists ta where ta.artist_id = ar.id and ta.track_id in ${libraryTracks(userId)})`,

  album: (userId, ids) => sql`
    select al.id, al.name, null as album, ${year(sql`al.release_date`)} as year, al.thumb_url as image_url,
      coalesce((select array_agg(ar.name order by aa.position) from album_artists aa
        join artists ar on ar.id = aa.artist_id where aa.album_id = al.id), '{}') as artists,
      ${genreNames(sql`(select artist_id, position from album_artists where album_id = al.id)`)} as genres,
      (select count(*) from plays p join tracks t on t.id = p.track_id
        where p.user_id = ${userId} and t.album_id = al.id) as play_count,
      (select max(p.played_at) from plays p join tracks t on t.id = p.track_id
        where p.user_id = ${userId} and t.album_id = al.id) as last_played_at,
      ${playTimes(sql`from plays p join tracks t on t.id = p.track_id where p.user_id = ${userId} and t.album_id = al.id`)} as play_times,
      null as played_at, null::smallint as rating, null::text[] as playlists, null::text[] as contexts, null as track_id
    from albums al
    where al.id in ${list(ids)}
      and exists (select 1 from tracks t where t.album_id = al.id and t.id in ${libraryTracks(userId)})`,

  playlist: (userId, ids) => sql`
    select pl.id, pl.name, null as album, null::int as year, pl.thumb_url as image_url,
      array_remove(array[pl.owner_name], null) as artists, '{}'::text[] as genres,
      (select count(*) from plays p where p.user_id = ${userId} and p.context_uri = 'spotify:playlist:' || pl.id) as play_count,
      (select max(p.played_at) from plays p where p.user_id = ${userId} and p.context_uri = 'spotify:playlist:' || pl.id)
        as last_played_at,
      ${playTimes(sql`from plays p where p.user_id = ${userId} and p.context_uri = 'spotify:playlist:' || pl.id`)} as play_times,
      null as played_at, null::smallint as rating, null::text[] as playlists, null::text[] as contexts, null as track_id
    from playlists pl join user_playlists up on up.playlist_id = pl.id and up.user_id = ${userId}
    where pl.id in ${list(ids)}`,

  play: (userId, ids) => sql`
    select p.id::text as id, t.name, al.name as album, ${year(sql`al.release_date`)} as year, al.thumb_url as image_url,
      ${artistNames(sql`t.id`)} as artists, ${trackGenres(sql`t.id`)} as genres,
      0 as play_count, p.played_at as last_played_at, p.played_at, array[${iso8601}] as play_times,
      (select r.rating from track_ratings r where r.user_id = ${userId} and r.track_id = t.id) as rating,
      null::text[] as playlists,
      array_remove(array[c.name], null) as contexts,
      t.id as track_id
    from plays p join tracks t on t.id = p.track_id join albums al on al.id = t.album_id
    left join contexts c on c.uri = p.context_uri
    where p.user_id = ${userId} and p.id::text in ${list(ids)}`,

  // A podcast's documents: listens count as plays, and an episode's show stands where a track's artists do.
  show: (userId, ids) => sql`
    select s.id, s.name, null as album, null::int as year, s.thumb_url as image_url,
      '{}'::text[] as artists, '{}'::text[] as genres,
      (select count(*) from episode_listens l join episodes e on e.id = l.episode_id
        where l.user_id = ${userId} and e.show_id = s.id) as play_count,
      (select max(l.ended_at) from episode_listens l join episodes e on e.id = l.episode_id
        where l.user_id = ${userId} and e.show_id = s.id) as last_played_at,
      ${listenTimes(sql`from episode_listens l join episodes e on e.id = l.episode_id where l.user_id = ${userId} and e.show_id = s.id`)}
        as play_times,
      null as played_at, null::smallint as rating, null::text[] as playlists, null::text[] as contexts, null as track_id
    from shows s
    where s.id in ${list(ids)} and s.id in ${libraryShows(userId)}`,

  episode: (userId, ids) => sql`
    select e.id, e.name, null as album, ${year(sql`e.release_date`)} as year, coalesce(e.thumb_url, s.thumb_url) as image_url,
      array[s.name] as artists, '{}'::text[] as genres,
      (select count(*) from episode_listens l where l.user_id = ${userId} and l.episode_id = e.id) as play_count,
      (select max(l.ended_at) from episode_listens l where l.user_id = ${userId} and l.episode_id = e.id) as last_played_at,
      ${listenTimes(sql`from episode_listens l where l.user_id = ${userId} and l.episode_id = e.id`)} as play_times,
      (select r.rating from episode_ratings r where r.user_id = ${userId} and r.episode_id = e.id) as rating,
      (select array_agg(distinct pl.name) from playlist_episodes pe
        join user_playlists up on up.playlist_id = pe.playlist_id and up.user_id = ${userId}
        join playlists pl on pl.id = pe.playlist_id
        where pe.episode_id = e.id) as playlists,
      null::text[] as contexts, null as played_at, null as track_id
    from episodes e join shows s on s.id = e.show_id
    where e.id in ${list(ids)} and e.id in ${libraryEpisodes(userId)}`,
}

/** The documents for `keys` as they are now, and the keys that no longer have one. */
export async function buildDocs(db: Db, userId: string, keys: Keys): Promise<{ docs: SearchDoc[]; gone: DocKey[] }> {
  const docs: SearchDoc[] = []
  const gone: DocKey[] = []
  for (const type of Object.keys(keys) as EntityType[]) {
    const ids = keys[type]
    if (!ids.size) continue
    const found = new Set<string>()
    for (const row of await rows<Row>(db, queries[type](userId, ids))) {
      found.add(row.id)
      docs.push(toDoc(userId, type, row))
    }
    for (const id of ids) if (!found.has(id)) gone.push({ userId, type, id })
  }
  return { docs, gone }
}

/** Every document id in a user's library, for a full rebuild. */
export async function allKeys(db: Db, userId: string): Promise<Keys> {
  const keys = emptyKeys()
  const collect = async (type: EntityType, query: SQL) => {
    for (const row of await rows<{ id: string }>(db, query)) keys[type].add(row.id)
  }
  await collect('track', sql`select track_id as id from ${libraryTracks(userId)} as library`)
  await collect('artist', sql`select distinct ta.artist_id as id from track_artists ta where ta.track_id in ${libraryTracks(userId)}`)
  await collect('album', sql`select distinct t.album_id as id from tracks t where t.id in ${libraryTracks(userId)}`)
  await collect('playlist', sql`select playlist_id as id from user_playlists where user_id = ${userId}`)
  await collect('play', sql`select id::text as id from plays where user_id = ${userId}`)
  await collect('show', sql`select show_id as id from ${libraryShows(userId)} as shows`)
  await collect('episode', sql`select episode_id as id from ${libraryEpisodes(userId)} as episodes`)
  return keys
}
