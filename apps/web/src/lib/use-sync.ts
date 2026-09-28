import { isApiError, syncNow } from '@replay-crate/api-client'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api.ts'

export const SYNC_KEY = ['sync']

/**
 * Pulls new plays from Spotify and refreshes history; play counts and stats too when anything
 * arrived.
 */
export function useSync() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationKey: SYNC_KEY,
    mutationFn: () => syncNow(api),
    onSuccess: (result) => {
      if (result.inserted > 0) {
        // Not Spotify's own top lists: those don't come from our plays.
        for (const queryKey of [['tracks'], ['stats', 'overview'], ['stats', 'top']]) {
          void queryClient.invalidateQueries({ queryKey })
        }
      }
      // History shows when it last synced, so it's fetched again either way.
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['plays'] }),
        queryClient.invalidateQueries({ queryKey: ['gaps'] }),
      ])
    },
    onError: (error) => {
      // The session knows about the expiry now; refetch /me so the reconnect banner shows.
      if (isApiError(error) && error.code === 'reauth_required') void queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })
  // True while any sync runs, including the automatic ones.
  const isSyncing = useIsMutating({ mutationKey: SYNC_KEY }) > 0
  return { sync: mutation.mutate, isSyncing, error: mutation.error }
}
