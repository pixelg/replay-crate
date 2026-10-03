import { schema } from '@replay-crate/db'
import { SpotifyApiError, SpotifyAuthError } from '@replay-crate/spotify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { upsertCatalog } from '../sync/catalog.ts'
import { createTestContext, paged, play, playlist, playlistContext, playlistEntry, track } from '../testing.ts'

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
    it("waits out Spotify's Retry-After without asking it again", async () => {
      ctx.spotify.getRecentlyPlayed.mockRejectedValueOnce(new SpotifyApiError(429, 'slow down', 3_600))
      const refused = await sync()
      expect(refused.status).toBe(503)
      expect(await json(refused)).toEqual({ error: 'rate_limited', retryAfter: 3_600 })

      // The app syncs again on its own (a track change, coming back to the tab): no call to Spotify.
      ctx.advance(10 * MINUTE)
      const waiting = await sync()
      expect(waiting.status).toBe(503)
      expect(await json(waiting)).toEqual({ error: 'rate_limited', retryAfter: 50 * 60 })
      expect(ctx.spotify.getRecentlyPlayed).toHaveBeenCalledOnce()

      ctx.advance(51 * MINUTE)
      ctx.spotify.getRecentlyPlayed.mockResolvedValue({ items: [], cursors: null })
      expect((await sync()).status).toBe(200)
    })

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
        // Looked up as "Artist art-1", then renamed by the catalog's copy of the artist (the
        // tracks credit art-1 as "Band"): contexts follow the catalog.
        'spotify:artist:art-1': 'Band',
      })
    })

    it("drops a context the track provably isn't in: one the user queued, or autoplay chose", async () => {
      const queued = track('q', { album: ['alb-2', 'Second Album'] })
      await ctx.db.insert(schema.playlists).values([
        { id: 'kept', ownerId: 'pixelg', name: 'Kept', snapshotId: 's1', itemsSnapshotId: 's1' },
        { id: 'changed', ownerId: 'pixelg', name: 'Changed', snapshotId: 's2', itemsSnapshotId: 's1' },
      ])
      ctx.spotify.getRecentlyPlayed.mockResolvedValue({
        items: [
          play(songA, '2026-09-21T11:50:00.000Z', playlistContext('kept')),
          play(queued, '2026-09-21T11:46:00.000Z', playlistContext('kept')),
          play(queued, '2026-09-21T11:42:00.000Z', { type: 'album', uri: 'spotify:album:alb-1' }),
          play(songB, '2026-09-21T11:38:00.000Z', { type: 'album', uri: 'spotify:album:alb-1' }),
          // Can't tell: changed since its items were synced, or not the user's.
          play(queued, '2026-09-21T11:34:00.000Z', playlistContext('changed')),
          play(queued, '2026-09-21T11:30:00.000Z', playlistContext('theirs')),
        ],
        cursors: null,
      })
      await upsertCatalog(ctx.db, [songA])
      await ctx.db.insert(schema.playlistItems).values({ playlistId: 'kept', position: 0, trackId: 'a' })

      await sync()
      const plays = await ctx.db.select({ trackId: schema.plays.trackId, context: schema.plays.contextUri }).from(schema.plays).orderBy(schema.plays.playedAt)
      expect(plays.reverse()).toEqual([
        { trackId: 'a', context: 'spotify:playlist:kept' },
        { trackId: 'q', context: null },
        { trackId: 'q', context: null },
        { trackId: 'b', context: 'spotify:album:alb-1' },
        { trackId: 'q', context: 'spotify:playlist:changed' },
        { trackId: 'q', context: 'spotify:playlist:theirs' },
      ])
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
          genres: [],
          rating: null,
          playlists: [],
        },
      })
      expect(body.items[1].context).toBeNull()
    })

    it("lists the user's playlists holding each track, the latest it was added to first", async () => {
      const library = [playlist('road'), playlist('gym'), playlist('theirs', { ownerId: 'someone-else' })]
      // Song A went into Road twice (the second time after Gym); Song B's Gym entry is the newer one.
      const contents: Record<string, ReturnType<typeof playlistEntry>[]> = {
        road: [playlistEntry(songA, '2026-03-01T00:00:00Z'), playlistEntry(songA, '2026-06-01T00:00:00Z'), playlistEntry(songB, '2026-02-01T00:00:00Z')],
        gym: [playlistEntry(songA, '2026-05-01T00:00:00Z'), playlistEntry(songB, '2026-04-01T00:00:00Z')],
        theirs: [playlistEntry(songB)],
      }
      ctx.spotify.getMyPlaylists.mockImplementation(async (_token, offset) => paged(library)(offset))
      ctx.spotify.getPlaylistItems.mockImplementation(async (_token, id, offset) => paged(contents[id] ?? [])(offset))
      await ctx.app.request('/api/v1/playlists/sync', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN } })

      const body = await json(await get('/api/v1/history/plays'))
      // Each playlist once, though Song A is on Road twice; followed playlists aren't the user's.
      const road = { id: 'road', name: 'Playlist road' }
      const gym = { id: 'gym', name: 'Playlist gym' }
      expect(body.items.map((p: { track: { playlists: unknown } }) => p.track.playlists)).toEqual([[road, gym], [gym, road], [road, gym]])
    })

    it('paginates with the before cursor', async () => {
      const first = await json(await get('/api/v1/history/plays?limit=2'))
      expect(first.items).toHaveLength(2)
      expect(first.nextCursor).toBe('2026-09-21T11:45:00.000Z')

      const second = await json(await get(`/api/v1/history/plays?limit=2&before=${first.nextCursor}`))
      expect(second.items.map((p: { playedAt: string }) => p.playedAt)).toEqual(['2026-09-21T11:40:00.000Z'])
      expect(second.nextCursor).toBeNull()
    })

    it('pages by offset with a total and the next page’s first play', async () => {
      const first = await json(await get('/api/v1/history/plays?limit=2&offset=0'))
      expect(first.items.map((p: { playedAt: string }) => p.playedAt)).toEqual([
        '2026-09-21T11:50:00.000Z',
        '2026-09-21T11:45:00.000Z',
      ])
      expect(first.total).toBe(3)
      expect(first.olderPlayedAt).toBe('2026-09-21T11:40:00.000Z')
      // Rows still carry their joins (track, artists, context) when paged by offset.
      expect(first.items[0].track.artists).toHaveLength(2)
      expect(first.items[0].context.name).toBe('Playlist pl-1')

      const second = await json(await get('/api/v1/history/plays?limit=2&offset=2'))
      expect(second.items.map((p: { playedAt: string }) => p.playedAt)).toEqual(['2026-09-21T11:40:00.000Z'])
      expect(second).toMatchObject({ total: 3, olderPlayedAt: null, nextCursor: null })

      const past = await json(await get('/api/v1/history/plays?limit=2&offset=10'))
      expect(past).toMatchObject({ items: [], total: 3, olderPlayedAt: null })
    })

    it('leaves total out when paging by cursor', async () => {
      const body = await json(await get('/api/v1/history/plays?limit=2'))
      expect(body).not.toHaveProperty('total')
      expect(body).not.toHaveProperty('olderPlayedAt')
    })

    it('pages newer with the after cursor, still newest first', async () => {
      const first = await json(await get('/api/v1/history/plays?limit=1&after=2026-09-21T11:40:00.000Z'))
      // The play closest to the cursor, not the newest one.
      expect(first.items.map((p: { playedAt: string }) => p.playedAt)).toEqual(['2026-09-21T11:45:00.000Z'])
      expect(first.nextCursor).toBe('2026-09-21T11:45:00.000Z')

      const second = await json(await get(`/api/v1/history/plays?limit=5&after=${first.nextCursor}`))
      expect(second.items.map((p: { playedAt: string }) => p.playedAt)).toEqual(['2026-09-21T11:50:00.000Z'])
      expect(second.nextCursor).toBeNull()

      const both = await json(await get('/api/v1/history/plays?limit=2&after=2026-09-21T11:00:00.000Z'))
      expect(both.items.map((p: { playedAt: string }) => p.playedAt)).toEqual([
        '2026-09-21T11:45:00.000Z',
        '2026-09-21T11:40:00.000Z',
      ])
      expect(both.items[0].track.artists).toEqual([{ id: 'art-1', name: 'Band' }])
    })

    it('rejects after with another cursor', async () => {
      for (const query of ['after=2026-09-21T11:45:00.000Z&before=2026-09-21T11:50:00.000Z', 'after=2026-09-21T11:45:00.000Z&offset=0']) {
        const res = await get(`/api/v1/history/plays?${query}`)
        expect(res.status).toBe(400)
        expect(await json(res)).toMatchObject({ error: 'invalid_request', issues: [{ path: 'after' }] })
      }
    })

    it('rejects before and offset together', async () => {
      const res = await get('/api/v1/history/plays?offset=0&before=2026-09-21T11:45:00.000Z')
      expect(res.status).toBe(400)
      expect(await json(res)).toMatchObject({ error: 'invalid_request', issues: [{ path: 'offset' }] })
    })

    it('only returns the signed-in user’s plays', async () => {
      ctx.spotify.getCurrentUser.mockResolvedValueOnce({ id: 'someone-else', display_name: null, images: [] })
      const { token } = await ctx.login()
      const body = await json(await ctx.app.request('/api/v1/history/plays', { headers: { Cookie: `rc_session=${token}` } }))
      expect(body.items).toEqual([])
    })

    it('keeps only plays between since and until, with any way of paging', async () => {
      const at = (body: { items: Array<{ playedAt: string }> }) => body.items.map((p) => p.playedAt)
      // since is inclusive, until exclusive.
      const range = 'since=2026-09-21T11:45:00.000Z&until=2026-09-21T11:50:00.000Z'
      expect(at(await json(await get(`/api/v1/history/plays?${range}`)))).toEqual(['2026-09-21T11:45:00.000Z'])
      expect(at(await json(await get('/api/v1/history/plays?since=2026-09-21T11:41:00.000Z')))).toEqual([
        '2026-09-21T11:50:00.000Z',
        '2026-09-21T11:45:00.000Z',
      ])
      expect(at(await json(await get('/api/v1/history/plays?until=2026-09-21T11:45:00.000Z')))).toEqual(['2026-09-21T11:40:00.000Z'])

      // Numbered pages count only the plays in range.
      const paged = await json(await get('/api/v1/history/plays?since=2026-09-21T11:41:00.000Z&limit=1&offset=0'))
      expect(paged).toMatchObject({ total: 2, olderPlayedAt: '2026-09-21T11:45:00.000Z' })
      // And cursors stay inside it.
      const older = await json(await get('/api/v1/history/plays?since=2026-09-21T11:41:00.000Z&before=2026-09-21T11:50:00.000Z'))
      expect(at(older)).toEqual(['2026-09-21T11:45:00.000Z'])
    })

    it('rejects a malformed cursor', async () => {
      expect((await get('/api/v1/history/plays?before=yesterday')).status).toBe(400)
    })

    const at = (body: { items: Array<{ playedAt: string }> }) => body.items.map((p) => p.playedAt)
    const rate = async (trackId: string, rating: number) => {
      const [user] = await ctx.db.select({ id: schema.users.id }).from(schema.users)
      await ctx.db.insert(schema.trackRatings).values({ userId: user!.id, trackId, rating })
    }

    it('lists oldest first by offset, with no older play to point at', async () => {
      const body = await json(await get('/api/v1/history/plays?order=oldest&limit=2&offset=0'))
      expect(at(body)).toEqual(['2026-09-21T11:40:00.000Z', '2026-09-21T11:45:00.000Z'])
      expect(body).toMatchObject({ total: 3, olderPlayedAt: null })
      expect(at(await json(await get('/api/v1/history/plays?order=oldest&limit=2&offset=2')))).toEqual(['2026-09-21T11:50:00.000Z'])
      // Cursors only go newest first.
      expect((await get('/api/v1/history/plays?order=oldest')).status).toBe(400)
    })

    it('keeps only plays of rated or unrated tracks', async () => {
      await rate('b', 4)
      expect(at(await json(await get('/api/v1/history/plays?rated=yes')))).toEqual(['2026-09-21T11:45:00.000Z'])
      expect(at(await json(await get('/api/v1/history/plays?rated=no&offset=0')))).toEqual([
        '2026-09-21T11:50:00.000Z',
        '2026-09-21T11:40:00.000Z',
      ])
    })

    it('keeps only plays of tracks first played since newSince', async () => {
      // Song A was first played at 11:40, so from 11:42 only Song B is new.
      const body = await json(await get('/api/v1/history/plays?since=2026-09-21T11:42:00.000Z&newSince=2026-09-21T11:42:00.000Z&offset=0'))
      expect(at(body)).toEqual(['2026-09-21T11:45:00.000Z'])
      expect(body.total).toBe(1)
    })

    it('keeps only plays from one context', async () => {
      expect(at(await json(await get('/api/v1/history/plays?context=spotify:playlist:pl-1')))).toEqual(['2026-09-21T11:50:00.000Z'])
      expect((await get('/api/v1/history/plays?context=not-a-uri')).status).toBe(400)
    })
  })

  describe('GET /api/v1/history/tracks', () => {
    beforeEach(async () => {
      ctx.spotify.getRecentlyPlayed.mockResolvedValue({
        items: [
          play(songB, '2026-09-21T11:55:00.000Z'),
          play(songA, '2026-09-21T11:50:00.000Z', playlistContext('pl-1')),
          play(songB, '2026-09-21T11:45:00.000Z'),
          play(songA, '2026-09-21T11:40:00.000Z'),
          play(songA, '2026-09-21T11:35:00.000Z'),
        ],
        cursors: null,
      })
      await sync()
    })

    it('lists the tracks most played first, counting only the plays the filters keep', async () => {
      const all = await json(await get('/api/v1/history/tracks'))
      expect(all.total).toBe(2)
      expect(all.items.map((item: { track: { id: string }; playCount: number }) => [item.track.id, item.playCount])).toEqual([
        ['a', 3],
        ['b', 2],
      ])
      expect(all.items[0]).toMatchObject({
        track: { name: 'Song A', artists: [{ name: 'Band' }, { name: 'Guest' }] },
        firstPlayedAt: '2026-09-21T11:35:00.000Z',
        lastPlayedAt: '2026-09-21T11:50:00.000Z',
      })

      // From 11:42, Song B leads, with Song A's one play then.
      const later = await json(await get('/api/v1/history/tracks?since=2026-09-21T11:42:00.000Z'))
      expect(later.items.map((item: { track: { id: string }; playCount: number }) => [item.track.id, item.playCount])).toEqual([
        ['b', 2],
        ['a', 1],
      ])
      expect(later.items[1]).toMatchObject({ firstPlayedAt: '2026-09-21T11:50:00.000Z', lastPlayedAt: '2026-09-21T11:50:00.000Z' })

      // Pages by offset.
      const second = await json(await get('/api/v1/history/tracks?limit=1&offset=1'))
      expect(second).toMatchObject({ total: 2, items: [{ track: { id: 'b' } }] })
    })
  })

  describe('GET /api/v1/history/contexts', () => {
    it('lists where the plays came from, most first, leaving out plays from nowhere', async () => {
      ctx.spotify.getRecentlyPlayed.mockResolvedValue({
        items: [
          play(songA, '2026-09-21T11:50:00.000Z', playlistContext('pl-1')),
          play(songB, '2026-09-21T11:45:00.000Z', playlistContext('pl-2')),
          play(songA, '2026-09-21T11:40:00.000Z', playlistContext('pl-2')),
          play(songB, '2026-09-21T11:35:00.000Z'),
        ],
        cursors: null,
      })
      await sync()
      const body = await json(await get('/api/v1/history/contexts'))
      expect(body.contexts).toEqual([
        { context: { type: 'playlist', uri: 'spotify:playlist:pl-2', name: 'Playlist pl-2', imageUrl: 'https://i.scdn.co/pl-2' }, plays: 2 },
        { context: expect.objectContaining({ uri: 'spotify:playlist:pl-1' }), plays: 1 },
      ])
      // With the other filters.
      const later = await json(await get('/api/v1/history/contexts?since=2026-09-21T11:48:00.000Z'))
      expect(later.contexts).toEqual([{ context: expect.objectContaining({ uri: 'spotify:playlist:pl-1' }), plays: 1 }])
    })
  })

  describe('GET /api/v1/history/timeline', () => {
    beforeEach(async () => {
      ctx.spotify.getRecentlyPlayed.mockResolvedValue({
        items: [
          play(songA, '2026-09-21T11:50:00.000Z'),
          play(songB, '2026-09-01T03:00:00.000Z'), // still August in Los Angeles
          play(songA, '2026-08-15T12:00:00.000Z'),
          play(songA, '2019-03-10T12:00:00.000Z'),
          play(songB, '2011-12-31T23:30:00.000Z'), // New Year's Day in Berlin
        ],
        cursors: null,
      })
      await sync()
    })

    it('counts plays per month, newest first, leaving out empty months', async () => {
      expect(await json(await get('/api/v1/history/timeline?tz=UTC'))).toEqual({
        months: [
          { month: '2026-09', plays: 2 },
          { month: '2026-08', plays: 1 },
          { month: '2019-03', plays: 1 },
          { month: '2011-12', plays: 1 },
        ],
      })
    })

    it('draws month boundaries in the given time zone', async () => {
      const la = await json(await get('/api/v1/history/timeline?tz=America/Los_Angeles'))
      expect(la.months.slice(0, 2)).toEqual([
        { month: '2026-09', plays: 1 },
        { month: '2026-08', plays: 2 },
      ])
      const berlin = await json(await get('/api/v1/history/timeline?tz=Europe/Berlin'))
      expect(berlin.months.at(-1)).toEqual({ month: '2012-01', plays: 1 })
    })

    it('only counts the signed-in user’s plays', async () => {
      ctx.spotify.getCurrentUser.mockResolvedValueOnce({ id: 'someone-else', display_name: null, images: [] })
      const { token } = await ctx.login()
      const res = await ctx.app.request('/api/v1/history/timeline', { headers: { Cookie: `rc_session=${token}` } })
      expect(await json(res)).toEqual({ months: [] })
    })

    it('rejects an unknown time zone', async () => {
      const res = await get('/api/v1/history/timeline?tz=Mars/Olympus')
      expect(res.status).toBe(400)
      expect((await json(res)).issues[0].path).toBe('tz')
    })
  })

  // The test clock is 2026-09-21T12:00:00Z.
  describe('GET /api/v1/history/on-this-day', () => {
    const others = [1, 2, 3, 4, 5, 6].map((n) => track(`x${n}`, { name: `Extra ${n}` }))

    beforeEach(async () => {
      ctx.spotify.getRecentlyPlayed.mockResolvedValue({
        items: [
          play(songA, '2026-09-21T11:00:00.000Z'), // today: not an earlier year
          play(songA, '2025-09-22T01:00:00.000Z'), // the 22nd in UTC, still the 21st in Los Angeles
          play(songB, '2025-09-21T20:00:00.000Z'),
          play(songA, '2025-09-21T19:00:00.000Z'),
          play(songA, '2025-09-21T18:00:00.000Z'),
          play(songB, '2024-09-20T18:00:00.000Z'), // another day
          // Six tracks in 2022, the last one twice: five are listed, most played first.
          ...others.map((t, n) => play(t, `2022-09-21T1${n}:00:00.000Z`)),
          play(others[5]!, '2022-09-21T17:00:00.000Z'),
          play(songB, '2024-02-29T12:00:00.000Z'),
          play(songA, '2025-02-28T12:00:00.000Z'),
        ],
        cursors: null,
      })
      await sync()
    })

    it('lists earlier years on this day, newest first, with their most played tracks', async () => {
      await ctx.app.request('/api/v1/tracks/a/rating', {
        method: 'PUT',
        headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: 5 }),
      })
      const body = await json(await get('/api/v1/history/on-this-day?tz=UTC'))
      expect(body.date).toBe('2026-09-21')
      expect(body.years.map((y: { year: number; date: string; plays: number }) => [y.year, y.date, y.plays])).toEqual([
        [2025, '2025-09-21', 3],
        [2022, '2022-09-21', 7],
      ])
      expect(body.years[0].tracks).toEqual([
        {
          plays: 2,
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
            genres: [],
            rating: 5,
          },
        },
        { plays: 1, track: expect.objectContaining({ id: 'b', rating: null }) },
      ])
      // Ties go to the track played first that day.
      expect(body.years[1].tracks.map((t: { track: { id: string }; plays: number }) => [t.track.id, t.plays])).toEqual([
        ['x6', 2],
        ['x1', 1],
        ['x2', 1],
        ['x3', 1],
        ['x4', 1],
      ])
    })

    it('uses the user’s local day', async () => {
      const body = await json(await get('/api/v1/history/on-this-day?date=2026-09-21&tz=America/Los_Angeles'))
      expect(body.years[0]).toMatchObject({ year: 2025, plays: 4 })
    })

    it('looks back at leap years only from 29 February', async () => {
      const leap = await json(await get('/api/v1/history/on-this-day?date=2028-02-29&tz=UTC'))
      expect(leap.years.map((y: { date: string }) => y.date)).toEqual(['2024-02-29'])
      const plain = await json(await get('/api/v1/history/on-this-day?date=2027-02-28&tz=UTC'))
      expect(plain.years.map((y: { date: string }) => y.date)).toEqual(['2025-02-28'])
    })

    it('is empty with nothing to look back on', async () => {
      expect(await json(await get('/api/v1/history/on-this-day?date=2026-01-15&tz=UTC'))).toEqual({ date: '2026-01-15', years: [] })
      await ctx.db.delete(schema.plays)
      expect((await json(await get('/api/v1/history/on-this-day'))).years).toEqual([])
    })

    it('rejects a date that isn’t on the calendar', async () => {
      for (const date of ['2026-02-30', 'today', '2026-9-1']) {
        const res = await get(`/api/v1/history/on-this-day?date=${date}`)
        expect(res.status).toBe(400)
        expect((await json(res)).issues[0].path).toBe('date')
      }
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
