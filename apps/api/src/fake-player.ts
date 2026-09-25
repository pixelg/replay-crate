import { SpotifyApiError } from '@replay-crate/spotify'
import type { RepeatState, SpotifyDevice, SpotifyPlaybackState, SpotifyPlayable, SpotifyTrack } from '@replay-crate/spotify'
import type { SpotifyGateway } from './deps.ts'

// A stand-in for Spotify's player, for unit tests and the E2E server (part of the fake Spotify
// in fakes.ts; no test framework imports here). It keeps one user's playback: devices, the
// current item and its position, the queue and the context, and fails commands the way Spotify
// does (reason codes included).

type PlayerGateway = Pick<
  SpotifyGateway,
  | 'getPlaybackState'
  | 'getQueue'
  | 'getDevices'
  | 'play'
  | 'pause'
  | 'skipToNext'
  | 'skipToPrevious'
  | 'seek'
  | 'setRepeat'
  | 'setShuffle'
  | 'setVolume'
  | 'addToQueue'
  | 'transferPlayback'
>

export type FakeDevice = Omit<SpotifyDevice, 'is_active' | 'is_private_session' | 'is_restricted'> & { id: string }

export const fakeDevices = (): FakeDevice[] => [
  { id: 'laptop', name: 'Laptop', type: 'Computer', volume_percent: 70, supports_volume: true },
  { id: 'phone', name: 'Phone', type: 'Smartphone', volume_percent: 100, supports_volume: false },
]

export type FakePlayerOptions = {
  /** Premium is required for every player call; without it they fail with PREMIUM_REQUIRED. */
  premium?: boolean
  devices?: FakeDevice[]
  /** The device playback starts on, or null for "open Spotify somewhere first". */
  activeDeviceId?: string | null
  /** Looks up tracks for `spotify:track:` URIs and playlist contexts. */
  resolveTrack: (uri: string) => SpotifyTrack
  resolveContext?: (uri: string) => SpotifyTrack[] | undefined
  now?: () => number
}

const failure = (status: number, reason: string, message: string) =>
  new SpotifyApiError(status, `Player command failed: ${message}`, undefined, reason)

export function createFakePlayer({
  premium = true,
  devices = fakeDevices(),
  activeDeviceId = 'laptop',
  resolveTrack,
  resolveContext = () => undefined,
  now = () => Date.now(),
}: FakePlayerOptions) {
  const state = {
    activeDeviceId,
    item: null as SpotifyPlayable | null,
    context: null as { type: string; uri: string } | null,
    /** Rest of the context after the current item. */
    upcoming: [] as SpotifyPlayable[],
    /** Added with addToQueue; plays before the rest of the context. */
    queued: [] as SpotifyPlayable[],
    played: [] as SpotifyPlayable[],
    isPlaying: false,
    /** Position when `since` was taken; the clock adds to it while playing. */
    positionMs: 0,
    since: now(),
    shuffle: false,
    repeat: 'off' as RepeatState,
    changedAt: now(),
  }

  const asPlayable = (t: SpotifyTrack): SpotifyPlayable => ({ ...t, type: 'track' })
  const progress = () => {
    const duration = state.item?.duration_ms ?? 0
    return Math.min(duration, state.positionMs + (state.isPlaying ? now() - state.since : 0))
  }
  const changed = (updates: Partial<typeof state>) => {
    Object.assign(state, { positionMs: progress(), since: now(), changedAt: now() }, updates)
  }
  const device = (id: string) => devices.find((d) => d.id === id)
  const toDevice = (d: FakeDevice): SpotifyDevice => ({
    ...d,
    is_active: d.id === state.activeDeviceId,
    is_private_session: false,
    is_restricted: false,
  })

  /** The device a command goes to, failing like Spotify when there's none. */
  function target(deviceId?: string): FakeDevice {
    if (!premium) throw failure(403, 'PREMIUM_REQUIRED', 'Premium required')
    const id = deviceId ?? state.activeDeviceId
    const found = id ? device(id) : undefined
    if (!found) throw failure(404, deviceId ? 'UNKNOWN' : 'NO_ACTIVE_DEVICE', deviceId ? 'Device not found' : 'No active device found')
    state.activeDeviceId = found.id
    return found
  }
  function needsItem() {
    if (!state.item) throw failure(403, 'NO_SPECIFIC_TRACK', 'Nothing to play')
  }

  const gateway: PlayerGateway = {
    getPlaybackState: async () => {
      if (!premium) throw failure(403, 'PREMIUM_REQUIRED', 'Premium required')
      const active = state.activeDeviceId ? device(state.activeDeviceId) : undefined
      if (!active) return null
      const playback: SpotifyPlaybackState = {
        device: toDevice(active),
        repeat_state: state.repeat,
        shuffle_state: state.shuffle,
        context: state.context,
        timestamp: state.changedAt,
        progress_ms: state.item ? progress() : null,
        is_playing: state.isPlaying,
        item: state.item,
        currently_playing_type: state.item?.type ?? 'unknown',
        actions: { disallows: { ...(!state.played.length && { skipping_prev: true }), ...(state.isPlaying ? { resuming: true } : { pausing: true }) } },
      }
      return playback
    },
    getQueue: async () => {
      if (!premium) throw failure(403, 'PREMIUM_REQUIRED', 'Premium required')
      return { currently_playing: state.item, queue: [...state.queued, ...state.upcoming] }
    },
    getDevices: async () => {
      if (!premium) throw failure(403, 'PREMIUM_REQUIRED', 'Premium required')
      return devices.map(toDevice)
    },
    play: async (_token, { deviceId, uris, contextUri, offset, positionMs = 0 }) => {
      target(deviceId)
      let list: SpotifyPlayable[] | undefined
      if (contextUri) {
        const tracks = resolveContext(contextUri)
        if (!tracks) throw failure(404, 'UNKNOWN', 'Context not found')
        list = tracks.map(asPlayable)
      } else if (uris) {
        list = uris.map((uri) => asPlayable(resolveTrack(uri)))
      }
      if (!list) {
        // Resume.
        needsItem()
        return changed({ isPlaying: true })
      }
      const start = !offset ? 0 : 'position' in offset ? offset.position : list.findIndex((item) => item.uri === offset.uri)
      if (start < 0 || start >= list.length) throw failure(404, 'UNKNOWN', 'Offset out of range')
      changed({
        item: list[start]!,
        upcoming: list.slice(start + 1),
        context: contextUri ? { type: contextUri.split(':')[1] ?? 'playlist', uri: contextUri } : null,
        played: [],
        isPlaying: true,
      })
      state.positionMs = positionMs
    },
    pause: async (_token, { deviceId }) => {
      target(deviceId)
      needsItem()
      changed({ isPlaying: false })
    },
    skipToNext: async (_token, { deviceId }) => {
      target(deviceId)
      needsItem()
      const next = state.queued[0] ?? state.upcoming[0]
      if (!next) {
        // End of the context: Spotify stops.
        return changed({ isPlaying: false, positionMs: 0 })
      }
      changed({
        played: [...state.played, state.item!],
        item: next,
        queued: state.queued[0] ? state.queued.slice(1) : state.queued,
        upcoming: state.queued[0] ? state.upcoming : state.upcoming.slice(1),
      })
      state.positionMs = 0
    },
    skipToPrevious: async (_token, { deviceId }) => {
      target(deviceId)
      needsItem()
      const previous = state.played.at(-1)
      // Past the first few seconds, or at the start, "previous" restarts the item.
      if (!previous || progress() > 3_000) return changed({ positionMs: 0 })
      changed({ item: previous, played: state.played.slice(0, -1), upcoming: [state.item!, ...state.upcoming] })
      state.positionMs = 0
    },
    seek: async (_token, positionMs, { deviceId }) => {
      target(deviceId)
      needsItem()
      changed({})
      state.positionMs = Math.min(positionMs, state.item!.duration_ms)
    },
    setRepeat: async (_token, repeat, { deviceId }) => {
      target(deviceId)
      changed({ repeat })
    },
    setShuffle: async (_token, shuffle, { deviceId }) => {
      target(deviceId)
      changed({ shuffle })
    },
    setVolume: async (_token, percent, { deviceId }) => {
      const on = target(deviceId)
      if (!on.supports_volume) throw failure(403, 'VOLUME_CONTROL_DISALLOW', 'Cannot control device volume')
      on.volume_percent = Math.max(0, Math.min(100, Math.round(percent)))
      changed({})
    },
    addToQueue: async (_token, uri, { deviceId }) => {
      target(deviceId)
      needsItem()
      state.queued.push(asPlayable(resolveTrack(uri)))
    },
    transferPlayback: async (_token, deviceId, { play: start }) => {
      if (!premium) throw failure(403, 'PREMIUM_REQUIRED', 'Premium required')
      if (!device(deviceId)) throw failure(404, 'UNKNOWN', 'Device not found')
      changed({ activeDeviceId: deviceId, ...(start !== undefined && { isPlaying: start && Boolean(state.item) }) })
    },
  }

  return {
    gateway,
    /** Where playback is, for assertions. */
    get state() {
      return { ...state, progressMs: progress() }
    },
    /** Puts `track` on and playing (or paused) on the active device, e.g. to seed a test. */
    nowPlaying(track: SpotifyTrack, { playing = true, positionMs = 0, upcoming = [] as SpotifyTrack[] } = {}) {
      changed({ item: asPlayable(track), upcoming: upcoming.map(asPlayable), isPlaying: playing, played: [] })
      state.positionMs = positionMs
    },
    /** No device active, as when Spotify isn't open anywhere. */
    deactivate() {
      changed({ activeDeviceId: null, isPlaying: false })
    },
  }
}

export type FakePlayer = ReturnType<typeof createFakePlayer>
