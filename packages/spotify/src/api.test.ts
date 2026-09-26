import { describe, expect, it, vi } from 'vitest'
import {
  addToQueue,
  getDevices,
  getPlaybackState,
  pause,
  play,
  removePlaylistItems,
  reorderPlaylistItems,
  seek,
  setRepeat,
  setShuffle,
  setVolume,
  skipToNext,
  skipToPrevious,
  SpotifyApiError,
  spotifyGet,
  transferPlayback,
} from './api.ts'
import { pickImage } from './images.ts'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

describe('spotifyGet', () => {
  it('sends the bearer token and returns JSON', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(200, { id: 'me' }))
    await expect(spotifyGet('/me', 'token-1', { fetchFn })).resolves.toEqual({ id: 'me' })
    expect(fetchFn).toHaveBeenCalledWith('https://api.spotify.com/v1/me', {
      method: 'GET',
      headers: { Authorization: 'Bearer token-1' },
    })
  })

  it('waits out a short Retry-After and retries', async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => {})
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json(429, {}, { 'Retry-After': '2' }))
      .mockResolvedValueOnce(json(200, { ok: true }))

    await expect(spotifyGet('/x', 't', { fetchFn, sleep })).resolves.toEqual({ ok: true })
    expect(sleep).toHaveBeenCalledWith(2000)
  })

  it('gives up on a long Retry-After and reports it', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(429, {}, { 'Retry-After': '120' }))
    const error = await spotifyGet('/x', 't', { fetchFn, sleep: async () => {} }).catch((e) => e)
    expect(error).toBeInstanceOf(SpotifyApiError)
    expect(error).toMatchObject({ status: 429, retryAfter: 120 })
    expect(fetchFn).toHaveBeenCalledOnce()
  })

  it('throws SpotifyApiError with the status on other failures', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(404, { error: { status: 404 } }))
    await expect(spotifyGet('/playlists/x', 't', { fetchFn })).rejects.toMatchObject({ status: 404 })
  })
})

describe('pickImage', () => {
  const images = [
    { url: 'L', width: 640, height: 640 },
    { url: 'M', width: 300, height: 300 },
    { url: 'S', width: 64, height: 64 },
  ]

  it('picks the smallest image at least as wide as the target', () => {
    expect(pickImage(images, 64)).toBe('S')
    expect(pickImage(images, 200)).toBe('M')
    expect(pickImage(images, 1000)).toBe('L')
  })

  it('handles missing or unsized images', () => {
    expect(pickImage([], 64)).toBeNull()
    expect(pickImage(null, 64)).toBeNull()
    expect(pickImage([{ url: 'U', width: null, height: null }], 64)).toBe('U')
  })
})

describe('playlist writes', () => {
  it('removes with the Feb 2026 `items` body', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(200, { snapshot_id: 's2' }))
    await expect(removePlaylistItems('t', 'pl', ['spotify:track:a'], { fetchFn })).resolves.toEqual({ snapshot_id: 's2' })
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://api.spotify.com/v1/playlists/pl/items')
    expect(init?.method).toBe('DELETE')
    expect(JSON.parse(init?.body as string)).toEqual({ items: [{ uri: 'spotify:track:a' }] })
  })

  it('reorders with range_start / insert_before', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(200, { snapshot_id: 's3' }))
    await reorderPlaylistItems('t', 'pl', { rangeStart: 4, insertBefore: 0, snapshotId: 's2' }, { fetchFn })
    const [, init] = fetchFn.mock.calls[0]!
    expect(init?.method).toBe('PUT')
    expect(JSON.parse(init?.body as string)).toEqual({ range_start: 4, insert_before: 0, range_length: 1, snapshot_id: 's2' })
  })
})

describe('spotifyRequest', () => {
  it('handles a 200 with an empty body', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 200 }))
    const { spotifyRequest } = await import('./api.ts')
    await expect(spotifyRequest('PUT', '/playlists/pl', 't', { fetchFn, body: { name: 'x' } })).resolves.toBeUndefined()
  })
})

describe('player', () => {
  const noContent = () => new Response(null, { status: 204 })
  const call = (fetchFn: ReturnType<typeof vi.fn<typeof fetch>>) => {
    const [url, init] = fetchFn.mock.calls[0]!
    return { url, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined }
  }

  it('reads playback state, and null when nothing is active (204)', async () => {
    const state = { is_playing: true, progress_ms: 1000, item: { type: 'track', id: 't1' } }
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValueOnce(json(200, state)).mockResolvedValueOnce(noContent())
    await expect(getPlaybackState('t', { fetchFn })).resolves.toEqual(state)
    await expect(getPlaybackState('t', { fetchFn })).resolves.toBeNull()
    expect(call(fetchFn).url).toBe('https://api.spotify.com/v1/me/player?additional_types=track,episode')
  })

  it('unwraps the device list', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(200, { devices: [{ id: 'd1', name: 'Laptop' }] }))
    await expect(getDevices('t', { fetchFn })).resolves.toEqual([{ id: 'd1', name: 'Laptop' }])
  })

  it('plays tracks or a context on a device, in Spotify field names', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(noContent())
    await play('t', { deviceId: 'd 1', contextUri: 'spotify:playlist:p1', offset: { position: 3 }, positionMs: 0 }, { fetchFn })
    expect(call(fetchFn)).toEqual({
      url: 'https://api.spotify.com/v1/me/player/play?device_id=d+1',
      method: 'PUT',
      body: { context_uri: 'spotify:playlist:p1', offset: { position: 3 }, position_ms: 0 },
    })
  })

  it('resumes with no body when given nothing to play', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(noContent())
    await play('t', {}, { fetchFn })
    expect(call(fetchFn)).toEqual({ url: 'https://api.spotify.com/v1/me/player/play', method: 'PUT', body: undefined })
  })

  it('puts command arguments in the query string', async () => {
    const cases: Array<[(fetchFn: typeof fetch) => Promise<void>, string, string]> = [
      [(fetchFn) => pause('t', {}, { fetchFn }), 'PUT', '/me/player/pause'],
      [(fetchFn) => skipToNext('t', { deviceId: 'd1' }, { fetchFn }), 'POST', '/me/player/next?device_id=d1'],
      [(fetchFn) => skipToPrevious('t', {}, { fetchFn }), 'POST', '/me/player/previous'],
      [(fetchFn) => seek('t', 61_000, {}, { fetchFn }), 'PUT', '/me/player/seek?position_ms=61000'],
      [(fetchFn) => setRepeat('t', 'context', {}, { fetchFn }), 'PUT', '/me/player/repeat?state=context'],
      [(fetchFn) => setShuffle('t', true, {}, { fetchFn }), 'PUT', '/me/player/shuffle?state=true'],
      [(fetchFn) => setVolume('t', 40, {}, { fetchFn }), 'PUT', '/me/player/volume?volume_percent=40'],
      [(fetchFn) => addToQueue('t', 'spotify:track:abc', {}, { fetchFn }), 'POST', '/me/player/queue?uri=spotify%3Atrack%3Aabc'],
    ]
    for (const [run, method, path] of cases) {
      const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(noContent())
      await run(fetchFn)
      expect(call(fetchFn)).toEqual({ url: `https://api.spotify.com/v1${path}`, method, body: undefined })
    }
  })

  it('transfers playback with the device in a list', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(noContent())
    await transferPlayback('t', 'd2', { play: true }, { fetchFn })
    expect(call(fetchFn)).toEqual({ url: 'https://api.spotify.com/v1/me/player', method: 'PUT', body: { device_ids: ['d2'], play: true } })
  })

  it('ignores a text body on a successful command', async () => {
    // Seen from PUT /me/player/pause: 200 with a plain-text id instead of the documented 204.
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('BBSLUQyGnZ0x3kVwB2P', { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } }),
    )
    await expect(pause('t', {}, { fetchFn })).resolves.toBeUndefined()
  })

  it("keeps Spotify's reason when a command fails", async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      json(404, { error: { status: 404, message: 'Player command failed: No active device found', reason: 'NO_ACTIVE_DEVICE' } }),
    )
    const error = await pause('t', {}, { fetchFn }).catch((e) => e)
    expect(error).toBeInstanceOf(SpotifyApiError)
    expect(error).toMatchObject({ status: 404, reason: 'NO_ACTIVE_DEVICE' })
    expect(error.message).toMatch(/No active device found/)
  })

  it('copes with an error body that is not JSON', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response('Bad gateway', { status: 502 }))
    await expect(skipToNext('t', {}, { fetchFn })).rejects.toMatchObject({ status: 502, reason: undefined })
  })
})
