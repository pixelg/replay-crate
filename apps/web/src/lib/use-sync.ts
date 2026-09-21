import { ReauthRequiredError, syncNow } from '@replay-crate/api-client'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from './api.ts'

const SYNC_KEY = ['sync']

/** Pulls new plays from Spotify and refreshes history when anything arrived. */
export function useSync() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationKey: SYNC_KEY,
    mutationFn: () => syncNow(api),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['plays'] }),
    onError: (error) => {
      // The session knows about the expiry now; refetch /me so the reconnect banner shows.
      if (error instanceof ReauthRequiredError) void queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })
  // True while any sync runs, including the automatic one started on open.
  const isSyncing = useIsMutating({ mutationKey: SYNC_KEY }) > 0
  return { sync: mutation.mutate, isSyncing, error: mutation.error }
}

let syncedOnOpen = false

/** Syncs once when the app opens, so history is fresh without pressing anything. */
export function useSyncOnOpen(enabled: boolean) {
  const { sync } = useSync()
  useEffect(() => {
    if (!enabled || syncedOnOpen) return
    syncedOnOpen = true
    sync()
  }, [enabled, sync])
}
