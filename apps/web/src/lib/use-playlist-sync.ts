import { ReauthRequiredError, syncPlaylists, type PlaylistSyncResult } from '@replay-crate/api-client'
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from './api.ts'

const KEY = ['playlist-sync']

/** Syncs playlists (possibly over several calls) and exposes progress. */
export function usePlaylistSync() {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<PlaylistSyncResult | null>(null)
  const mutation = useMutation({
    mutationKey: KEY,
    mutationFn: () =>
      syncPlaylists(api, (result) => {
        setProgress(result)
        void queryClient.invalidateQueries({ queryKey: ['playlists'] })
      }),
    onSettled: () => {
      setProgress(null)
      void queryClient.invalidateQueries({ queryKey: ['playlists'] })
      void queryClient.invalidateQueries({ queryKey: ['tracks'] })
    },
    onError: (error) => {
      if (error instanceof ReauthRequiredError) void queryClient.invalidateQueries({ queryKey: ['me'] })
    },
  })
  const isSyncing = useIsMutating({ mutationKey: KEY }) > 0
  return { sync: mutation.mutate, isSyncing, progress }
}
