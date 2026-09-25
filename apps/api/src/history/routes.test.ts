import { schema } from '@replay-crate/db'
import { SpotifyApiError, SpotifyAuthError } from '@replay-crate/spotify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, play, playlistContext, track } from '../testing.ts'

const MINUTE = 60_000
const ORIGIN = 'http://127.0.0.1:5173'

describe('history', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string

  beforeEach(async () => {
    ctx = await createTestContext()
    const { token } = await ctx.login()
    cookie = `rc_session=${token}`
  })
  afterEach(() => ctx.close())

  /** Response bodies are untyped JSON in tests. */
  // oxlint-disable-next-line typescript/no-explicit-any
  const json = (res: Response): Promise<any> => res.json()
  const sync = () => ctx.app.request('/api/v1/history/sync', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN } })
  const get = (path: string) => ctx.app.request(path, { headers: { Cookie: cookie } })

  const songA = track('a', { name: 'Song A', album: ['alb-1', 'First Album'], artists: [['art-1', 'Band'], ['art-2', 'Guest']] })
  const songB = track('b', { name: 'Song B', album: ['alb-1', 'First Album'], artists: [['art-1', 'Band']] })

  describe('POST /api/v1/history/sync', () => {
    it('records plays and the catalog, and is idempotent', async () => {
      ctx.spotify.getRecentlyPlayed.mockResolvedValue({
        items: [
          play(songA, '2026-09-21T11:50:00.000Z', playlistContext('pl-1')),
          play(songB, '2026-09-21T11:45:00.000Z', { type: 'album', uri: 'spotify:album:alb-1' }),
          play(songA, '2026-09-21T11:40:00.000Z', null),
        ],
        cursors: null,
      })

      const first = await sync()
      expect(first.status).toBe(200)
      expect(await first.json()).toEqual({
        status: 'synced',
        inserted: 3,
        lastSyncedAt: '2026-09-21T12:00:00.000Z',
        missedPlays: false,
      })

      expect(await ctx.db.select().from(schema.tracks)).toHaveLength(2)
      expect(await ctx.db.select().from(schema.albums)).toMatchObject([
        { id: 'alb-1', name: 'First Album', imageUrl: 'https://i.scdn.co/alb-1-300', thumbUrl: 'https://i.scdn.co/alb-1-64' },
      ])
      expect((await ctx.db.select().from(schema.artists)).map((a) => a.id).sort()).toEqual(['art-1', 'art-2'])
      expect(await ctx.db.select().from(schema.trackArtists)).toHaveLength(3)

      ctx.advance(MINUTE)
      const second = await sync()
      expect(await second.json()).toMatchObject({ status: 'synced', inserted: 0 })
      expect(await ctx.db.select().from(schema.plays)).toHaveLength(3)
    })

    it('resolves each context once and remembers ones Spotify will not describe', async () => {
      ctx.spotify.getPlaylistMeta.mockImplementation(async (_token, id) => {
        if (id === 'algorithmic') throw new SpotifyApiError(404, 'not found')
        return { id, name: 'Road Trip', images: [], owner: { id: 'pixelg', display_name: null }, snapshot_id: `${id}-v1` }
      })
      ctx.spotify.getRecentlyPlayed.mockResolvedValue({
        items: [
          play(songA, '2026-09-21T11:50:00.000Z', playlistContext('pl-1')),
          play(songB, '2026-09-21T11:49:00.000Z', playlistContext('pl-1')),
          play(songA, '2026-09-21T11:48:00.000Z', playlistContext('algorithmic')),
          play(songB, '2026-09-21T11:47:00.000Z', { type: 'collection', uri: 'spotify:user:pixelg:collection' }),
          play(songA, '2026-09-21T11:46:00.000Z', { type: 'artist', uri: 'spotify:artist:art-1' }),
        ],
        cursors: null,
      })

      await sync()
      ctx.advance(MINUTE)
      await sync()

      expect(ctx.spotify.getPlaylistMeta).toHaveBeenCalledTimes(2) // pl-1 and algorithmic, once each
      const stored = Object.fromEntries((await ctx.db.select().from(schema.contexts)).map((c) => [c.uri, c.name]))
      expect(stored).toEqual({
        'spotify:playlist:pl-1': 'Road Trip',
        'spotify:playlist:algorithmic': null,
        'spotify:user:pixelg:collection': 'Liked Songs',
        'spotify:artist:art-1': 'Artist art-1',
      })
    })

    it('retries a context lookup that failed transiently', async () => {
      ctx.spotify.getPlaylistMeta.mockRejectedValueOnce(new SpotifyApiError(503, 'unavailable'))
      ctx.spotify.getRecentlyPlayed.mockResolvedValue({
        items: [play(songA, '2026-09-21T11:50:00.000Z', playlistContext('pl-1'))],
        cursors: null,
      })

      await sync()
      expect(await ctx.db.select().from(schema.contexts)).toEqual([])
      ctx.advance(MINUTE)
      await sync()
      expect(await ctx.db.select().from(schema.contexts)).toHaveLength(1)
    })

    it('skips local files', async () => {
      const local = { ...track('x'), id: null, is_local: true }
      ctx.spotify.getRecentlyPlayed.mockResolvedValue({
        items: [play(local, '2026-09-21T11:50:00.000Z'), play(songA, '2026-09-21T11:40:00.000Z')],
        cursors: null,
      })
      expect(await (await sync()).json()).toMatchObject({ inserted: 1 })
    })

    it('does not call Spotify again within 30 seconds', async () => {
      await sync()
      ctx.advance(10_000)
      expect(await (await sync()).json()).toMatchObject({ status: 'skipped', inserted: 0 })
      expect(ctx.spotify.getRecentlyPlayed).toHaveBeenCalledOnce()
    })

    it('returns 409 when Spotify access has been revoked', async () => {
      ctx.spotify.refreshAccessToken.mockRejectedValueOnce(new SpotifyAuthError(400, 'invalid_grant'))
      ctx.advance(2 * 60 * MINUTE)
      const res = await sync()
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: 'reauth_required' })
    })

    it('requires a session', async () => {
      const res = await ctx.app.request('/api/v1/history/sync', { method: 'POST', headers: { Origin: ORIGIN } })
      expect(res.status).toBe(401)
    })
  })

  describe('GET /api/v1/history/plays', () => {
    beforeEach(async () => {
      ctx.spotify.getRecentlyPlayed.mockResolvedValue({
        items: [
          play(songA, '2026-09-21T11:50:00.000Z', playlistContext('pl-1')),
          play(songB, '2026-09-21T11:45:00.000Z'),
          play(songA, '2026-09-21T11:40:00.000Z'),
        ],
        cursors: null,
      })
      await sync()
    })

    it('returns plays newest first with track, artists and context', async () => {
      const body = await json(await get('/api/v1/history/plays'))
      expect(body.nextCursor).toBeNull()
      expect(body.lastSyncedAt).toBe('2026-09-21T12:00:00.000Z')
      expect(body.items.map((p: { playedAt: string }) => p.playedAt)).toEqual([
        '2026-09-21T11:50:00.000Z',
        '2026-09-21T11:45:00.000Z',
        '2026-09-21T11:40:00.000Z',
      ])
      expect(body.items[0]).toEqual({
        playedAt: '2026-09-21T11:50:00.000Z',
        msPlayed: null,
        source: 'poll',
        context: {
          type: 'playlist',
          uri: 'spotify:playlist:pl-1',
          name: 'Playlist pl-1',
          imageUrl: 'https://i.scdn.co/pl-1',
        },
        track: {
          id: 'a',
          name: 'Song A',
          durationMs: 200_000,
          explicit: false,
          album: { id: 'alb-1', name: 'First Album', thumbUrl: 'https://i.scdn.co/alb-1-64' },
          artists: [
            { id: 'art-1', name: 'Band' },
            { id: 'art-2', name: 'Guest' },
          ],
        },
      })
      expect(body.items[1].context).toBeNull()
    })

    it('paginates with the before cursor', async () => {
      const first = await json(await get('/api/v1/history/plays?limit=2'))
      expect(first.items).toHaveLength(2)
      expect(first.nextCursor).toBe('2026-09-21T11:45:00.000Z')

      const second = await json(await get(`/api/v1/history/plays?limit=2&before=${first.nextCursor}`))
      expect(second.items.map((p: { playedAt: string }) => p.playedAt)).toEqual(['2026-09-21T11:40:00.000Z'])
      expect(second.nextCursor).toBeNull()
    })

    it('only returns the signed-in user’s plays', async () => {
      ctx.spotify.getCurrentUser.mockResolvedValueOnce({ id: 'someone-else', display_name: null, images: [] })
      const { token } = await ctx.login()
      const body = await json(await ctx.app.request('/api/v1/history/plays', { headers: { Cookie: `rc_session=${token}` } }))
      expect(body.items).toEqual([])
    })

    it('rejects a malformed cursor', async () => {
      expect((await get('/api/v1/history/plays?before=yesterday')).status).toBe(400)
    })
  })

  describe('GET /api/v1/tracks/:id', () => {
    it('returns play stats and where the track was played from', async () => {
      ctx.spotify.getRecentlyPlayed.mockResolvedValue({
        items: [
          play(songA, '2026-09-21T11:50:00.000Z', playlistContext('pl-1')),
          play(songA, '2026-09-20T09:00:00.000Z', playlistContext('pl-1')),
          play(songA, '2026-09-19T08:00:00.000Z'),
          play(songB, '2026-09-19T07:00:00.000Z'),
        ],
        cursors: null,
      })
      await sync()

      const body = await json(await get('/api/v1/tracks/a'))
      expect(body.track).toMatchObject({ id: 'a', name: 'Song A', album: { name: 'First Album', releaseDate: '2024-05-01' } })
      expect(body.stats).toEqual({
        playCount: 3,
        firstPlayedAt: '2026-09-19T08:00:00.000Z',
        lastPlayedAt: '2026-09-21T11:50:00.000Z',
      })
      expect(body.playedFrom).toEqual([
        {
          context: { type: 'playlist', uri: 'spotify:playlist:pl-1', name: 'Playlist pl-1', imageUrl: 'https://i.scdn.co/pl-1' },
          playCount: 2,
          lastPlayedAt: '2026-09-21T11:50:00.000Z',
        },
        { context: null, playCount: 1, lastPlayedAt: '2026-09-19T08:00:00.000Z' },
      ])
      expect(body.recentPlays).toHaveLength(3)
    })

    it('is 404 for a track we have never seen', async () => {
      expect((await get('/api/v1/tracks/nope')).status).toBe(404)
    })
  })
})
