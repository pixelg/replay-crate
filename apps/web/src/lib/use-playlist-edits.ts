import { addToPlaylist, moveInPlaylist, removeFromPlaylist } from '@replay-crate/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './api.ts'

type Edit =
  | { kind: 'add'; playlistId: string; trackIds: string[] }
  | { kind: 'remove'; playlistId: string; trackIds: string[] }
  | { kind: 'move'; playlistId: string; from: number; to: number }

/** Changes a playlist on Spotify, then refreshes everything that shows playlist contents. */
export function usePlaylistEdit() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (edit: Edit) => {
      switch (edit.kind) {
        case 'add':
          return addToPlaylist(api, edit.playlistId, edit.trackIds)
        case 'remove':
          return removeFromPlaylist(api, edit.playlistId, edit.trackIds)
        case 'move':
          return moveInPlaylist(api, edit.playlistId, edit.from, edit.to)
      }
    },
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['playlists'] }),
        queryClient.invalidateQueries({ queryKey: ['tracks'] }),
      ]),
  })
}
