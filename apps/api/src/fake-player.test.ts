import { SpotifyApiError } from '@replay-crate/spotify'
import { describe, expect, it } from 'vitest'
import { createFakeLibrary, createFakePlayer, track } from './fakes.ts'

const T = 'token'

function setup(options: Partial<Parameters<typeof createFakePlayer>[0]> = {}) {
  let clock = 1_000_000
  const library = createFakeLibrary()
  library.add('mix', [track('a'), track('b'), track('c')])
  const player = createFakePlayer({
    resolveTrack: library.trackFromUri,
    resolveContext: library.contextTracks,
    now: () => clock,
    ...options,
  })
  return { player, p: player.gateway, advance: (ms: number) => (clock += ms) }
}

const reasonOf = (promise: Promise<unknown>) =>
  promise.then(
    () => 'resolved',
    (error: unknown) => (error instanceof SpotifyApiError ? `${error.status} ${error.reason}` : String(error)),
  )

describe('fake player', () => {
  it('reports nothing playing on the active device until something plays', async () => {
    const { p } = setup()
    const state = await p.getPlaybackState(T)
    expect(state).toMatchObject({ device: { id: 'laptop', is_active: true }, is_playing: false, item: null, progress_ms: null })
    await expect(p.getQueue(T)).resolves.toEqual({ currently_playing: null, queue: [] })
  })

  it('plays a playlist from an offset, advances the clock, and pauses', async () => {
    const { p, advance } = setup()
    await p.play(T, { contextUri: 'spotify:playlist:mix', offset: { position: 1 } })
    advance(10_000)
    expect(await p.getPlaybackState(T)).toMatchObject({
      is_playing: true,
      progress_ms: 10_000,
      item: { id: 'b', type: 'track' },
      context: { type: 'playlist', uri: 'spotify:playlist:mix' },
    })
    expect((await p.getQueue(T)).queue.map((item) => item.id)).toEqual(['c'])

    await p.pause(T, {})
    advance(10_000)
    expect(await p.getPlaybackState(T)).toMatchObject({ is_playing: false, progress_ms: 10_000 })
  })

  it('plays queued tracks before the rest of the context, then goes back', async () => {
    const { p } = setup()
    await p.play(T, { contextUri: 'spotify:playlist:mix' })
    await p.addToQueue(T, 'spotify:track:q', {})
    expect((await p.getQueue(T)).queue.map((item) => item.id)).toEqual(['q', 'b', 'c'])

    await p.skipToNext(T, {})
    await p.skipToNext(T, {})
    expect((await p.getPlaybackState(T))?.item?.id).toBe('b')

    await p.skipToPrevious(T, {})
    expect((await p.getPlaybackState(T))?.item?.id).toBe('q')
  })

  it('restarts the item on "previous" once past the first seconds', async () => {
    const { p, advance } = setup()
    await p.play(T, { uris: ['spotify:track:a', 'spotify:track:b'] })
    await p.skipToNext(T, {})
    advance(5_000)
    await p.skipToPrevious(T, {})
    expect(await p.getPlaybackState(T)).toMatchObject({ item: { id: 'b' }, progress_ms: 0 })
  })

  it('stops at the end of the context', async () => {
    const { p } = setup()
    await p.play(T, { uris: ['spotify:track:a'] })
    await p.skipToNext(T, {})
    expect(await p.getPlaybackState(T)).toMatchObject({ is_playing: false, item: { id: 'a' } })
  })

  it('seeks, sets shuffle and repeat, and changes volume where the device allows it', async () => {
    const { p } = setup()
    await p.play(T, { uris: ['spotify:track:a'] })
    await p.seek(T, 60_000, {})
    await p.setShuffle(T, true, {})
    await p.setRepeat(T, 'track', {})
    await p.setVolume(T, 35, {})
    expect(await p.getPlaybackState(T)).toMatchObject({
      progress_ms: 60_000,
      shuffle_state: true,
      repeat_state: 'track',
      device: { volume_percent: 35 },
    })
    await p.transferPlayback(T, 'phone', {})
    expect(await reasonOf(p.setVolume(T, 10, {}))).toBe('403 VOLUME_CONTROL_DISALLOW')
  })

  it('moves playback between devices', async () => {
    const { p } = setup()
    await p.play(T, { uris: ['spotify:track:a'] })
    await p.transferPlayback(T, 'phone', { play: false })
    const devices = await p.getDevices(T)
    expect(devices.filter((d) => d.is_active).map((d) => d.id)).toEqual(['phone'])
    expect(await p.getPlaybackState(T)).toMatchObject({ device: { id: 'phone' }, is_playing: false })
    expect(await reasonOf(p.transferPlayback(T, 'toaster', {}))).toBe('404 UNKNOWN')
  })

  it('fails like Spotify without an active device', async () => {
    const { p, player } = setup()
    player.deactivate()
    await expect(p.getPlaybackState(T)).resolves.toBeNull()
    expect(await reasonOf(p.play(T, { uris: ['spotify:track:a'] }))).toBe('404 NO_ACTIVE_DEVICE')
    // Naming a device works anyway, and makes it active.
    await p.play(T, { uris: ['spotify:track:a'], deviceId: 'phone' })
    expect(await p.getPlaybackState(T)).toMatchObject({ device: { id: 'phone' }, is_playing: true })
  })

  it('fails every call without Premium', async () => {
    const { p } = setup({ premium: false })
    expect(await reasonOf(p.getPlaybackState(T))).toBe('403 PREMIUM_REQUIRED')
    expect(await reasonOf(p.play(T, { uris: ['spotify:track:a'] }))).toBe('403 PREMIUM_REQUIRED')
  })

  it('refuses commands that need something playing', async () => {
    const { p } = setup()
    expect(await reasonOf(p.pause(T, {}))).toBe('403 NO_SPECIFIC_TRACK')
    expect(await reasonOf(p.play(T, {}))).toBe('403 NO_SPECIFIC_TRACK')
  })

  it('can be seeded with something already playing', async () => {
    const { p, player, advance } = setup()
    player.nowPlaying(track('x'), { positionMs: 30_000, upcoming: [track('y')] })
    advance(1_000)
    expect(await p.getPlaybackState(T)).toMatchObject({ item: { id: 'x' }, progress_ms: 31_000, is_playing: true })
    expect((await p.getQueue(T)).queue.map((item) => item.id)).toEqual(['y'])
  })
})
