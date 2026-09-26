import { createPlaylist } from '@replay-crate/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { api } from './api.ts'

/** Creates a playlist on Spotify with `trackIds`, then opens it. */
export function useCreatePlaylist() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, trackIds }: { name: string; trackIds: string[] }) => createPlaylist(api, { name, trackIds }),
    onSuccess: async ({ id }) => {
      await queryClient.invalidateQueries({ queryKey: ['playlists'] })
      await navigate({ to: '/playlists/$playlistId', params: { playlistId: id } })
    },
  })
}
