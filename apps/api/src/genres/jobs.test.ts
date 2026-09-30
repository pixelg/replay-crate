import { schema } from '@replay-crate/db'
import { MetadataApiError } from '@replay-crate/metadata'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enqueue } from '../jobs/enqueue.ts'
import { runJobs } from '../jobs/queue.ts'
import { upsertCatalog } from '../sync/catalog.ts'
import { createTestContext, track } from '../testing.ts'
import { enqueueGenreLookups, GENRES_STALE_MS } from './jobs.ts'

const { artistGenres, artists, genres, jobs, plays } = schema
const DAY = 24 * 60 * 60_000

describe('artist genres', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>

  /** Artists in the catalog, as a sync would store them: `[spotifyId, name]`. */
  const addArtists = (...pairs: Array<[string, string]>) =>
    upsertCatalog(ctx.db, pairs.map(([id, name]) => track(`t-${id}`, { artists: [[id, name]] })))
  /** Runs both genre lanes until neither has anything left, with no pacing. */
  async function runGenreJobs() {
    for (let round = 0; round < 10; round++) {
      const lastfm = await runJobs(ctx.deps, { api: 'lastfm', intervalMs: 0 })
      const mb = await runJobs(ctx.deps, { api: 'musicbrainz', intervalMs: 0 })
      if (!lastfm.remaining && !mb.remaining) return
    }
    throw new Error('genre jobs never finished')
  }
  const lookUp = async (id: string) => {
    await enqueue(ctx.db, [{ kind: ctx.deps.lastfm ? 'genres-lastfm' : 'genres-mb-id', ref: id }], ctx.deps.now!())
    await runGenreJobs()
  }
  const genresOf = (id: string) =>
    ctx.db
      .select({ name: genres.name, weight: artistGenres.weight, source: artistGenres.source })
      .from(artistGenres)
      .innerJoin(genres, eq(genres.id, artistGenres.genreId))
      .where(eq(artistGenres.artistId, id))
      .orderBy(asc(artistGenres.weight))
      .then((rows) => rows.toReversed())
  const artist = async (id: string) => (await ctx.db.select().from(artists).where(eq(artists.id, id)))[0]!

  beforeEach(async () => {
    ctx = await createTestContext()
    await ctx.login()
  })
  afterEach(() => ctx.close())

  it('seeds the canonical list from MusicBrainz', async () => {
    const [rock] = await ctx.db.select().from(genres).where(eq(genres.name, 'drum and bass'))
    expect(rock).toMatchObject({ key: 'drumandbass' })
    expect((await ctx.db.select({ id: genres.id }).from(genres)).length).toBeGreaterThan(2_000)
  })

  it("takes an artist's genres from their Last.fm tags", async () => {
    await addArtists(['rh', 'Radiohead'])
    ctx.metadata.tagOnLastfm('Radiohead', { rock: 100, alternative: 54, 'seen live': 40, electronic: 11, britpop: 1 })
    await lookUp('rh')

    expect(await genresOf('rh')).toEqual([
      { name: 'rock', weight: 100, source: 'lastfm' },
      { name: 'alternative rock', weight: 54, source: 'lastfm' },
      { name: 'electronic', weight: 11, source: 'lastfm' },
    ])
    expect((await artist('rh')).genresCheckedAt).toEqual(ctx.deps.now!())
    expect(ctx.musicbrainz.findArtistBySpotifyId).not.toHaveBeenCalled()
  })

  it("falls back to MusicBrainz's artist linked to the Spotify one when Last.fm has no genres", async () => {
    await addArtists(['obscure', 'Obscure Band'])
    ctx.metadata.tagOnLastfm('Obscure Band', { 'seen live': 100, favourites: 50 })
    ctx.metadata.addToMusicBrainz({ mbid: 'mb-1', name: 'Obscure Band', spotifyId: 'obscure', genres: { 'trip hop': 3, 'art rock': 1 } })
    await lookUp('obscure')

    expect(await genresOf('obscure')).toEqual([
      { name: 'trip hop', weight: 100, source: 'musicbrainz' },
      { name: 'art rock', weight: 33, source: 'musicbrainz' },
    ])
    expect((await artist('obscure')).mbid).toBe('mb-1')
    expect(ctx.musicbrainz.searchArtists).not.toHaveBeenCalled()
  })

  it("searches MusicBrainz by name when neither Last.fm nor a link knows the artist", async () => {
    await addArtists(['x', 'Unlinked'])
    ctx.metadata.addToMusicBrainz({ mbid: 'mb-2', name: 'unlinked', genres: { jazz: 2 } })
    await lookUp('x')

    expect(ctx.lastfm.getArtistTopTags).toHaveBeenCalledWith('Unlinked')
    expect(await genresOf('x')).toEqual([{ name: 'jazz', weight: 100, source: 'musicbrainz' }])
  })

  it('gives up on a name two MusicBrainz artists share, and on no match at all', async () => {
    await addArtists(['n', 'Nirvana'], ['none', 'Nobody Knows'])
    ctx.metadata.addToMusicBrainz({ mbid: 'mb-grunge', name: 'Nirvana', genres: { grunge: 9 } })
    ctx.metadata.addToMusicBrainz({ mbid: 'mb-60s', name: 'Nirvana', genres: { 'psychedelic pop': 2 } })
    await lookUp('n')
    await lookUp('none')

    for (const id of ['n', 'none']) {
      expect(await genresOf(id)).toEqual([])
      expect(await artist(id)).toMatchObject({ mbid: null, genresCheckedAt: ctx.deps.now!() })
    }
    expect(await ctx.db.select().from(jobs)).toEqual([])
  })

  it('goes straight to MusicBrainz without a Last.fm key', async () => {
    ctx.deps.lastfm = undefined
    await addArtists(['a', 'Linked'])
    ctx.metadata.addToMusicBrainz({ mbid: 'mb-3', name: 'Linked', spotifyId: 'a', genres: { funk: 1 } })
    expect(await enqueueGenreLookups(ctx.deps)).toBe(1)
    await runGenreJobs()
    expect(await genresOf('a')).toEqual([{ name: 'funk', weight: 100, source: 'musicbrainz' }])
    expect(ctx.lastfm.getArtistTopTags).not.toHaveBeenCalled()
  })

  it('replaces genres on a refresh, and keeps them when a refresh finds none', async () => {
    await addArtists(['rh', 'Radiohead'])
    ctx.metadata.tagOnLastfm('Radiohead', { rock: 100, electronic: 50 })
    await lookUp('rh')
    ctx.metadata.tagOnLastfm('Radiohead', { 'art rock': 100, rock: 80 })
    await lookUp('rh')
    expect(await genresOf('rh')).toEqual([
      { name: 'art rock', weight: 100, source: 'lastfm' },
      { name: 'rock', weight: 80, source: 'lastfm' },
    ])

    ctx.metadata.tagOnLastfm('Radiohead', { 'seen live': 100 })
    ctx.advance(DAY)
    await lookUp('rh')
    expect(await genresOf('rh')).toHaveLength(2)
    expect((await artist('rh')).genresCheckedAt).toEqual(ctx.deps.now!())
  })

  it('forgets a MusicBrainz id that no longer exists', async () => {
    await addArtists(['m', 'Merged'])
    await ctx.db.update(artists).set({ mbid: 'merged-away' }).where(eq(artists.id, 'm'))
    await lookUp('m')
    expect(await artist('m')).toMatchObject({ mbid: null, genresCheckedAt: ctx.deps.now!() })
  })

  it('pauses only Last.fm when Last.fm asks us to slow down', async () => {
    await addArtists(['a', 'A'], ['b', 'B'])
    ctx.lastfm.getArtistTopTags.mockRejectedValueOnce(new MetadataApiError(429, 'Rate limit exceeded', 60))
    await enqueue(ctx.db, [{ kind: 'genres-lastfm', ref: 'a' }, { kind: 'genres-mb-id', ref: 'b' }], ctx.deps.now!())

    expect(await runJobs(ctx.deps, { api: 'lastfm', intervalMs: 0 })).toMatchObject({
      done: 0,
      rateLimitedUntil: new Date(ctx.deps.now!().getTime() + 60_000),
    })
    // MusicBrainz carries on: the link lookup, then the name search it leads to.
    expect(await runJobs(ctx.deps, { api: 'musicbrainz', intervalMs: 0 })).toMatchObject({ done: 2, rateLimitedUntil: null })
    expect(await runJobs(ctx.deps, { api: 'spotify', intervalMs: 0 })).toMatchObject({ rateLimitedUntil: null })
  })

  describe('sweep', () => {
    const playedAt = (trackId: string, iso: string) =>
      ctx.db.insert(plays).values({ userId: 'pixelg', trackId, playedAt: new Date(iso), source: 'poll' })
    const queuedRefs = async () => (await ctx.db.select().from(jobs).orderBy(asc(jobs.id))).map((job) => job.ref)

    it('queues artists without genres, most recently played first, unplayed last', async () => {
      await addArtists(['old', 'Old'], ['recent', 'Recent'], ['unplayed', 'Unplayed'], ['middle', 'Middle'])
      await playedAt('t-old', '2024-01-01T00:00:00Z')
      await playedAt('t-middle', '2025-06-01T00:00:00Z')
      await playedAt('t-recent', '2026-09-20T00:00:00Z')

      expect(await enqueueGenreLookups(ctx.deps)).toBe(4)
      expect(await queuedRefs()).toEqual(['recent', 'middle', 'old', 'unplayed'])
      // Already queued: nothing more.
      expect(await enqueueGenreLookups(ctx.deps)).toBe(0)
    })

    it('skips checked artists until their genres are stale', async () => {
      await addArtists(['a', 'A'])
      await ctx.db.update(artists).set({ genresCheckedAt: ctx.deps.now!() })
      expect(await enqueueGenreLookups(ctx.deps)).toBe(0)
      ctx.advance(GENRES_STALE_MS + 1)
      expect(await enqueueGenreLookups(ctx.deps)).toBe(1)
    })

    it('tops up a batch at a time, leaving the Spotify lane alone', async () => {
      await addArtists(...Array.from({ length: 60 }, (_, i): [string, string] => [`a${i}`, `Artist ${i}`]))
      expect(await enqueueGenreLookups(ctx.deps)).toBe(50)
      expect(await enqueueGenreLookups(ctx.deps)).toBe(0)
      // Spotify's runner doesn't take genre jobs.
      expect(await runJobs(ctx.deps, { api: 'spotify', intervalMs: 0 })).toMatchObject({ done: 0, remaining: 0 })
      expect(ctx.lastfm.getArtistTopTags).not.toHaveBeenCalled()
    })
  })
})
