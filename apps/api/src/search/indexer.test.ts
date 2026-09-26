import { schema } from '@replay-crate/db'
import type { SpotifyPlaylist, SpotifyPlaylistItem } from '@replay-crate/spotify'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext, paged, play, playlist, playlistContext, playlistEntry, track } from '../testing.ts'
import { drainSearchOutbox, enqueueEverything } from './indexer.ts'

const ORIGIN = 'http://127.0.0.1:5173'

// The whole path: syncs write Postgres, triggers fill the outbox, the indexer builds documents,
// and /search finds them.
describe('search indexing', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string

  // oxlint-disable-next-line typescript/no-explicit-any
  const json = (res: Response): Promise<any> => res.json()
  const post = (path: string, body?: unknown) =>
    ctx.app.request(`/api/v1${path}`, {
      method: body === undefined ? 'POST' : 'PUT',
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  /** Matches as "type:id (playCount)". */
  async function search(q: string, extra = '') {
    const body = await json(
      await ctx.app.request(`/api/v1/search?q=${encodeURIComponent(q)}&limit=10${extra}`, { headers: { Cookie: cookie } }),
    )
    return body.groups.flatMap((group: { hits: { type: string; id: string; playCount: number }[] }) =>
      group.hits.map((hit) => `${hit.type}:${hit.id} (${hit.playCount})`),
    )
  }
  const syncPlays = (...items: ReturnType<typeof play>[]) => {
    ctx.spotify.getRecentlyPlayed.mockResolvedValueOnce({ items, cursors: null })
    // Manual syncs close together reuse the last result.
    ctx.advance(60_000)
    return post('/history/sync')
  }
  function servePlaylists(library: SpotifyPlaylist[], contents: Record<string, SpotifyPlaylistItem[]>) {
    ctx.spotify.getMyPlaylists.mockImplementation(async (_token, offset) => paged(library)(offset))
    ctx.spotify.getPlaylistItems.mockImplementation(async (_token, id, offset) => paged(contents[id] ?? [])(offset))
  }

  const troy = track('troy', {
    name: 'They Reminisce Over You',
    album: ['mecca', 'Mecca and the Soul Brother'],
    artists: [
      ['pete', 'Pete Rock'],
      ['cl', 'C.L. Smooth'],
    ],
  })
  const brass = track('brass', { name: 'Brass Monkey Business', album: ['dusty', 'Dusty Grooves'], artists: [['loop', 'The Loop Collective']] })

  beforeEach(async () => {
    ctx = await createTestContext()
    cookie = `rc_session=${(await ctx.login()).token}`
  })
  afterEach(() => ctx.close())

  it('indexes synced plays: tracks, artists, albums and the plays themselves', async () => {
    await syncPlays(
      play(troy, '2026-09-21T11:00:00.000Z', playlistContext('road')),
      play(troy, '2026-09-21T10:00:00.000Z'),
      play(brass, '2026-09-21T09:00:00.000Z'),
    )
    // Not searchable until the indexer has run.
    expect(await search('pete')).toEqual([])

    await ctx.indexSearch()
    expect(await search('pete rock', '&types=track,artist,album')).toEqual([
      'track:troy (2)',
      'artist:pete (2)',
      'album:mecca (2)',
    ])
    expect(await search('reminisce', '&types=play')).toHaveLength(2)
    // The playlist the play came from is named once the sync has resolved it.
    expect(await search('from:"playlist road"', '&types=play')).toHaveLength(1)
  })

  it('keeps play counts, ratings and names current', async () => {
    await syncPlays(play(troy, '2026-09-21T11:00:00.000Z'))
    await ctx.indexSearch()
    expect(await search('reminisce', '&types=track')).toEqual(['track:troy (1)'])

    await syncPlays(play(troy, '2026-09-21T11:30:00.000Z'))
    await post('/tracks/troy/rating', { rating: 5 })
    await ctx.indexSearch()
    expect(await search('rating:5', '&types=track')).toEqual(['track:troy (2)'])

    // Spotify renames the track: its document and its plays' follow.
    const renamed = { ...troy, name: 'T.R.O.Y. (They Reminisce Over You)' }
    await syncPlays(play(renamed, '2026-09-21T11:45:00.000Z'))
    await ctx.indexSearch()
    const plays = await json(
      await ctx.app.request('/api/v1/search?q=reminisce&types=play&limit=10', { headers: { Cookie: cookie } }),
    )
    expect(plays.groups[0].hits.map((hit: { name: string }) => hit.name)).toEqual(Array(3).fill('T.R.O.Y. (They Reminisce Over You)'))
  })

  it('indexes playlists and the tracks on them, and forgets tracks that leave', async () => {
    servePlaylists([playlist('road', { name: 'Road Trip', total: 2 })], {
      road: [playlistEntry(troy), playlistEntry(brass)],
    })
    await post('/playlists/sync')
    await ctx.indexSearch()
    expect(await search('road trip', '&types=playlist')).toEqual(['playlist:road (0)'])
    // On a playlist counts as in the library, played or not.
    expect(await search('in:"road trip"', '&types=track')).toEqual(['track:brass (0)', 'track:troy (0)'])

    servePlaylists([playlist('road', { name: 'Road Trip', total: 1, snapshot: 'road-v2' })], { road: [playlistEntry(troy)] })
    await post('/playlists/sync')
    await ctx.indexSearch()
    expect(await search('brass')).toEqual([])
    expect(await search('in:"road trip"', '&types=track')).toEqual(['track:troy (0)'])
  })

  it('removes documents for deleted plays', async () => {
    await syncPlays(play(brass, '2026-09-21T09:00:00.000Z'))
    await ctx.indexSearch()
    expect(await search('brass', '&types=track,play')).toHaveLength(2)

    await ctx.db.delete(schema.plays)
    await ctx.indexSearch()
    expect(await search('brass')).toEqual([])
  })

  it('puts a failed batch back, to retry later', async () => {
    await syncPlays(play(brass, '2026-09-21T09:00:00.000Z'))
    const waiting = (await ctx.db.select().from(schema.searchOutbox)).length
    vi.spyOn(ctx.deps.search, 'upsert').mockRejectedValueOnce(new Error('index down'))

    await expect(drainSearchOutbox(ctx.deps)).rejects.toThrow('index down')
    const retrying = await ctx.db.select().from(schema.searchOutbox)
    expect(retrying).toHaveLength(waiting)
    expect(retrying.every((row) => row.attempts === 1 && row.runAfter > new Date())).toBe(true)
  })

  it('rebuilds everything on request', async () => {
    await syncPlays(play(brass, '2026-09-21T09:00:00.000Z'))
    await ctx.indexSearch()
    await ctx.db.delete(schema.searchDocs)
    expect(await search('brass')).toEqual([])

    expect(await enqueueEverything(ctx.deps)).toBeGreaterThan(0)
    await ctx.indexSearch()
    expect(await search('brass', '&types=track')).toEqual(['track:brass (1)'])
  })

  it('only indexes what is in each library', async () => {
    await syncPlays(play(brass, '2026-09-21T09:00:00.000Z'))
    ctx.spotify.getCurrentUser.mockResolvedValueOnce({ id: 'someone-else', display_name: null, images: [] })
    ctx.spotify.getRecentlyPlayed.mockResolvedValue({ items: [], cursors: null })
    const other = `rc_session=${(await ctx.login()).token}`
    await ctx.indexSearch()
    const theirs = await json(await ctx.app.request('/api/v1/search?q=brass', { headers: { Cookie: other } }))
    expect(theirs.total).toBe(0)
    const docs = await ctx.db.select().from(schema.searchDocs).where(eq(schema.searchDocs.userId, 'someone-else'))
    expect(docs).toEqual([])
  })
})
