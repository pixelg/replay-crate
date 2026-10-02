import { schema } from '@replay-crate/db'
import type { SpotifyTrack } from '@replay-crate/spotify'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mergeRecordings, upsertCatalog } from '../sync/catalog.ts'
import { createTestContext, paged, play, playlist, playlistEntry, track } from '../testing.ts'

const ORIGIN = 'http://127.0.0.1:5173'
const ISRC = 'GBMYF1800060'

/** One recording on several releases: the same ISRC under each release's own track id. */
const copy = (id: string, album: [string, string], isrc = ISRC): SpotifyTrack => ({
  ...track(id, { name: 'Cocaine Sunday', album }),
  external_ids: { isrc },
})

describe('copies of a recording', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string

  // oxlint-disable-next-line typescript/no-explicit-any
  const json = (res: Response): Promise<any> => res.json()
  const get = (path: string) => ctx.app.request(`/api/v1${path}`, { headers: { Cookie: cookie } })
  const send = (method: string, path: string, body?: unknown) =>
    ctx.app.request(`/api/v1${path}`, {
      method,
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  /** Records `played` (newest first) as a sync of recently played would. */
  const recordPlays = async (...played: Array<[SpotifyTrack, string]>) => {
    ctx.spotify.getRecentlyPlayed.mockResolvedValueOnce({ items: played.map(([t, at]) => play(t, at)), cursors: null })
    expect(await json(await send('POST', '/history/sync'))).toMatchObject({ status: 'synced' })
    ctx.advance(60_000) // Syncs within 30 s of the last one are skipped.
  }
  const storedPlays = () =>
    ctx.db
      .select({ trackId: schema.plays.trackId, playedTrackId: schema.plays.playedTrackId })
      .from(schema.plays)
      .orderBy(asc(schema.plays.playedAt))
  const recordingOf = async (id: string) =>
    (await ctx.db.select({ of: schema.tracks.recordingOf }).from(schema.tracks).where(eq(schema.tracks.id, id)))[0]?.of

  // Spotify ids: the import only takes real-looking ones.
  const SINGLE = 'Single0000000000000000'
  const LP = 'Album00000000000000000'
  const single = copy(SINGLE, ['sg-single', 'Sensitive G (single)'])
  const lp = copy(LP, ['sg', 'Sensitive G'])

  beforeEach(async () => {
    ctx = await createTestContext()
    cookie = `rc_session=${(await ctx.login()).token}`
  })
  afterEach(() => ctx.close())

  it('counts a new copy as the recording it plays', async () => {
    await recordPlays([single, '2026-09-20T10:05:00Z'], [single, '2026-09-20T10:00:00Z'])
    // Later the album's copy plays (an album started at the track, say).
    await recordPlays([lp, '2026-09-21T09:00:00Z'])

    expect(await recordingOf(LP)).toBe(SINGLE)
    expect(await recordingOf(SINGLE)).toBeNull()
    expect(await storedPlays()).toEqual([
      { trackId: SINGLE, playedTrackId: null },
      { trackId: SINGLE, playedTrackId: null },
      { trackId: SINGLE, playedTrackId: LP },
    ])

    const library = await json(await get('/tracks'))
    expect(library.items.map((item: { track: { id: string }; playCount: number }) => [item.track.id, item.playCount])).toEqual([
      [SINGLE, 3],
    ])
    // The copy's page is the recording's.
    const page = await json(await get(`/tracks/${LP}`))
    expect(page.track.id).toBe(SINGLE)
    expect(page.stats.playCount).toBe(3)
  })

  it('merges copies played apart onto the most played, keeping the latest rating', async () => {
    // Before merging (as before migration 0025): two copies Replay Crate didn't know were one,
    // each with plays and a rating.
    const apart = { single: copy(SINGLE, ['sg-single', 'Single'], 'X1'), lp: copy(LP, ['sg', 'Album'], 'X2') }
    await recordPlays([apart.lp, '2026-09-20T12:00:00Z'], [apart.lp, '2026-09-20T11:00:00Z'], [apart.single, '2026-09-20T10:00:00Z'])
    expect(await storedPlays()).toEqual([
      { trackId: SINGLE, playedTrackId: null },
      { trackId: LP, playedTrackId: null },
      { trackId: LP, playedTrackId: null },
    ])
    const userId = (await ctx.db.select({ id: schema.users.id }).from(schema.users))[0]!.id
    await ctx.db.insert(schema.trackRatings).values([
      { userId, trackId: LP, rating: 2, updatedAt: new Date('2026-09-01T00:00:00Z') },
      { userId, trackId: SINGLE, rating: 5, updatedAt: new Date('2026-09-15T00:00:00Z') },
    ])

    await ctx.db.update(schema.tracks).set({ isrc: ISRC })
    await mergeRecordings(ctx.db, [ISRC])

    expect(await recordingOf(SINGLE)).toBe(LP)
    expect(await storedPlays()).toEqual([
      { trackId: LP, playedTrackId: SINGLE },
      { trackId: LP, playedTrackId: null },
      { trackId: LP, playedTrackId: null },
    ])
    expect(await ctx.db.select({ trackId: schema.trackRatings.trackId, rating: schema.trackRatings.rating }).from(schema.trackRatings)).toEqual([
      { trackId: LP, rating: 5 },
    ])
    // Merging again changes nothing.
    await mergeRecordings(ctx.db, [ISRC])
    expect((await storedPlays()).filter((row) => row.trackId === LP)).toHaveLength(3)
  })

  it('rates the recording through any copy', async () => {
    await recordPlays([single, '2026-09-20T10:00:00Z'])
    await upsertCatalog(ctx.db, [lp])

    expect((await send('PUT', `/tracks/${LP}/rating`, { rating: 4 })).status).toBe(200)
    expect((await json(await get(`/tracks/${SINGLE}`))).track.rating).toBe(4)
    expect((await json(await get(`/tracks/${LP}`))).track.rating).toBe(4)
    expect((await send('DELETE', `/tracks/${LP}/rating`)).status).toBe(204)
    expect((await json(await get(`/tracks/${SINGLE}`))).track.rating).toBeNull()
  })

  it("counts a playlist's copy as the recording", async () => {
    await recordPlays([single, '2026-09-20T10:05:00Z'], [single, '2026-09-20T10:00:00Z'])
    // The playlist holds the album's copy; another holds the single.
    ctx.spotify.getMyPlaylists.mockImplementation(async (_token, offset) => paged([playlist('road'), playlist('mix')])(offset))
    ctx.spotify.getPlaylistItems.mockImplementation(async (_token, id, offset) =>
      paged(id === 'road' ? [playlistEntry(lp)] : [playlistEntry(single)])(offset),
    )
    expect((await send('POST', '/playlists/sync')).status).toBe(200)

    const road = await json(await get('/playlists/road'))
    expect(road.items[0]).toMatchObject({ track: { id: LP }, playCount: 2, alsoOn: [{ id: 'mix' }] })
    const page = await json(await get(`/tracks/${SINGLE}`))
    expect(page.playlists.map((p: { id: string }) => p.id).sort()).toEqual(['mix', 'road'])
    const history = await json(await get('/history/plays'))
    expect(history.items[0].track.playlists.map((p: { id: string }) => p.id).sort()).toEqual(['mix', 'road'])

    // Search lists the recording once, with all its plays and playlists.
    await ctx.indexSearch()
    const found = await json(await get('/search?q=cocaine&types=track'))
    const hits = found.groups.flatMap((group: { hits: unknown[] }) => group.hits)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ type: 'track', id: SINGLE, playCount: 2 })
  })

  it("skips an import's play of another copy that was recorded live", async () => {
    await recordPlays([single, '2026-09-20T10:00:00Z'])
    await upsertCatalog(ctx.db, [lp])
    const { id } = await json(await send('POST', '/imports'))
    await send('POST', `/imports/${id}/plays`, {
      plays: [
        { ts: '2026-09-20T10:00:30Z', ms: 200_000, trackId: LP }, // the live play, as the export names it
        { ts: '2026-09-18T10:00:00Z', ms: 200_000, trackId: LP }, // an older one: new
      ],
    })
    await send('POST', `/imports/${id}/finish`)
    expect(await storedPlays()).toEqual([
      { trackId: SINGLE, playedTrackId: LP },
      { trackId: SINGLE, playedTrackId: null },
    ])
  })

  it("counts Spotify search results' plays under any copy", async () => {
    await recordPlays([single, '2026-09-20T10:00:00Z'])
    // A remaster the catalog has never seen: same ISRC.
    ctx.spotify.searchTracks.mockResolvedValueOnce(await paged([copy('remaster', ['sg-r', 'Sensitive G (Remastered)'])])(0))
    const found = await json(await get('/search/spotify?q=cocaine'))
    expect(found.tracks).toMatchObject([{ id: 'remaster', playCount: 1 }])
  })
})
