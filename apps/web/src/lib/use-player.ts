import {
  devicesQueryOptions,
  expectedPlayback,
  forgetDevice,
  isApiError,
  playbackQueryOptions,
  progressAt,
  queueQueryOptions,
  sendPlayerCommand,
  type Device,
  type Playback,
  type PlayContext,
  type PlayerItem,
  type PlayerCommand,
} from '@replay-crate/api-client'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from './api.ts'

const PLAYBACK_KEY = playbackQueryOptions(api).queryKey

/**
 * Spotify takes a moment to reflect a command in its state: ask again after the first delay, and
 * once more after the second, since it's sometimes slower.
 */
const SETTLE_MS = [600, 2_500] as const

/** A refused command's message goes after this long, if playback hasn't moved on before then. */
export const REFUSAL_SHOWN_MS = 10_000

/** Where and what is playing: once this changes, an earlier refusal is old news. */
const situationOf = (playback: Playback | null | undefined) =>
  playback ? `${playback.device.id}|${playback.item?.uri ?? ''}|${playback.isPlaying}` : 'none'

/**
 * What Spotify is playing, polled every few seconds while music plays (less when idle, never
 * in a background tab), with the position ticking along locally in between.
 */
export function usePlayback() {
  const queryClient = useQueryClient()
  const query = useQuery(playbackQueryOptions(api))
  const playback = query.data ?? null
  const now = useNow(Boolean(playback?.isPlaying))
  const progressMs = playback ? progressAt(playback, query.dataUpdatedAt, now) : 0

  // When the item runs out, the next one has started: ask rather than wait for the next poll.
  const endedUri = useRef<string | null>(null)
  const uri = playback?.item?.uri ?? null
  const ended = Boolean(playback?.isPlaying && playback.item && progressMs >= playback.item.durationMs)
  useEffect(() => {
    if (!ended || endedUri.current === uri) return
    endedUri.current = uri
    void queryClient.invalidateQueries({ queryKey: PLAYBACK_KEY, exact: true })
  }, [ended, uri, queryClient])

  return { playback, progressMs, error: query.error, isPending: query.isPending }
}

/**
 * Whether Spotify is playing right now, from the same polled playback. Components that only need
 * this (the logo) don't re-render as the position ticks.
 */
export function useIsPlaying() {
  return useQuery({ ...playbackQueryOptions(api), select: (playback) => Boolean(playback?.isPlaying) }).data ?? false
}

/** The id of the track playing right now (not paused), or null; re-renders only when it changes. */
export function usePlayingTrackId() {
  return (
    useQuery({
      ...playbackQueryOptions(api),
      select: (playback) => (playback?.isPlaying && playback.item?.type === 'track' ? playback.item.id : null),
    }).data ?? null
  )
}

/**
 * What Spotify has loaded right now, playing or paused, and where from; null once it reports
 * nothing. Re-renders only when that changes, not as the position ticks.
 */
export function useNowPlaying(): { item: PlayerItem; context: PlayContext | null; isPlaying: boolean } | null {
  return (
    useQuery({
      ...playbackQueryOptions(api),
      select: (playback) =>
        playback?.item ? { item: playback.item, context: playback.context, isPlaying: playback.isPlaying } : null,
    }).data ?? null
  )
}

/** Up next, fetched again whenever the playing item changes. */
export function useQueue(currentUri: string | null, { enabled = true } = {}) {
  return useQuery({ ...queueQueryOptions(api, currentUri), enabled: enabled && currentUri !== null })
}

export function useDevices({ enabled = true } = {}) {
  return useQuery({ ...devicesQueryOptions(api), enabled })
}

/**
 * Sends player commands. What a command predictably changes (pause, resume, seek, shuffle,
 * repeat, volume) shows at once and is rolled back if Spotify refuses; then playback, and the
 * queue or devices when the command touches them, are fetched again as Spotify catches up.
 */
export function usePlayerControls() {
  const queryClient = useQueryClient()
  // What playback looked like when the last command was refused.
  const refusedIn = useRef<string | null>(null)
  const lateLook = useRef<{ timer?: ReturnType<typeof setTimeout>; kinds: Set<PlayerCommand['kind']> }>({ kinds: new Set() })
  const mutation = useMutation({
    mutationKey: ['player', 'command'],
    mutationFn: (command: PlayerCommand) => sendPlayerCommand(api, command),
    onMutate: async (command) => {
      await queryClient.cancelQueries({ queryKey: PLAYBACK_KEY, exact: true })
      const previous = queryClient.getQueryData<Playback | null>(PLAYBACK_KEY)
      const fetchedAt = queryClient.getQueryState(PLAYBACK_KEY)?.dataUpdatedAt ?? Date.now()
      if (previous) queryClient.setQueryData(PLAYBACK_KEY, expectedPlayback(previous, command, fetchedAt, Date.now()))
      return { previous }
    },
    onError: (error, _command, context) => {
      if (context?.previous !== undefined) queryClient.setQueryData(PLAYBACK_KEY, context.previous)
      refusedIn.current = situationOf(queryClient.getQueryData<Playback | null>(PLAYBACK_KEY))
      // A reconnect or re-auth banner may need to show now.
      if (isApiError(error) && (error.code === 'reauth_required' || error.code === 'missing_scopes')) {
        void queryClient.invalidateQueries({ queryKey: ['me'] })
      }
    },
    onSettled: (_data, _error, command) => {
      const [first, second] = SETTLE_MS
      // One late look for a burst of commands (arrow keys on a slider, say), not one each. The
      // command counts as sent after the first look; the late one doesn't hold it up.
      const late = lateLook.current
      late.kinds.add(command.kind)
      clearTimeout(late.timer)
      late.timer = setTimeout(() => {
        refetchAfter(queryClient, late.kinds)
        late.kinds.clear()
      }, second)
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          refetchAfter(queryClient, [command.kind])
          resolve()
        }, first),
      )
    },
  })

  // A refusal explains a moment, not a lasting state: it goes once playback has moved on (music
  // playing somewhere after "no active device", say), and after a while regardless.
  // Read from the cache only: this hook runs in every track row, and mustn't poll from each.
  const situation = useQuery({ ...playbackQueryOptions(api), enabled: false, select: situationOf }).data
  const { error, reset } = mutation
  useEffect(() => {
    if (error && situation !== undefined && situation !== refusedIn.current) reset()
  }, [error, situation, reset])
  useEffect(() => {
    if (!error) return
    const timer = setTimeout(reset, REFUSAL_SHOWN_MS)
    return () => clearTimeout(timer)
  }, [error, reset])

  return {
    send: mutation.mutate,
    error: mutation.error,
    /** The last command sent, which `error` belongs to. */
    command: mutation.variables,
    isSending: mutation.isPending,
    reset: mutation.reset,
  }
}

/** Forgets a device played on before, then lists devices again. */
export function useForgetDevice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (device: Device) => forgetDevice(api, device.rememberedId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: devicesQueryOptions(api).queryKey }),
  })
}

/** Fetches playback again after commands, and the queue or devices when they touch them. */
function refetchAfter(queryClient: QueryClient, kinds: Iterable<PlayerCommand['kind']>) {
  const sent = [...kinds]
  void queryClient.invalidateQueries({ queryKey: PLAYBACK_KEY, exact: true })
  if (sent.some((kind) => kind === 'next' || kind === 'previous' || kind === 'play' || kind === 'queue')) {
    void queryClient.invalidateQueries({ queryKey: ['player', 'queue'] })
  }
  if (sent.some((kind) => kind === 'transfer' || kind === 'volume')) {
    void queryClient.invalidateQueries({ queryKey: ['player', 'devices'] })
  }
}

/** The current time, re-read every half second while `ticking`. */
function useNow(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    const timer = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(timer)
  }, [ticking])
  return now
}
