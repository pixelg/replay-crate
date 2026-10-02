import type { SpotifyPlayable } from '@replay-crate/spotify'
import type { AppDeps } from '../deps.ts'
import { inContext } from './in-context.ts'
import { contextRefused, sameRecording, sleep, START_CHECK_DELAYS_MS, type PlayItemResult } from './play-item.ts'

// Playing an item from Up next. Spotify can't jump ahead in its queue, and its iPhone app won't
// start bare URIs (see play-item.ts), so the item is reached one of two ways. One of the playing
// context's items is played from that context: one call, and Spotify keeps the user's queue, as
// when its own queue view jumps into the context. Anything else (an item the user queued, which
// Spotify's queue doesn't tell apart, a context Spotify can't start at an offset, or shuffle,
// whose order only skipping keeps) is skipped to, so Up next stays as it was shown. Spotify's
// queue lists about 20 items, so that's at most about as many calls.

/** Contexts Spotify starts at an offset: it only promises albums and playlists. */
const OFFSET_CONTEXTS = new Set(['album', 'playlist'])

export type PlayFromQueueResult = PlayItemResult | { missing: true }

type Deps = Pick<AppDeps, 'db' | 'spotify' | 'sleep'>
type Request = { uri: string; index: number; deviceId?: string }

/** Where `uri` is in the queue: at `index` as the client saw it, else where it is now; -1 when gone. */
const placeOf = (queue: SpotifyPlayable[], uri: string, index: number) =>
  queue[index]?.uri === uri ? index : queue.findIndex((item) => item.uri === uri)

/**
 * Plays the item at `index` in Up next (looked for again if the queue has moved), then watches
 * the player until it's playing. A lagging state can't be told from a lost skip, so skips aren't
 * resent (that could overshoot). Spotify's refusals of the device are thrown as they come.
 */
export async function playFromQueue(deps: Deps, token: string, { uri, index, deviceId }: Request): Promise<PlayFromQueueResult> {
  const { spotify } = deps
  const skip = async (times: number) => {
    for (let i = 0; i < times; i++) await spotify.skipToNext(token, { deviceId })
  }

  const [state, { queue }] = await Promise.all([spotify.getPlaybackState(token), spotify.getQueue(token)])
  const at = placeOf(queue, uri, index)
  if (at < 0) return { missing: true }
  const context = state?.context
  // The very next item is one skip either way, and that leaves the queue alone.
  const fromContext =
    at > 0 && context && !state.shuffle_state && OFFSET_CONTEXTS.has(context.type) && (await inContext(deps.db, queue[at]!, context)) === true
  if (fromContext) {
    try {
      await spotify.play(token, { contextUri: context.uri, offset: { uri }, deviceId })
    } catch (error) {
      if (!contextRefused(error)) throw error
      await skip(at + 1)
    }
  } else {
    await skip(at + 1)
  }

  return waitUntilPlaying(deps, token, uri, deviceId)
}

/**
 * Watches the player until `uri` (or another copy of its recording) plays, resuming once if it's
 * there but paused (as after skips while paused).
 */
async function waitUntilPlaying(deps: Deps, token: string, uri: string, deviceId?: string): Promise<PlayItemResult> {
  const { spotify, sleep: wait = sleep } = deps
  const isRequested = await sameRecording(deps.db, uri)
  let device: string | null = null
  let resumed = false
  let elapsed = 0
  // What each look saw, for the log.
  const seen: string[] = []
  for (const delay of START_CHECK_DELAYS_MS) {
    await wait(delay)
    elapsed += delay
    const state = await spotify.getPlaybackState(token)
    const item = state?.item
    seen.push(`+${elapsed}ms ${item?.uri ?? 'nothing'} ${state?.is_playing ? 'playing' : 'paused'}`)
    device = state?.device.name ?? device
    if (!item || !isRequested(item)) continue
    if (state.is_playing) return { started: true }
    if (!resumed) {
      resumed = true
      await spotify.play(token, { deviceId })
    }
  }
  console.warn(`[player] ${device ?? 'device'} didn't show ${uri} playing from Up next: ${seen.join(', ')}`)
  return { started: false, device }
}
