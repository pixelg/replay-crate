import { queryOptions } from '@tanstack/react-query'
import type { InferRequestType, InferResponseType } from 'hono/client'
import { ApiError, expectOk, isApiError, send } from './errors.ts'
import type { ApiClient } from './index.ts'

export type Playback = NonNullable<InferResponseType<ApiClient['player']['$get'], 200>['playback']>
export type PlayerItem = NonNullable<Playback['item']>
export type PlayerQueue = InferResponseType<ApiClient['player']['queue']['$get'], 200>
export type Device = InferResponseType<ApiClient['player']['devices']['$get'], 200>['devices'][number]
export type RepeatMode = Playback['repeat']

/** How often to ask Spotify what's playing: often while music plays, rarely when idle. */
export const PLAYING_POLL_MS = 5_000
export const IDLE_POLL_MS = 20_000

/**
 * Poll interval for playback, or false to stop. Premium, scope and sign-in problems (403, 401)
 * don't go away by asking again; the UI offers a fix instead.
 */
export function playbackPollInterval(playback: Playback | null | undefined, error: unknown): number | false {
  if (isApiError(error, 401) || isApiError(error, 403)) return false
  return playback?.isPlaying ? PLAYING_POLL_MS : IDLE_POLL_MS
}

/** What's playing and where; null when no Spotify device is active. */
export const playbackQueryOptions = (api: ApiClient) =>
  queryOptions({
    queryKey: ['player'],
    queryFn: async (): Promise<Playback | null> => {
      const endpoint = 'GET /api/v1/player'
      return (await expectOk(await send(endpoint, () => api.player.$get()), endpoint)).playback
    },
    refetchInterval: (query) => playbackPollInterval(query.state.data, query.state.error),
    retry: (failures, error) => !isApiError(error, 403) && !isApiError(error, 401) && failures < 2,
  })

/** Up next. Keyed on the current item, so it's fetched again whenever the track changes. */
export const queueQueryOptions = (api: ApiClient, currentUri: string | null) =>
  queryOptions({
    queryKey: ['player', 'queue', currentUri],
    queryFn: async (): Promise<PlayerQueue> => {
      const endpoint = 'GET /api/v1/player/queue'
      return expectOk(await send(endpoint, () => api.player.queue.$get()), endpoint)
    },
    staleTime: 5 * 60_000,
  })

export const devicesQueryOptions = (api: ApiClient) =>
  queryOptions({
    queryKey: ['player', 'devices'],
    queryFn: async (): Promise<Device[]> => {
      const endpoint = 'GET /api/v1/player/devices'
      return (await expectOk(await send(endpoint, () => api.player.devices.$get()), endpoint)).devices
    },
  })

/**
 * Where playback is now, from the last answer and when it arrived: Spotify reports the position
 * when asked, and it keeps moving while playing. Never past the item's end.
 */
export function progressAt(playback: Playback, fetchedAt: number, now: number): number {
  const elapsed = playback.isPlaying ? Math.max(0, now - fetchedAt) : 0
  return Math.min((playback.progressMs ?? 0) + elapsed, playback.item?.durationMs ?? Number.POSITIVE_INFINITY)
}

type PlayBody = InferRequestType<ApiClient['player']['play']['$put']>['json']
type Target = { deviceId?: string }

/** Everything the player can be told to do. */
export type PlayerCommand =
  | ({ kind: 'play' } & PlayBody)
  | ({ kind: 'pause' } & Target)
  | ({ kind: 'next' } & Target)
  | ({ kind: 'previous' } & Target)
  | ({ kind: 'seek'; positionMs: number } & Target)
  | ({ kind: 'shuffle'; on: boolean } & Target)
  | ({ kind: 'repeat'; state: RepeatMode } & Target)
  | ({ kind: 'volume'; percent: number } & Target)
  | ({ kind: 'queue'; uri: string } & Target)
  | { kind: 'transfer'; deviceId: string; play?: boolean }

/** The request for a command, and how errors name it. */
function commandRequest(api: ApiClient, command: PlayerCommand): [endpoint: string, request: () => Promise<Response>] {
  const player = api.player
  switch (command.kind) {
    case 'play': {
      const { kind: _, ...json } = command
      return ['PUT /api/v1/player/play', () => player.play.$put({ json })]
    }
    case 'pause':
      return ['PUT /api/v1/player/pause', () => player.pause.$put({ json: { deviceId: command.deviceId } })]
    case 'next':
      return ['POST /api/v1/player/next', () => player.next.$post({ json: { deviceId: command.deviceId } })]
    case 'previous':
      return ['POST /api/v1/player/previous', () => player.previous.$post({ json: { deviceId: command.deviceId } })]
    case 'seek':
      return ['PUT /api/v1/player/seek', () => player.seek.$put({ json: { deviceId: command.deviceId, positionMs: command.positionMs } })]
    case 'shuffle':
      return ['PUT /api/v1/player/shuffle', () => player.shuffle.$put({ json: { deviceId: command.deviceId, on: command.on } })]
    case 'repeat':
      return ['PUT /api/v1/player/repeat', () => player.repeat.$put({ json: { deviceId: command.deviceId, state: command.state } })]
    case 'volume':
      return ['PUT /api/v1/player/volume', () => player.volume.$put({ json: { deviceId: command.deviceId, percent: command.percent } })]
    case 'queue':
      return ['POST /api/v1/player/queue', () => player.queue.$post({ json: { deviceId: command.deviceId, uri: command.uri } })]
    case 'transfer':
      return ['PUT /api/v1/player/device', () => player.device.$put({ json: { deviceId: command.deviceId, play: command.play } })]
  }
}

/** Sends a command; resolves once Spotify has passed it on (it can take a moment to show). */
export async function sendPlayerCommand(api: ApiClient, command: PlayerCommand): Promise<void> {
  const [endpoint, request] = commandRequest(api, command)
  const res = await send(endpoint, request)
  if (!res.ok) throw await ApiError.fromResponse(res, endpoint)
}

/**
 * The playback a command should lead to, to show before Spotify confirms it. Commands whose
 * outcome only Spotify knows (next, previous, playing something new) leave it as it was.
 * `fetchedAt` is when `playback` arrived, so the position carries on from where it is now.
 */
export function expectedPlayback(playback: Playback, command: PlayerCommand, fetchedAt: number, now: number): Playback {
  const here = { ...playback, progressMs: progressAt(playback, fetchedAt, now) }
  switch (command.kind) {
    case 'pause':
      return { ...here, isPlaying: false }
    case 'play':
      // Only a plain resume is predictable.
      return command.uris || command.contextUri ? playback : { ...here, isPlaying: true }
    case 'seek':
      return { ...here, progressMs: command.positionMs }
    case 'shuffle':
      return { ...here, shuffle: command.on }
    case 'repeat':
      return { ...here, repeat: command.state }
    case 'volume':
      return { ...here, device: { ...here.device, volumePercent: command.percent } }
    default:
      return playback
  }
}
