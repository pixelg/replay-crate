import { playlistsQueryOptions } from '@replay-crate/api-client'
import { useQuery } from '@tanstack/react-query'
import { api } from './api.ts'

/**
 * Whether a playlist is one of the user's (owned or collaborative): only those have a page here.
 * One shared query, so a list of chips asks once.
 */
export function useIsLibraryPlaylist(playlistId: string | null) {
  const { data } = useQuery({ ...playlistsQueryOptions(api), enabled: playlistId !== null })
  return playlistId !== null && Boolean(data?.playlists.some((playlist) => playlist.id === playlistId))
}
