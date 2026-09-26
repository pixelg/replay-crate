import { describe, expect, it, vi } from 'vitest'
import { ApiError } from './errors.ts'
import { createApiClient } from './index.ts'
import {
  expectedPlayback,
  IDLE_POLL_MS,
  playbackPollInterval,
  PLAYING_POLL_MS,
  progressAt,
  sendPlayerCommand,
  type Playback,
  type PlayerCommand,
} from './player.ts'

const playback = (overrides: Partial<Playback> = {}): Playback => ({
  device: {
    id: 'laptop',
    name: 'Laptop',
    type: 'Computer',
    isActive: true,
    isRestricted: false,
    isPrivateSession: false,
    volumePercent: 70,
    supportsVolume: true,
  },
  isPlaying: true,
  progressMs: 30_000,
  shuffle: false,
  repeat: 'off',
  context: null,
  item: {
    type: 'track',
    id: 't1',
    uri: 'spotify:track:t1',
    name: 'Song',
    durationMs: 200_000,
    explicit: false,
    album: { id: 'a1', name: 'Album', imageUrl: null, thumbUrl: null },
    artists: [],
  },
  disallows: [],
  ...overrides,
})

describe('progressAt', () => {
  it('moves on while playing', () => {
    expect(progressAt(playback(), 1_000, 6_000)).toBe(35_000)
  })

  it('stays put while paused', () => {
    expect(progressAt(playback({ isPlaying: false }), 1_000, 60_000)).toBe(30_000)
  })

  it('stops at the end of the item', () => {
    expect(progressAt(playback(), 0, 10 * 60_000)).toBe(200_000)
  })
})

describe('playbackPollInterval', () => {
  it('polls often while playing and rarely when idle', () => {
    expect(playbackPollInterval(playback(), null)).toBe(PLAYING_POLL_MS)
    expect(playbackPollInterval(playback({ isPlaying: false }), null)).toBe(IDLE_POLL_MS)
    expect(playbackPollInterval(null, null)).toBe(IDLE_POLL_MS)
  })

  it('stops for problems polling cannot fix', () => {
    const error = (status: number, code: string) => new ApiError({ status, code, endpoint: 'GET /api/v1/player' })
    expect(playbackPollInterval(undefined, error(403, 'premium_required'))).toBe(false)
    expect(playbackPollInterval(undefined, error(403, 'missing_scopes'))).toBe(false)
    expect(playbackPollInterval(undefined, error(401, 'unauthorized'))).toBe(false)
    expect(playbackPollInterval(undefined, error(503, 'rate_limited'))).toBe(IDLE_POLL_MS)
  })
})

describe('expectedPlayback', () => {
  const fetchedAt = 1_000
  const now = 11_000

  it('pauses where playback has got to', () => {
    expect(expectedPlayback(playback(), { kind: 'pause' }, fetchedAt, now)).toMatchObject({ isPlaying: false, progressMs: 40_000 })
  })

  it('resumes, but leaves playing something new to Spotify', () => {
    const paused = playback({ isPlaying: false })
    expect(expectedPlayback(paused, { kind: 'play' }, fetchedAt, now)).toMatchObject({ isPlaying: true, progressMs: 30_000 })
    expect(expectedPlayback(paused, { kind: 'play', uris: ['spotify:track:x'] }, fetchedAt, now)).toBe(paused)
  })

  it('applies seek, shuffle, repeat and volume', () => {
    const p = playback()
    expect(expectedPlayback(p, { kind: 'seek', positionMs: 5_000 }, fetchedAt, now).progressMs).toBe(5_000)
    expect(expectedPlayback(p, { kind: 'shuffle', on: true }, fetchedAt, now).shuffle).toBe(true)
    expect(expectedPlayback(p, { kind: 'repeat', state: 'track' }, fetchedAt, now).repeat).toBe('track')
    expect(expectedPlayback(p, { kind: 'volume', percent: 20 }, fetchedAt, now).device.volumePercent).toBe(20)
  })

  it('leaves next and previous to Spotify', () => {
    const p = playback()
    expect(expectedPlayback(p, { kind: 'next' }, fetchedAt, now)).toBe(p)
    expect(expectedPlayback(p, { kind: 'previous' }, fetchedAt, now)).toBe(p)
  })
})

describe('sendPlayerCommand', () => {
  function client(response: Response = new Response(null, { status: 204 })) {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(response)
    return { api: createApiClient('http://127.0.0.1:5173', { fetch }), fetch }
  }
  const sent = async (fetch: ReturnType<typeof client>['fetch']) => {
    const [input, init] = fetch.mock.calls[0]!
    const request = input instanceof Request ? input : new Request(input, init)
    return { method: request.method, path: new URL(request.url).pathname, body: await request.json() }
  }

  it.each<[PlayerCommand, string, string, unknown]>([
    [{ kind: 'play', uris: ['spotify:track:a'] }, 'PUT', '/api/v1/player/play', { uris: ['spotify:track:a'] }],
    [{ kind: 'pause' }, 'PUT', '/api/v1/player/pause', {}],
    [{ kind: 'next', deviceId: 'phone' }, 'POST', '/api/v1/player/next', { deviceId: 'phone' }],
    [{ kind: 'seek', positionMs: 1_000 }, 'PUT', '/api/v1/player/seek', { positionMs: 1_000 }],
    [{ kind: 'volume', percent: 40 }, 'PUT', '/api/v1/player/volume', { percent: 40 }],
    [{ kind: 'queue', uri: 'spotify:track:q' }, 'POST', '/api/v1/player/queue', { uri: 'spotify:track:q' }],
    [{ kind: 'transfer', deviceId: 'phone', play: true }, 'PUT', '/api/v1/player/device', { deviceId: 'phone', play: true }],
  ])('%j', async (command, method, path, body) => {
    const { api, fetch } = client()
    await sendPlayerCommand(api, command)
    expect(await sent(fetch)).toEqual({ method, path, body })
  })

  it("throws the API's error, with Spotify's reason", async () => {
    const { api } = client(Response.json({ error: 'command_refused', reason: 'VOLUME_CONTROL_DISALLOW' }, { status: 403 }))
    const error = await sendPlayerCommand(api, { kind: 'volume', percent: 10 }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 403, code: 'command_refused', reason: 'VOLUME_CONTROL_DISALLOW', endpoint: 'PUT /api/v1/player/volume' })
  })
})
