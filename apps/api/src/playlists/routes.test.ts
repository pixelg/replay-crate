import { schema } from '@replay-crate/db'
import { SpotifyApiError, type SpotifyPlaylist, type SpotifyPlaylistItem } from '@replay-crate/spotify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syncPlaylists } from '../sync/playlists.ts'
import { createTestContext, paged, play, playlist, playlistContext, playlistEntry, track } from '../testing.ts'

const ORIGIN = 'http://127.0.0.1:5173'

describe('playlists', () => {
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
  const get = (path: string) => ctx.app.request(path, { headers: { Cookie: cookie } })
  const sync = () =>
    ctx.app.request('/api/v1/playlists/sync', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN } })

  const songA = track('a', { name: 'Song A' })
  const songB = track('b', { name: 'Song B' })
  const songC = track('c', { name: 'Song C' })

  /** Serves `library` from /me/playlists and each playlist's tracks from /items. */
  function serve(library: SpotifyPlaylist[], contents: Record<string, SpotifyPlaylistItem[]>) {
    ctx.spotify.getMyPlaylists.mockImplementation(async (_token, offset) => paged(library)(offset))
    ctx.spotify.getPlaylistItems.mockImplementation(async (_token, id, offset) => paged(contents[id] ?? [])(offset))
  }

  describe('sync', () => {
    it('stores owned playlists and their tracks, and skips followed ones', async () => {
      serve(
        [playlist('road', { total: 2 }), playlist('theirs', { ownerId: 'someone-else' }), playlist('collab', { ownerId: 'friend', collaborative: true })],
        { road: [playlistEntry(songA), playlistEntry(songB)], collab: [playlistEntry(songB)] },
      )

      const res = await sync()
      expect(await json(res)).toEqual({ total: 2, synced: 2, remaining: 0 })
      expect(ctx.spotify.getPlaylistItems).not.toHaveBeenCalledWith(expect.anything(), 'theirs', expect.anything())

      const items = await ctx.db.select().from(schema.playlistItems)
      expect(items.map((i) => [i.playlistId, i.position, i.trackId]).sort()).toEqual([
        ['collab', 0, 'b'],
        ['road', 0, 'a'],
        ['road', 1, 'b'],
      ])
      expect(await ctx.db.select().from(schema.tracks)).toHaveLength(2)
    })

    it('only re-fetches tracks when the snapshot changes', async () => {
      serve([playlist('road')], { road: [playlistEntry(songA)] })
      await sync()
      await sync()
      expect(ctx.spotify.getPlaylistItems).toHaveBeenCalledOnce()

      serve([playlist('road', { snapshot: 'road-v2' })], { road: [playlistEntry(songB), playlistEntry(songC)] })
      await sync()
      const items = await ctx.db.select().from(schema.playlistItems)
      expect(items.map((i) => i.trackId).sort()).toEqual(['b', 'c'])
    })

    it('follows pagination and keeps Spotify positions around skipped entries', async () => {
      const many = Array.from({ length: 120 }, (_, i) => playlistEntry(track(`t${i}`)))
      const local: SpotifyPlaylistItem = { ...playlistEntry(track('local')), is_local: true }
      serve([playlist('big')], { big: [local, ...many] })

      await sync()
      const items = await ctx.db.select().from(schema.playlistItems)
      expect(items).toHaveLength(120)
      expect(Math.min(...items.map((i) => i.position))).toBe(1) // position 0 was the local file
      expect(ctx.spotify.getPlaylistItems).toHaveBeenCalledTimes(3)
    })

    it('drops playlists Spotify refuses to show', async () => {
      serve([playlist('road'), playlist('gone', { ownerId: 'friend', collaborative: true })], { road: [] })
      ctx.spotify.getPlaylistItems.mockImplementation(async (_token, id, offset) => {
        if (id === 'gone') throw new SpotifyApiError(403, 'forbidden')
        return paged<SpotifyPlaylistItem>([])(offset)
      })
      expect(await json(await sync())).toEqual({ total: 1, synced: 1, remaining: 0 })
      expect((await json(await get('/api/v1/playlists'))).playlists.map((p: { id: string }) => p.id)).toEqual(['road'])
    })

    it('stops when out of time and picks up where it left off', async () => {
      serve([playlist('one'), playlist('two'), playlist('three')], {})
      expect(await syncPlaylists(ctx.deps, 'pixelg', { timeBudgetMs: -1 })).toEqual({ total: 3, synced: 0, remaining: 3 })
      expect(await syncPlaylists(ctx.deps, 'pixelg')).toEqual({ total: 3, synced: 3, remaining: 0 })
    })

    it('forgets playlists removed from the library', async () => {
      serve([playlist('one'), playlist('two')], {})
      await sync()
      serve([playlist('two')], {})
      await sync()
      expect((await json(await get('/api/v1/playlists'))).playlists.map((p: { id: string }) => p.id)).toEqual(['two'])
    })
  })

  describe('reading', () => {
    beforeEach(async () => {
      serve([playlist('road', { name: 'Road Trip', total: 2 }), playlist('chill', { name: 'Chill' })], {
        road: [playlistEntry(songA), playlistEntry(songB)],
        chill: [playlistEntry(songA)],
      })
      await sync()
      ctx.spotify.getRecentlyPlayed.mockResolvedValue({
        items: [
          play(songA, '2026-09-21T11:50:00.000Z', playlistContext('road')),
          play(songA, '2026-09-21T11:40:00.000Z', playlistContext('chill')),
          play(songA, '2026-09-21T11:30:00.000Z', playlistContext('road')),
          play(songC, '2026-09-21T11:20:00.000Z', playlistContext('road')),
        ],
        cursors: null,
      })
      await ctx.app.request('/api/v1/history/sync', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN } })
    })

    it('lists playlists in library order with plays from each', async () => {
      const body = await json(await get('/api/v1/playlists'))
      expect(body.syncedAt).toBe('2026-09-21T12:00:00.000Z')
      expect(body.playlists).toEqual([
        {
          id: 'road',
          name: 'Road Trip',
          thumbUrl: 'https://i.scdn.co/road-300',
          ownerName: 'Pixel G',
          owned: true,
          collaborative: false,
          isPublic: true,
          itemCount: 2,
          playsFrom: 3,
          lastPlayedFrom: '2026-09-21T11:50:00.000Z',
        },
        expect.objectContaining({ id: 'chill', playsFrom: 1 }),
      ])
    })

    it('shows play counts per track and the other playlists each track is on', async () => {
      const body = await json(await get('/api/v1/playlists/road'))
      expect(body.playlist).toMatchObject({ id: 'road', name: 'Road Trip', owned: true, playsFrom: 3, itemsSynced: true })
      expect(body.items).toEqual([
        expect.objectContaining({
          position: 0,
          track: expect.objectContaining({ id: 'a', name: 'Song A' }),
          playCount: 3,
          playsHere: 2,
          lastPlayedAt: '2026-09-21T11:50:00.000Z',
          alsoOn: [{ id: 'chill', name: 'Chill' }],
        }),
        expect.objectContaining({
          position: 1,
          track: expect.objectContaining({ id: 'b' }),
          playCount: 0,
          playsHere: 0,
          lastPlayedAt: null,
          alsoOn: [],
        }),
      ])
    })

    it('lists the playlists a track is on, on the track page', async () => {
      const body = await json(await get('/api/v1/tracks/a'))
      expect(body.playlists).toEqual([
        { id: 'road', name: 'Road Trip', thumbUrl: 'https://i.scdn.co/road-300' },
        { id: 'chill', name: 'Chill', thumbUrl: 'https://i.scdn.co/chill-300' },
      ])
    })

    it('is 404 for a playlist that is not in the library', async () => {
      expect((await get('/api/v1/playlists/someone-elses')).status).toBe(404)
    })
  })
})
