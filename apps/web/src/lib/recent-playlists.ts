import type { PlaylistsList } from '@replay-crate/api-client'

export type Playlist = PlaylistsList['playlists'][number]

/**
 * The playlists you can add to, most recently added to first (here or in Spotify): the one
 * you're building is on top. Ones never added to follow in library order.
 */
export function recentPlaylists(playlists: Playlist[]): Playlist[] {
  return playlists
    .filter((playlist) => playlist.owned || playlist.collaborative)
    .map((playlist, index) => ({ playlist, index }))
    .toSorted((a, b) => (b.playlist.lastAddedAt ?? '').localeCompare(a.playlist.lastAddedAt ?? '') || a.index - b.index)
    .map(({ playlist }) => playlist)
}
