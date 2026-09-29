import { createPlaylist } from '@replay-crate/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { api } from './api.ts'

/**
 * Creates a playlist on Spotify with `trackIds`, then opens it; with `open: false` it stays put
 * and says so in a toast (with a link), for creating one while listening.
 */
export function useCreatePlaylist({ open = true }: { open?: boolean } = {}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ name, trackIds }: { name: string; trackIds: string[] }) => createPlaylist(api, { name, trackIds }),
    onSuccess: async ({ id }, { name }) => {
      await queryClient.invalidateQueries({ queryKey: ['playlists'] })
      await queryClient.invalidateQueries({ queryKey: ['tracks'] })
      const show = () => navigate({ to: '/playlists/$playlistId', params: { playlistId: id } })
      if (open) await show()
      else toast.success(`Created ${name}`, { action: { label: 'Open', onClick: () => void show() } })
    },
  })
}
