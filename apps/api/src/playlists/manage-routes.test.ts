import { schema } from '@replay-crate/db'
import { SpotifyApiError } from '@replay-crate/spotify'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, play, track } from '../testing.ts'

const ORIGIN = 'http://127.0.0.1:5173'
const DAY = 24 * 60 * 60 * 1000

describe('playlist management', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string

  beforeEach(async () => {
    ctx = await createTestContext()
    const { token } = await ctx.login()
    cookie = `rc_session=${token}`
  })
  afterEach(() => ctx.close())

  // oxlint-disable-next-line typescript/no-explicit-any
  const json = (res: Response): Promise<any> => res.json()
  const send = (method: string, path: string, body?: unknown) =>
    ctx.app.request(path, {
      method,
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const syncLibrary = () => send('POST', '/api/v1/playlists/sync')
  const storedOrder = async (playlistId: string) =>
    (
      await ctx.db
        .select({ trackId: schema.playlistItems.trackId })
        .from(schema.playlistItems)
        .where(eq(schema.playlistItems.playlistId, playlistId))
        .orderBy(asc(schema.playlistItems.position))
    ).map((row) => row.trackId)

  describe('changing tracks', () => {
    beforeEach(async () => {
      ctx.library.add('road', [track('a'), track('b'), track('c'), track('d')])
      await syncLibrary()
    })

    it('adds tracks at a position and stores what Spotify now has', async () => {
      const res = await send('POST', '/api/v1/playlists/road/items', { trackIds: ['x', 'y'], position: 1 })
      expect(res.status).toBe(200)
      expect(ctx.library.trackIds('road')).toEqual(['a', 'x', 'y', 'b', 'c', 'd'])
      expect(await storedOrder('road')).toEqual(['a', 'x', 'y', 'b', 'c', 'd'])
      const [playlist] = await ctx.db.select().from(schema.playlists).where(eq(schema.playlists.id, 'road'))
      // Items are recorded at the version the write returned; `snapshotId` is the listing's
      // view and only moves when the next library sync sees the new version.
      expect(playlist).toMatchObject({ itemCount: 6, itemsSnapshotId: 'road-v2', snapshotId: 'road-v1' })
    })

    it('removes every copy of a track', async () => {
      await send('POST', '/api/v1/playlists/road/items', { trackIds: ['a'] })
      const res = await send('DELETE', '/api/v1/playlists/road/items', { trackIds: ['a'] })
      expect(res.status).toBe(200)
      expect(await storedOrder('road')).toEqual(['b', 'c', 'd'])
    })

    it.each([
      { from: 0, to: 2, expected: ['b', 'c', 'a', 'd'] }, // down
      { from: 3, to: 0, expected: ['d', 'a', 'b', 'c'] }, // to the top
      { from: 1, to: 3, expected: ['a', 'c', 'd', 'b'] }, // to the bottom
      { from: 2, to: 1, expected: ['a', 'c', 'b', 'd'] }, // up one
    ])('moves $from → $to', async ({ from, to, expected }) => {
      const res = await send('PUT', '/api/v1/playlists/road/items/move', { from, to })
      expect(res.status).toBe(200)
      expect(ctx.library.trackIds('road')).toEqual(expected)
      expect(await storedOrder('road')).toEqual(expected)
    })

    it('guards moves with the version its positions came from, even while the listing lags', async () => {
      ctx.library.freezeListing() // GET /me/playlists keeps reporting road-v1
      await send('POST', '/api/v1/playlists/road/items', { trackIds: ['x'] }) // road is now v2
      await syncLibrary() // must not replace the guard with the stale v1

      const res = await send('PUT', '/api/v1/playlists/road/items/move', { from: 4, to: 0 })
      expect(res.status).toBe(200)
      expect(ctx.spotify.reorderPlaylistItems).toHaveBeenLastCalledWith('access-1', 'road', {
        rangeStart: 4,
        insertBefore: 0,
        snapshotId: 'road-v2',
      })
      expect(await storedOrder('road')).toEqual(['x', 'a', 'b', 'c', 'd'])
    })

    it('refuses playlists outside the library', async () => {
      const res = await send('POST', '/api/v1/playlists/not-mine/items', { trackIds: ['a'] })
      expect(res.status).toBe(404)
      expect(await json(res)).toEqual({ error: 'not_found' })
    })

    it('reports Spotify refusing the change as forbidden', async () => {
      ctx.spotify.addPlaylistItems.mockRejectedValueOnce(new SpotifyApiError(403, 'not a collaborator'))
      const res = await send('POST', '/api/v1/playlists/road/items', { trackIds: ['x'] })
      expect(res.status).toBe(403)
      expect(await json(res)).toEqual({ error: 'forbidden' })
    })

    it('validates the body', async () => {
      const res = await send('PUT', '/api/v1/playlists/road/items/move', { from: -1, to: 'top' })
      expect(res.status).toBe(400)
      expect((await json(res)).error).toBe('invalid_request')
    })
  })

  describe('creating', () => {
    it('creates a playlist with tracks, in batches of 100, and adds it to the library', async () => {
      const trackIds = Array.from({ length: 150 }, (_, i) => `t${i}`)
      const res = await send('POST', '/api/v1/playlists', { name: 'Big one', trackIds })
      expect(res.status).toBe(201)
      const { id } = await json(res)

      expect(ctx.spotify.addPlaylistItems).toHaveBeenCalledTimes(2)
      expect(ctx.spotify.createPlaylist).toHaveBeenCalledWith('access-1', {
        name: 'Big one',
        description: 'Made with Replay Crate from your listening history.',
        public: false,
      })
      expect(await storedOrder(id)).toEqual(trackIds)

      const list = await json(await send('GET', '/api/v1/playlists'))
      expect(list.playlists[0]).toMatchObject({ id, name: 'Big one', itemCount: 150, owned: true })
    })
  })

  describe('rules', () => {
    const now = new Date('2026-09-21T12:00:00Z')
    const at = (daysAgo: number, minutes = 0) => new Date(now.getTime() - daysAgo * DAY - minutes * 60_000).toISOString()

    beforeEach(async () => {
      // a: 4 plays this week; b: 2 plays long ago + 1 this month; c: 6 plays 200 days ago; d: 1 play today
      ctx.spotify.getRecentlyPlayed.mockResolvedValue({
        items: [
          play(track('d', { name: 'Fresh' }), at(0, 5)),
          ...[1, 2, 3, 4].map((i) => play(track('a', { name: 'Loop' }), at(i))),
          play(track('b'), at(20)),
          play(track('b'), at(120)),
          play(track('b'), at(121)),
          ...[1, 2, 3, 4, 5, 6].map((i) => play(track('c', { name: 'Old flame' }), at(200, i))),
        ],
        cursors: null,
      })
      await send('POST', '/api/v1/history/sync')
    })

    const preview = async (rule: Record<string, unknown>) => json(await send('POST', '/api/v1/playlists/preview', { rule }))

    it('top: most played in the range', async () => {
      const body = await preview({ kind: 'top', range: '30d', limit: 5 })
      expect(body.suggestedName).toBe('Top 5 · last 30 days')
      expect(body.tracks.map((t: { id: string; playCount: number }) => [t.id, t.playCount])).toEqual([
        ['a', 4],
        ['d', 1],
        ['b', 1],
      ])
      expect(body.tracks[0]).toMatchObject({ name: 'Loop', artists: [{ id: 'artist-1', name: 'Artist One' }] })
    })

    it('recent: newest first', async () => {
      const body = await preview({ kind: 'recent', range: '7d' })
      expect(body.tracks.map((t: { id: string }) => t.id)).toEqual(['d', 'a'])
    })

    it('on repeat: 3+ plays in two weeks', async () => {
      const body = await preview({ kind: 'on_repeat' })
      expect(body.tracks.map((t: { id: string }) => t.id)).toEqual(['a'])
    })

    it('forgotten: played a lot, not lately', async () => {
      const body = await preview({ kind: 'forgotten', minPlays: 3, idleDays: 90 })
      expect(body.suggestedName).toBe('Forgotten favourites')
      expect(body.tracks.map((t: { id: string }) => t.id)).toEqual(['c'])
    })

    it('rejects unknown rules', async () => {
      const res = await send('POST', '/api/v1/playlists/preview', { rule: { kind: 'vibes' } })
      expect(res.status).toBe(400)
    })
  })
})
