import { isApiError, syncShows } from '@replay-crate/api-client'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { api } from './api.ts'

const KEY = ['shows-sync']

/** Followed shows are read again when the page opens and the last read is older than this. */
export const SHOWS_STALE_MS = 60 * 60_000

/**
 * Reads the shows the user follows from Spotify. Their latest episodes arrive in the background
 * after it (about one show a second), so for a while `arriving` is true: a list of new episodes
 * should refetch now and then until it's over.
 */
export function useShowsSync() {
  const queryClient = useQueryClient()
  const [arrivingUntil, setArrivingUntil] = useState(0)
  const mutation = useMutation({
    mutationKey: KEY,
    mutationFn: () => syncShows(api),
    onSuccess: ({ queued }) => {
      if (queued) setArrivingUntil(Date.now() + queued * 1_000 + 5_000)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['shows'] }),
    onError: (error) => {
      if (isApiError(error) && (error.code === 'reauth_required' || error.code === 'forbidden')) {
        void queryClient.invalidateQueries({ queryKey: ['me'] })
      }
    },
  })
  const [now, setNow] = useState(() => Date.now())
  const arriving = now < arrivingUntil
  useEffect(() => {
    if (arrivingUntil <= Date.now()) return
    const timer = setTimeout(() => setNow(Date.now()), arrivingUntil - Date.now())
    return () => clearTimeout(timer)
  }, [arrivingUntil])
  const isSyncing = useIsMutating({ mutationKey: KEY }) > 0
  return { sync: mutation.mutate, isSyncing, arriving, error: mutation.error }
}

/** Runs `sync` once when the last read (`syncedAt`) is missing or old: on opening a view of followed shows. */
export function useSyncWhenStale(syncedAt: string | null | undefined, sync: () => void, enabled = true) {
  const stale = syncedAt === null || (syncedAt !== undefined && Date.now() - Date.parse(syncedAt) > SHOWS_STALE_MS)
  useEffect(() => {
    if (enabled && stale) sync()
    // Once per visit: a failed sync shouldn't be retried in a loop.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, stale])
}
