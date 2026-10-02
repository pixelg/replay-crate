import { schema } from '@replay-crate/db'
import { SpotifyApiError } from '@replay-crate/spotify'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReauthRequiredError } from '../spotify/access-token.ts'
import { upsertCatalog } from '../sync/catalog.ts'
import { createTestContext, episode, paged, playlist, playlistEntry, tokens, track } from '../testing.ts'

const ORIGIN = 'http://127.0.0.1:5173'

describe('player', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string

  beforeEach(async () => {
    ctx = await createTestContext()
    cookie = `rc_session=${(await ctx.login()).token}`
  })
  afterEach(() => ctx.close())

  // oxlint-disable-next-line typescript/no-explicit-any
  const json = (res: Response): Promise<any> => res.json()
  const get = (path: string) => ctx.app.request(`/api/v1/player${path}`, { headers: { Cookie: cookie } })
  const send = (method: string, path: string, body: unknown = {}) =>
    ctx.app.request(`/api/v1/player${path}`, {
      method,
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

  const song = track('song', { name: 'Brass Monkey Business', album: ['dusty', 'Dusty Grooves'], artists: [['loop', 'The Loop Collective']] })

  describe('GET /player', () => {
    it('is null when no device is active', async () => {
      ctx.player.deactivate()
      expect(await json(await get(''))).toEqual({ playback: null })
    })

    it('reports the device, item and progress', async () => {
      ctx.player.nowPlaying(song, { positionMs: 30_000 })
      ctx.advance(5_000)
      const { playback } = await json(await get(''))
      expect(playback).toMatchObject({
        device: { id: 'laptop', name: 'Laptop', isActive: true, supportsVolume: true, volumePercent: 70 },
        isPlaying: true,
        progressMs: 35_000,
        shuffle: false,
        repeat: 'off',
        context: null,
        item: {
          type: 'track',
          id: 'song',
          uri: 'spotify:track:song',
          name: 'Brass Monkey Business',
          album: { id: 'dusty', name: 'Dusty Grooves' },
          artists: [{ id: 'loop', name: 'The Loop Collective' }],
        },
      })
      expect(playback.disallows).toContain('skipping_prev')
    })

    it('adds a new track to the catalog so it can be linked', async () => {
      ctx.player.nowPlaying(song)
      await get('')
      const [row] = await ctx.db.select().from(schema.tracks).where(eq(schema.tracks.id, 'song'))
      expect(row).toMatchObject({ name: 'Brass Monkey Business', albumId: 'dusty' })
      expect((await ctx.app.request('/api/v1/tracks/song', { headers: { Cookie: cookie } })).status).toBe(200)
    })

    it('names the context when the app knows it', async () => {
      ctx.library.add('mix', [song], 'Late Night Crate')
      await ctx.db.insert(schema.contexts).values({ uri: 'spotify:playlist:mix', type: 'playlist', name: 'Late Night Crate' })
      await send('PUT', '/play', { contextUri: 'spotify:playlist:mix' })
      const { playback } = await json(await get(''))
      expect(playback.context).toEqual({ type: 'playlist', uri: 'spotify:playlist:mix', name: 'Late Night Crate', imageUrl: null })
      expect(playback.fromQueue).toBe(false)
    })

    it("names a renamed playlist by its new name once it's synced", async () => {
      ctx.library.add('mix', [song], 'Late Night Crate')
      await ctx.db.insert(schema.contexts).values({ uri: 'spotify:playlist:mix', type: 'playlist', name: 'Picked from history' })
      ctx.spotify.getMyPlaylists.mockImplementation(async (_token, offset) =>
        paged([playlist('mix', { name: 'Fresh Beats', total: 1 })])(offset),
      )
      ctx.spotify.getPlaylistItems.mockImplementation(async (_token, _id, offset) => paged([playlistEntry(song)])(offset))
      expect((await ctx.app.request('/api/v1/playlists/sync', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN } })).status).toBe(200)

      await send('PUT', '/play', { contextUri: 'spotify:playlist:mix' })
      expect((await json(await get(''))).playback.context).toMatchObject({ name: 'Fresh Beats' })
    })

    it('says when the item was queued rather than played from the context it reports', async () => {
      const [one, two, queued] = [track('one'), track('two'), track('queued')]
      ctx.library.add('kept', [one!, two!])
      ctx.library.add('theirs', [one!, two!])
      ctx.library.remember([queued!])
      await upsertCatalog(ctx.db, [one!, two!, queued!])
      await ctx.db.insert(schema.playlists).values({ id: 'kept', ownerId: 'me', name: 'Kept', snapshotId: 's1', itemsSnapshotId: 's1' })
      await ctx.db.insert(schema.playlistItems).values([one!, two!].map((t, position) => ({ playlistId: 'kept', position, trackId: t.id! })))
      const fromQueue = async () => (await json(await get(''))).playback.fromQueue

      await send('PUT', '/play', { contextUri: 'spotify:playlist:kept', offset: { position: 0 } })
      expect(await fromQueue()).toBe(false)
      await send('POST', '/queue', { uri: 'spotify:track:queued' })
      await send('POST', '/next')
      expect(ctx.player.state.context).toMatchObject({ uri: 'spotify:playlist:kept' })
      expect(await fromQueue()).toBe(true)
      await send('POST', '/next')
      expect(await fromQueue()).toBe(false)

      // Changed since its items were synced: it may hold the track now.
      await ctx.db.update(schema.playlists).set({ snapshotId: 's2' })
      await send('POST', '/queue', { uri: 'spotify:track:queued' })
      await send('POST', '/next')
      expect(await fromQueue()).toBe(false)

      // Someone else's playlist can't be looked into.
      await send('PUT', '/play', { contextUri: 'spotify:playlist:theirs', offset: { position: 0 } })
      await send('POST', '/queue', { uri: 'spotify:track:queued' })
      await send('POST', '/next')
      expect(await fromQueue()).toBe(false)

      // An album holds its own tracks.
      await send('PUT', '/play', { item: 'spotify:track:one' })
      expect(ctx.player.state.context?.type).toBe('album')
      expect(await fromQueue()).toBe(false)
      await send('POST', '/queue', { uri: 'spotify:track:queued' })
      await send('POST', '/next')
      expect(await fromQueue()).toBe(true)
    })
  })

  it('lists devices and what is up next', async () => {
    ctx.player.nowPlaying(song, { upcoming: [track('next')] })
    const { devices } = await json(await get('/devices'))
    expect(devices.map((d: { id: string; isActive: boolean }) => [d.id, d.isActive])).toEqual([
      ['laptop', true],
      ['phone', false],
    ])
    const queue = await json(await get('/queue'))
    expect(queue.currentlyPlaying).toMatchObject({ id: 'song' })
    // Then Spotify's padding: the seeded song has no context.
    expect(queue.queue[0]).toMatchObject({ id: 'next' })
  })

  describe('GET /player/queue', () => {
    const upNext = async () => (await json(await get('/queue'))).queue.map((item: { id: string }) => item.id)

    // The clients know the context and repeat mode, so they drop the padding (upNext()).
    it("passes on Spotify's padding when tracks play without a context", async () => {
      await send('PUT', '/play', { uris: ['spotify:track:a', 'spotify:track:b'] })
      await send('POST', '/queue', { uri: 'spotify:track:q' })
      const [queued, next, ...padding] = await upNext()
      expect([queued, next]).toEqual(['q', 'b'])
      expect(padding.length).toBeGreaterThan(1)
      expect(new Set(padding)).toEqual(new Set(['a']))
    })

    it('lists the rest of the context', async () => {
      ctx.library.add('mix', [track('one'), track('two'), track('three')], 'Late Night Crate')
      await send('PUT', '/play', { contextUri: 'spotify:playlist:mix', offset: { uri: 'spotify:track:one' } })
      expect(await upNext()).toEqual(['two', 'three'])
    })
  })

  describe('devices', () => {
    const DAY = 24 * 60 * 60_000
    const listed = async () =>
      (await json(await get('/devices'))).devices as { id: string | null; name: string; isAvailable: boolean; lastSeenAt: string; rememberedId: number }[]
    const remembered = () => ctx.db.select().from(schema.playerDevices).orderBy(schema.playerDevices.id)

    it('remembers the active device from playback', async () => {
      await get('')
      expect(await remembered()).toMatchObject([{ deviceId: 'laptop', name: 'Laptop', type: 'Computer', lastSeenAt: new Date('2026-09-21T12:00:00Z') }])
    })

    it("doesn't fail playback when remembering the device does", async () => {
      await ctx.db.execute(sql`drop table player_devices`)
      const res = await get('')
      expect(res.status).toBe(200)
      expect((await json(res)).playback).toMatchObject({ device: { id: 'laptop' } })
    })

    it('remembers every listed device, and marks them available', async () => {
      const devices = await listed()
      expect(devices).toMatchObject([
        { id: 'laptop', isActive: true, isAvailable: true, lastSeenAt: '2026-09-21T12:00:00.000Z' },
        { id: 'phone', isActive: false, isAvailable: true, lastSeenAt: '2026-09-21T12:00:00.000Z' },
      ])
      expect((await remembered()).map((row) => [row.id, row.deviceId])).toEqual(devices.map((d) => [d.rememberedId, d.id]))
    })

    it('lists devices played on before after the available ones, most recent first', async () => {
      ctx.player.connect({ id: 'kitchen', name: 'Kitchen', type: 'Speaker', volume_percent: 40, supports_volume: true })
      await get('/devices')
      ctx.player.disconnect('kitchen')
      ctx.advance(DAY)
      await get('/devices')
      ctx.player.disconnect('phone')
      ctx.advance(DAY)

      expect(await listed()).toEqual([
        expect.objectContaining({ id: 'laptop', isAvailable: true, lastSeenAt: '2026-09-23T12:00:00.000Z' }),
        {
          id: 'phone',
          name: 'Phone',
          type: 'Smartphone',
          isActive: false,
          isRestricted: false,
          isPrivateSession: false,
          volumePercent: null,
          supportsVolume: false,
          isAvailable: false,
          lastSeenAt: '2026-09-22T12:00:00.000Z',
          rememberedId: expect.any(Number),
        },
        expect.objectContaining({ id: 'kitchen', isAvailable: false, lastSeenAt: '2026-09-21T12:00:00.000Z' }),
      ])
    })

    it('keeps one entry for a device that gets a new id each session', async () => {
      const webPlayer = { name: 'Web Player (Chrome)', type: 'Computer', volume_percent: 100, supports_volume: true }
      ctx.player.connect({ id: 'web-1', ...webPlayer })
      await get('/devices')
      ctx.player.disconnect('web-1')
      ctx.player.connect({ id: 'web-2', ...webPlayer })

      const devices = await listed()
      expect(devices.map((d) => [d.id, d.isAvailable])).toEqual([
        ['laptop', true],
        ['phone', true],
        ['web-2', true],
      ])
      expect((await remembered()).map((row) => row.deviceId)).toEqual(['laptop', 'phone', 'web-2'])
    })

    it('keeps devices apart that share a name and are listed together', async () => {
      ctx.player.connect({ id: 'phone-2', name: 'Phone', type: 'Smartphone', volume_percent: 100, supports_volume: false })
      await get('/devices')
      await get('/devices')
      expect((await remembered()).map((row) => row.deviceId)).toEqual(['laptop', 'phone', 'phone-2'])
    })

    it('remembers a device Spotify cannot address, without a way to play on it', async () => {
      ctx.spotify.getDevices.mockResolvedValueOnce([
        { id: null, name: 'Car', type: 'Automobile', is_active: false, is_private_session: false, is_restricted: true, volume_percent: null, supports_volume: false },
      ])
      await get('/devices')
      expect((await listed()).find((d) => d.name === 'Car')).toMatchObject({ id: null, isAvailable: false })
    })

    it('keeps last seen current without writing on every poll', async () => {
      await get('')
      ctx.advance(30_000)
      await get('')
      expect((await remembered())[0]!.lastSeenAt).toEqual(new Date('2026-09-21T12:00:00Z'))
      ctx.advance(60_000)
      await get('')
      expect((await remembered())[0]!.lastSeenAt).toEqual(new Date('2026-09-21T12:01:30Z'))
    })

    it('are forgotten on request, until seen again', async () => {
      await get('/devices')
      ctx.player.disconnect('phone')
      const phone = (await listed()).find((d) => d.id === 'phone')!

      const forget = () =>
        ctx.app.request(`/api/v1/player/devices/${phone.rememberedId}`, { method: 'DELETE', headers: { Cookie: cookie, Origin: ORIGIN } })
      expect((await forget()).status).toBe(204)
      expect((await listed()).map((d) => d.id)).toEqual(['laptop'])
      const res = await forget()
      expect(res.status).toBe(404)
      expect(await json(res)).toEqual({ error: 'not_found' })
    })

    it("can't be played on while Spotify doesn't list them", async () => {
      await get('/devices')
      ctx.player.disconnect('phone')
      const res = await send('PUT', '/device', { deviceId: 'phone', play: true })
      expect(res.status).toBe(404)
      expect(await json(res)).toEqual({ error: 'not_found' })
      expect(ctx.player.state.activeDeviceId).toBe('laptop')
    })
  })

  describe('commands', () => {
    it('play tracks, then pause, skip, seek and queue', async () => {
      expect((await send('PUT', '/play', { uris: ['spotify:track:a', 'spotify:track:b'] })).status).toBe(204)
      expect(ctx.spotify.play).toHaveBeenCalledWith('access-1', { uris: ['spotify:track:a', 'spotify:track:b'], deviceId: undefined })
      expect(ctx.player.state).toMatchObject({ isPlaying: true, item: { id: 'a' } })

      expect((await send('POST', '/queue', { uri: 'spotify:track:q' })).status).toBe(204)
      expect((await send('POST', '/next')).status).toBe(204)
      expect(ctx.player.state.item?.id).toBe('q')

      expect((await send('PUT', '/seek', { positionMs: 90_000 })).status).toBe(204)
      expect(ctx.player.state.progressMs).toBe(90_000)

      expect((await send('PUT', '/pause')).status).toBe(204)
      expect(ctx.player.state.isPlaying).toBe(false)
      expect((await send('PUT', '/play')).status).toBe(204)
      expect(ctx.player.state.isPlaying).toBe(true)

      expect((await send('POST', '/previous')).status).toBe(204)
    })

    it('set shuffle, repeat and volume, and move playback', async () => {
      ctx.player.nowPlaying(song)
      expect((await send('PUT', '/shuffle', { on: true })).status).toBe(204)
      expect((await send('PUT', '/repeat', { state: 'context' })).status).toBe(204)
      expect((await send('PUT', '/volume', { percent: 25 })).status).toBe(204)
      expect(ctx.player.state).toMatchObject({ shuffle: true, repeat: 'context' })

      expect((await send('PUT', '/device', { deviceId: 'phone', play: true })).status).toBe(204)
      expect(ctx.spotify.transferPlayback).toHaveBeenCalledWith('access-1', 'phone', { play: true })
      expect((await json(await get(''))).playback.device.id).toBe('phone')
    })

    it('send a command to a named device', async () => {
      ctx.player.deactivate()
      expect((await send('PUT', '/play', { uris: ['spotify:track:a'], deviceId: 'phone' })).status).toBe(204)
      expect(ctx.player.state.activeDeviceId).toBe('phone')
    })

    it('validate their bodies', async () => {
      const res = await send('PUT', '/volume', { percent: 150 })
      expect(res.status).toBe(400)
      expect(await json(res)).toMatchObject({ error: 'invalid_request', issues: [{ path: 'percent' }] })
    })

    it('need a same-origin request', async () => {
      const res = await ctx.app.request('/api/v1/player/pause', {
        method: 'PUT',
        headers: { Cookie: cookie, Origin: 'https://evil.example', 'Content-Type': 'application/json' },
        body: '{}',
      })
      expect(res.status).toBe(403)
    })
  })

  describe('playing one item', () => {
    const side = track('side', { album: ['dusty', 'Dusty Grooves'] })
    const userId = async () => (await ctx.db.select({ id: schema.users.id }).from(schema.users))[0]!.id
    /** A play of `played` from `playlistId` on Spotify, as a sync records it. */
    const playedFrom = async (playlistId: string, played = song, at = '2026-09-20T10:00:00Z') => {
      await upsertCatalog(ctx.db, [played])
      await ctx.db.insert(schema.plays).values({
        userId: await userId(),
        trackId: played.id!,
        playedAt: new Date(at),
        contextType: 'playlist',
        contextUri: `spotify:playlist:${playlistId}`,
        source: 'poll',
      })
    }
    const playTracksFrom = async (from: 'album' | 'playlist') =>
      ctx.db.update(schema.users).set({ playTracksFrom: from }).where(eq(schema.users.id, await userId()))

    beforeEach(() => {
      ctx.library.remember([song, side])
    })

    it('plays a track from its album, so Up next is the rest of it', async () => {
      expect((await send('PUT', '/play', { item: 'spotify:track:song' })).status).toBe(204)
      expect(ctx.spotify.play).toHaveBeenCalledWith('access-1', {
        contextUri: 'spotify:album:dusty',
        offset: { uri: 'spotify:track:song' },
        positionMs: undefined,
        deviceId: undefined,
      })
      expect(ctx.player.state).toMatchObject({ isPlaying: true, item: { id: 'song' }, context: { uri: 'spotify:album:dusty' } })
      // A track Replay Crate hadn't seen joins the catalog on the way.
      const [known] = await ctx.db.select().from(schema.tracks).where(eq(schema.tracks.id, 'song'))
      expect(known).toMatchObject({ albumId: 'dusty' })
    })

    it('starts on a phone that ignores bare URIs', async () => {
      ctx.player.nowPlaying(side)
      await send('PUT', '/device', { deviceId: 'phone', play: true })
      expect((await send('PUT', '/play', { item: 'spotify:track:song' })).status).toBe(204)
      expect(ctx.player.state).toMatchObject({ activeDeviceId: 'phone', isPlaying: true, item: { id: 'song' } })
    })

    it('plays a track from the playlist it was last played from, when the user chose that', async () => {
      ctx.library.add('mix', [side, song])
      await playedFrom('older', song, '2026-09-01T10:00:00Z')
      await playedFrom('mix')
      // Albums by default…
      expect((await send('PUT', '/play', { item: 'spotify:track:song' })).status).toBe(204)
      expect(ctx.player.state.context).toMatchObject({ uri: 'spotify:album:dusty' })

      // …and the last playlist on request.
      await playTracksFrom('playlist')
      expect((await send('PUT', '/play', { item: 'spotify:track:song' })).status).toBe(204)
      expect(ctx.player.state).toMatchObject({ item: { id: 'song' }, context: { uri: 'spotify:playlist:mix' }, upcoming: [] })
    })

    it('falls back to the album when the track has left that playlist, or Spotify refuses it', async () => {
      await playTracksFrom('playlist')
      // A playlist whose contents Replay Crate keeps, without the track any more: not tried.
      await playedFrom('kept')
      await ctx.db.insert(schema.playlists).values({ id: 'kept', ownerId: 'me', name: 'Kept', snapshotId: 's1', itemsSnapshotId: 's1' })
      expect((await send('PUT', '/play', { item: 'spotify:track:song' })).status).toBe(204)
      expect(ctx.spotify.play).toHaveBeenCalledTimes(1)
      expect(ctx.player.state.context).toMatchObject({ uri: 'spotify:album:dusty' })

      // Someone else's playlist: tried, and Spotify doesn't know it any more.
      await playedFrom('gone', song, '2026-09-25T10:00:00Z')
      ctx.spotify.play.mockClear()
      expect((await send('PUT', '/play', { item: 'spotify:track:song' })).status).toBe(204)
      expect(ctx.spotify.play.mock.calls.map(([, request]) => request.contextUri)).toEqual(['spotify:playlist:gone', 'spotify:album:dusty'])
      expect(ctx.player.state.context).toMatchObject({ uri: 'spotify:album:dusty' })
    })

    it("counts the album's own copy of the recording as started", async () => {
      // One recording on two releases: the album Replay Crate has the track on now lists its own
      // copy, under another id, and Spotify plays that.
      const isrc = { external_ids: { isrc: 'GBMYF1800060' } }
      const asked = { ...track('asked', { name: 'Cocaine Sunday', album: ['sensitive', 'Sensitive G'] }), ...isrc }
      const copy = { ...track('copy', { name: 'Cocaine Sunday', album: ['sensitive', 'Sensitive G'] }), ...isrc }
      await upsertCatalog(ctx.db, [asked])
      ctx.library.remember([{ ...asked, album: { ...asked.album, id: 'single' } }, copy])
      ctx.player.nowPlaying(side)

      expect((await send('PUT', '/play', { item: 'spotify:track:asked' })).status).toBe(204)
      expect(ctx.player.state).toMatchObject({ isPlaying: true, item: { id: 'copy' }, context: { uri: 'spotify:album:sensitive' } })
      expect(ctx.spotify.getPlaybackState).toHaveBeenCalledTimes(1)
    })

    it('resumes an episode from its show', async () => {
      const ep = episode('ep1', { show: ['gray', 'The Gray Area'] })
      ctx.library.addEpisodes(ep, episode('ep2', { show: ['gray', 'The Gray Area'] }))
      expect((await send('PUT', '/play', { item: 'spotify:episode:ep1', positionMs: 27_000 })).status).toBe(204)
      expect(ctx.spotify.play).toHaveBeenCalledWith('access-1', {
        contextUri: 'spotify:show:gray',
        offset: { uri: 'spotify:episode:ep1' },
        positionMs: 27_000,
        deviceId: undefined,
      })
      expect(ctx.player.state).toMatchObject({ isPlaying: true, item: { id: 'ep1' }, progressMs: 27_000 })
    })

    it("plays the item on its own when there's no context to start from", async () => {
      ctx.spotify.getTrack.mockRejectedValueOnce(new SpotifyApiError(404, 'Non existing id', undefined, 'UNKNOWN'))
      expect((await send('PUT', '/play', { item: 'spotify:track:mystery' })).status).toBe(204)
      expect(ctx.spotify.play).toHaveBeenCalledWith('access-1', { uris: ['spotify:track:mystery'], positionMs: undefined, deviceId: undefined })
    })

    it("says so when the device doesn't start it", async () => {
      ctx.spotify.getTrack.mockRejectedValueOnce(new SpotifyApiError(404, 'Non existing id', undefined, 'UNKNOWN'))
      ctx.player.nowPlaying(side)
      await send('PUT', '/device', { deviceId: 'phone', play: true })
      const res = await send('PUT', '/play', { item: 'spotify:track:mystery' })
      expect(res.status).toBe(409)
      expect(await json(res)).toEqual({ error: 'not_started', device: 'Phone' })
      expect(ctx.spotify.getPlaybackState).toHaveBeenCalledTimes(4)
    })

    it('takes an item or tracks, not both', async () => {
      const res = await send('PUT', '/play', { item: 'spotify:track:song', uris: ['spotify:track:a'] })
      expect(res.status).toBe(400)
      expect(await json(res)).toMatchObject({ error: 'invalid_request', issues: [{ path: 'item' }] })
      expect((await send('PUT', '/play', { item: 'spotify:album:dusty' })).status).toBe(400)
    })
  })

  describe('playing from Up next', () => {
    const [a1, a2, a3, a4] = ['a1', 'a2', 'a3', 'a4'].map((id) => track(id, { album: ['dusty', 'Dusty Grooves'] }))
    const [q1, q2] = [track('q1'), track('q2')]
    const ids = (items: Array<{ id: string | null }>) => items.map((item) => item.id)
    const playNow = (uri: string, index: number) => send('POST', '/queue/play', { uri, index })

    // On the phone, which ignores bare URIs: the album from its first track, with two tracks queued.
    beforeEach(async () => {
      ctx.library.remember([a1!, a2!, a3!, a4!, q1!, q2!])
      await send('PUT', '/device', { deviceId: 'phone' })
      await send('PUT', '/play', { item: 'spotify:track:a1' })
      await send('POST', '/queue', { uri: 'spotify:track:q1' })
      await send('POST', '/queue', { uri: 'spotify:track:q2' })
      ctx.spotify.play.mockClear()
    })

    it("plays one of the album's tracks from the album, keeping the user's queue", async () => {
      expect((await playNow('spotify:track:a3', 3)).status).toBe(204)
      expect(ctx.spotify.play).toHaveBeenCalledWith('access-1', {
        contextUri: 'spotify:album:dusty',
        offset: { uri: 'spotify:track:a3' },
        deviceId: undefined,
      })
      expect(ctx.spotify.skipToNext).not.toHaveBeenCalled()
      const { activeDeviceId, isPlaying, item, queued, upcoming } = ctx.player.state
      expect({ activeDeviceId, isPlaying, item: item?.id, queued: ids(queued), upcoming: ids(upcoming) }).toEqual({
        activeDeviceId: 'phone',
        isPlaying: true,
        item: 'a3',
        queued: ['q1', 'q2'],
        upcoming: ['a4'],
      })
    })

    it('skips to an item the user queued, so Up next stays as it was', async () => {
      expect((await playNow('spotify:track:q2', 1)).status).toBe(204)
      expect(ctx.spotify.skipToNext).toHaveBeenCalledTimes(2)
      expect(ctx.spotify.play).not.toHaveBeenCalled()
      expect(ctx.player.state).toMatchObject({ isPlaying: true, item: { id: 'q2' }, queued: [] })
      expect(ids(ctx.player.state.upcoming)).toEqual(['a2', 'a3', 'a4'])
    })

    it('skips to the very next item, and under shuffle, whose order only skipping keeps', async () => {
      expect((await playNow('spotify:track:q1', 0)).status).toBe(204)
      expect(ctx.spotify.skipToNext).toHaveBeenCalledTimes(1)

      await send('PUT', '/shuffle', { on: true })
      expect((await playNow('spotify:track:a3', 2)).status).toBe(204)
      expect(ctx.spotify.skipToNext).toHaveBeenCalledTimes(4)
      expect(ctx.spotify.play).not.toHaveBeenCalled()
      expect(ctx.player.state).toMatchObject({ item: { id: 'a3' } })
    })

    it("plays from a playlist whose contents Replay Crate keeps, and skips through others'", async () => {
      ctx.library.add('kept', [a4!, q1!, a1!])
      await upsertCatalog(ctx.db, [a4!, q1!, a1!])
      await ctx.db.insert(schema.playlists).values({ id: 'kept', ownerId: 'me', name: 'Kept', snapshotId: 's1', itemsSnapshotId: 's1' })
      await ctx.db.insert(schema.playlistItems).values([a4!, q1!, a1!].map((t, position) => ({ playlistId: 'kept', position, trackId: t.id! })))
      ctx.library.add('theirs', [a4!, q1!, a1!])

      await send('PUT', '/play', { contextUri: 'spotify:playlist:kept', offset: { position: 0 } })
      ctx.spotify.play.mockClear()
      expect((await playNow('spotify:track:a1', 3)).status).toBe(204)
      expect(ctx.spotify.play).toHaveBeenCalledWith('access-1', expect.objectContaining({ contextUri: 'spotify:playlist:kept' }))
      expect(ctx.spotify.skipToNext).not.toHaveBeenCalled()

      await send('PUT', '/play', { contextUri: 'spotify:playlist:theirs', offset: { position: 0 } })
      ctx.spotify.play.mockClear()
      expect((await playNow('spotify:track:a1', 3)).status).toBe(204)
      expect(ctx.spotify.play).not.toHaveBeenCalled()
      expect(ctx.spotify.skipToNext).toHaveBeenCalledTimes(4)
      expect(ctx.player.state).toMatchObject({ isPlaying: true, item: { id: 'a1' } })
    })

    it('finds the item again when the queue has moved, and says when it has gone', async () => {
      await send('POST', '/next')
      expect((await playNow('spotify:track:q2', 1)).status).toBe(204)
      expect(ctx.player.state).toMatchObject({ item: { id: 'q2' } })

      const res = await playNow('spotify:track:q1', 0)
      expect(res.status).toBe(404)
      expect(await json(res)).toEqual({ error: 'not_found' })
    })

    it('resumes when it gets there paused', async () => {
      await send('PUT', '/pause')
      expect((await playNow('spotify:track:q1', 0)).status).toBe(204)
      expect(ctx.spotify.play).toHaveBeenCalledWith('access-1', { deviceId: undefined })
      expect(ctx.player.state).toMatchObject({ isPlaying: true, item: { id: 'q1' } })
    })

    it("says so when the device doesn't get there, without skipping again", async () => {
      ctx.spotify.skipToNext.mockImplementationOnce(async () => {})
      const res = await playNow('spotify:track:q2', 1)
      expect(res.status).toBe(409)
      expect(await json(res)).toEqual({ error: 'not_started', device: 'Phone' })
      expect(ctx.spotify.skipToNext).toHaveBeenCalledTimes(2)
    })
  })

  describe('failures', () => {
    it('no active device', async () => {
      ctx.player.deactivate()
      const res = await send('PUT', '/play', { uris: ['spotify:track:a'] })
      expect(res.status).toBe(409)
      expect(await json(res)).toEqual({ error: 'no_active_device' })
    })

    it('no Premium', async () => {
      ctx.spotify.getPlaybackState.mockRejectedValueOnce(new SpotifyApiError(403, 'Premium required', undefined, 'PREMIUM_REQUIRED'))
      const res = await get('')
      expect(res.status).toBe(403)
      expect(await json(res)).toEqual({ error: 'premium_required' })
    })

    it('a command the device refuses', async () => {
      ctx.player.nowPlaying(song)
      await send('PUT', '/device', { deviceId: 'phone' })
      const res = await send('PUT', '/volume', { percent: 10 })
      expect(res.status).toBe(403)
      expect(await json(res)).toEqual({ error: 'command_refused', reason: 'VOLUME_CONTROL_DISALLOW' })
    })

    it('an unknown device', async () => {
      const res = await send('PUT', '/device', { deviceId: 'toaster' })
      expect(res.status).toBe(404)
      expect(await json(res)).toEqual({ error: 'not_found' })
    })

    it('a user who connected before the player scopes', async () => {
      ctx.spotify.exchangeCode.mockResolvedValueOnce(tokens({ scope: 'user-read-recently-played user-top-read' }))
      cookie = `rc_session=${(await ctx.login()).token}`
      const res = await get('')
      expect(res.status).toBe(403)
      expect(await json(res)).toEqual({
        error: 'missing_scopes',
        scopes: ['user-read-playback-state', 'user-read-currently-playing', 'user-modify-playback-state'],
      })
      expect(ctx.spotify.getPlaybackState).not.toHaveBeenCalled()
    })

    it('Spotify access expired', async () => {
      ctx.spotify.getPlaybackState.mockRejectedValueOnce(new ReauthRequiredError('pixelg'))
      expect(await json(await get(''))).toEqual({ error: 'reauth_required' })
    })

    it('rate limited', async () => {
      ctx.spotify.skipToNext.mockRejectedValueOnce(new SpotifyApiError(429, 'slow down', 30))
      const res = await send('POST', '/next')
      expect(res.status).toBe(503)
      expect(await json(res)).toEqual({ error: 'rate_limited', retryAfter: 30 })
    })

    it('signed out', async () => {
      expect((await ctx.app.request('/api/v1/player')).status).toBe(401)
    })
  })
})
