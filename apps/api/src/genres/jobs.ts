import { genreKey, pickGenres, type PickedGenre, type WeightedTag } from '@replay-crate/core'
import { schema, type Db, type GenreSource } from '@replay-crate/db'
import { and, count, eq, inArray, sql } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import { enqueue, type JobKind } from '../jobs/enqueue.ts'
import type { Handler } from '../jobs/handler.ts'

const { artists, genres, jobs } = schema

// Spotify no longer reports genres, so each artist goes through a chain of jobs, one outside
// call each (so the queue can pace and budget them):
//   genres-lastfm     Last.fm's tags for the artist's name. Genres found: done.
//   genres-mb-id      else MusicBrainz's artist linked to the Spotify artist (the surest match)
//   genres-mb-search  else a MusicBrainz search for exactly that name, if only one artist has it
//   genres-mb         that artist's genres as MusicBrainz editors voted them
// Without a Last.fm key the chain starts at genres-mb-id. Whatever the outcome, the artist's
// `genres_checked_at` is set, so it isn't looked up again until it's stale.

export const GENRE_KINDS = ['genres-lastfm', 'genres-mb-id', 'genres-mb-search', 'genres-mb'] as const satisfies JobKind[]

/** Genres are looked up again after this long: tags drift as listeners add them. */
export const GENRES_STALE_MS = 180 * 24 * 60 * 60_000

const known = new WeakMap<Db, Promise<Map<string, number>>>()

/** The canonical genres by match key; the list only changes with a migration, so it's read once. */
function knownGenres(db: Db): Promise<Map<string, number>> {
  let genresByKey = known.get(db)
  if (!genresByKey) {
    genresByKey = db
      .select({ id: genres.id, key: genres.key })
      .from(genres)
      .then((rows) => new Map(rows.map((row) => [row.key, row.id])))
    genresByKey.catch(() => known.delete(db))
    known.set(db, genresByKey)
  }
  return genresByKey
}

async function artistById(db: Db, id: string) {
  const [artist] = await db.select({ name: artists.name, mbid: artists.mbid }).from(artists).where(eq(artists.id, id))
  return artist
}

/**
 * Stores what a lookup found and marks the artist checked, in one statement (Neon's HTTP driver
 * has no transactions). With genres, they replace the artist's old ones; without, old ones stay
 * (a source coming up empty isn't evidence they were wrong).
 */
async function saveGenres(deps: AppDeps, artistId: string, picked: PickedGenre[], source: GenreSource): Promise<void> {
  const now = (deps.now?.() ?? new Date()).toISOString()
  if (!picked.length) {
    await deps.db.execute(sql`update artists set genres_checked_at = ${now}::timestamptz where id = ${artistId}`)
    return
  }
  await deps.db.execute(sql`
    with picked as (
      select * from jsonb_to_recordset(${JSON.stringify(picked)}::jsonb) as p("genreId" int, weight int)
    ),
    removed as (
      delete from artist_genres where artist_id = ${artistId} and genre_id not in (select "genreId" from picked)
    ),
    saved as (
      insert into artist_genres (artist_id, genre_id, weight, source)
      select ${artistId}, "genreId", weight, ${source} from picked
      on conflict (artist_id, genre_id) do update set weight = excluded.weight, source = excluded.source
    )
    update artists set genres_checked_at = ${now}::timestamptz where id = ${artistId}`)
}

async function saveTags(deps: AppDeps, artistId: string, tags: WeightedTag[], source: GenreSource): Promise<boolean> {
  const picked = pickGenres(tags, await knownGenres(deps.db))
  if (picked.length) await saveGenres(deps, artistId, picked, source)
  return picked.length > 0
}

const next = (deps: AppDeps, kind: JobKind, artistId: string) => enqueue(deps.db, [{ kind, ref: artistId }], deps.now?.())

/** The artist has a MusicBrainz id: keep it, and ask for its genres. */
async function foundMbid(deps: AppDeps, artistId: string, mbid: string): Promise<void> {
  await deps.db.update(artists).set({ mbid }).where(eq(artists.id, artistId))
  await next(deps, 'genres-mb', artistId)
}

/** Nowhere else to look: the artist is checked, with whatever genres it had. */
const giveUp = (deps: AppDeps, artistId: string) => saveGenres(deps, artistId, [], 'musicbrainz')

/** One job per step, keyed by the Spotify artist id. An artist deleted meanwhile ends its chain. */
export const genreHandlers: Record<(typeof GENRE_KINDS)[number], Handler> = {
  'genres-lastfm': {
    api: 'lastfm',
    run: async (deps, id) => {
      const artist = await artistById(deps.db, id)
      if (!artist) return
      // The key was removed since this was queued: straight on to MusicBrainz.
      if (!deps.lastfm) return next(deps, 'genres-mb-id', id)
      const found = await saveTags(deps, id, await deps.lastfm.getArtistTopTags(artist.name), 'lastfm')
      if (!found) await next(deps, 'genres-mb-id', id)
    },
    // Last.fm doesn't know the name.
    gone: (deps, id) => next(deps, 'genres-mb-id', id),
  },
  'genres-mb-id': {
    api: 'musicbrainz',
    run: async (deps, id) => {
      const artist = await artistById(deps.db, id)
      if (!artist || !deps.musicbrainz) return
      // Found on an earlier lookup (the link won't have moved).
      if (artist.mbid) return next(deps, 'genres-mb', id)
      const mbid = await deps.musicbrainz.findArtistBySpotifyId(id)
      await (mbid ? foundMbid(deps, id, mbid) : next(deps, 'genres-mb-search', id))
    },
  },
  'genres-mb-search': {
    api: 'musicbrainz',
    run: async (deps, id) => {
      const artist = await artistById(deps.db, id)
      if (!artist || !deps.musicbrainz) return
      // Only a name match that leaves no doubt: two artists called "Nirvana" means we don't know which.
      const key = genreKey(artist.name)
      const matches = new Set(
        (await deps.musicbrainz.searchArtists(artist.name))
          .filter((candidate) => candidate.score >= 100 && genreKey(candidate.name) === key)
          .map((candidate) => candidate.mbid),
      )
      const [mbid] = matches
      await (matches.size === 1 && mbid ? foundMbid(deps, id, mbid) : giveUp(deps, id))
    },
  },
  'genres-mb': {
    api: 'musicbrainz',
    run: async (deps, id) => {
      const artist = await artistById(deps.db, id)
      if (!artist?.mbid || !deps.musicbrainz) return
      const found = await saveTags(deps, id, await deps.musicbrainz.getArtistGenres(artist.mbid), 'musicbrainz')
      if (!found) await giveUp(deps, id)
    },
    // The MusicBrainz artist was merged away or deleted: forget it, so a refresh looks again.
    gone: async (deps, id) => {
      await deps.db.update(artists).set({ mbid: null }).where(eq(artists.id, id))
      await giveUp(deps, id)
    },
  },
}

/** Genre lookups queued at once; the sweep tops up when fewer than `LOW_WATER` are waiting. */
const SWEEP_BATCH = 50
const LOW_WATER = 20

/**
 * Queues genre lookups for artists that have none yet (or whose are stale), most recently played
 * first, a batch at a time: an artist you played an hour ago jumps ahead of the backlog from an
 * old import. Artists nobody has played (only on playlists) come last. Runs before each round of
 * the genre job runner, so new artists from syncs, imports and playlists are picked up without
 * anything having to ask. Returns how many it queued.
 */
export async function enqueueGenreLookups(deps: AppDeps): Promise<number> {
  const { db } = deps
  if (!deps.musicbrainz && !deps.lastfm) return 0
  const now = deps.now?.() ?? new Date()
  const [waiting] = await db
    .select({ n: count() })
    .from(jobs)
    .where(and(inArray(jobs.kind, [...GENRE_KINDS]), eq(jobs.attempts, 0)))
  if ((waiting?.n ?? 0) >= LOW_WATER) return 0

  const kind: JobKind = deps.lastfm ? 'genres-lastfm' : 'genres-mb-id'
  const staleBefore = new Date(now.getTime() - GENRES_STALE_MS).toISOString()
  const at = now.toISOString()
  const result = await db.execute(sql`
    with due as (
      select a.id from artists a
      where (a.genres_checked_at is null or a.genres_checked_at < ${staleBefore}::timestamptz)
        and not exists (select 1 from jobs j where j.ref = a.id and j.kind in (${sql.join(GENRE_KINDS.map((k) => sql`${k}`), sql`, `)}))
    ),
    last_played as (
      select ta.artist_id, max(p.played_at) as at
      from due join track_artists ta on ta.artist_id = due.id join plays p on p.track_id = ta.track_id
      group by ta.artist_id
    )
    insert into jobs (kind, ref, run_after, created_at)
    select ${kind}, due.id, ${at}::timestamptz, ${at}::timestamptz
    from due left join last_played lp on lp.artist_id = due.id
    order by lp.at desc nulls last, due.id
    limit ${SWEEP_BATCH}
    on conflict do nothing
    returning id`)
  return (result as unknown as { rows: unknown[] }).rows.length
}
