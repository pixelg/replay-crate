import {
  devicesQueryOptions,
  expectedPlayback,
  isApiError,
  playbackQueryOptions,
  progressAt,
  queueQueryOptions,
  sendPlayerCommand,
  type Playback,
  type PlayContext,
  type PlayerItem,
  type PlayerCommand,
} from '@replay-crate/api-client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { api } from './api.ts'

const PLAYBACK_KEY = playbackQueryOptions(api).queryKey

/** Spotify takes a moment to reflect a command in its state; ask again after this. */
const SETTLE_MS = 600

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
 * What's playing right now (not paused) and where from, or null. Re-renders only when that
 * changes, not as the position ticks.
 */
export function useNowPlaying(): { item: PlayerItem; context: PlayContext | null } | null {
  return (
    useQuery({
      ...playbackQueryOptions(api),
      select: (playback) =>
        playback?.isPlaying && playback.item ? { item: playback.item, context: playback.context } : null,
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
 * queue or devices when the command touches them, are fetched again once Spotify has caught up.
 */
export function usePlayerControls() {
  const queryClient = useQueryClient()
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
      // A reconnect or re-auth banner may need to show now.
      if (isApiError(error) && (error.code === 'reauth_required' || error.code === 'missing_scopes')) {
        void queryClient.invalidateQueries({ queryKey: ['me'] })
      }
    },
    onSettled: (_data, _error, command) =>
      new Promise<void>((resolve) =>
        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: PLAYBACK_KEY, exact: true })
          if (['next', 'previous', 'play', 'queue'].includes(command.kind)) {
            void queryClient.invalidateQueries({ queryKey: ['player', 'queue'] })
          }
          if (command.kind === 'transfer' || command.kind === 'volume') {
            void queryClient.invalidateQueries({ queryKey: ['player', 'devices'] })
          }
          resolve()
        }, SETTLE_MS),
      ),
  })
  return { send: mutation.mutate, error: mutation.error, isSending: mutation.isPending, reset: mutation.reset }
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
