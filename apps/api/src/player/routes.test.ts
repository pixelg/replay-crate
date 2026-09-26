import { schema } from '@replay-crate/db'
import { SpotifyApiError } from '@replay-crate/spotify'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ReauthRequiredError } from '../spotify/access-token.ts'
import { createTestContext, tokens, track } from '../testing.ts'

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
    expect(queue.queue.map((item: { id: string }) => item.id)).toEqual(['next'])
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
