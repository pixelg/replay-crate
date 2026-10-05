import { isApiError, syncListens } from '@replay-crate/api-client'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api.ts'

const KEY = ['listens-sync']

/**
 * Podcast History's Sync. Spotify's recently-played never lists episodes, so this asks for the
 * followed shows' resume points instead: listening the app missed (the phone, with the server off)
 * comes back as estimated listens. `result` is the last sync's.
 */
export function useListensSync() {
  const queryClient = useQueryClient()
  const mutation = useMutation({
    mutationKey: KEY,
    mutationFn: () => syncListens(api),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['listens'] }),
        queryClient.invalidateQueries({ queryKey: ['episodes'] }),
        queryClient.invalidateQueries({ queryKey: ['shows'] }),
      ]),
    onError: (error) => {
      if (isApiError(error) && (error.code === 'reauth_required' || error.code === 'forbidden')) {
        void queryClient.invalidateQueries({ queryKey: ['me'] })
      }
    },
  })
  const isSyncing = useIsMutating({ mutationKey: KEY }) > 0
  return { sync: mutation.mutate, isSyncing, result: mutation.data, error: mutation.error }
}
