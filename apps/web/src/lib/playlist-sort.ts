import type { PlaylistSummary } from '@replay-crate/api-client'

/** How the Playlists page can order its list. `order` is the order the playlists have in Spotify. */
export const playlistSorts = [
  { value: 'order', label: 'Spotify order' },
  { value: 'played', label: 'Recently played' },
  { value: 'plays', label: 'Most played' },
  { value: 'added', label: 'Recently added to' },
  { value: 'name', label: 'A–Z' },
  { value: 'size', label: 'Largest' },
] as const
export type PlaylistSort = (typeof playlistSorts)[number]['value']
export const isPlaylistSort = (value: unknown): value is PlaylistSort => playlistSorts.some((sort) => sort.value === value)

/** Which playlists to show: all, those ever played from, or those never played from. */
export const playlistShows = [
  { value: 'all', label: 'All' },
  { value: 'played', label: 'Played' },
  { value: 'unplayed', label: 'Never played' },
] as const
export type PlaylistShow = (typeof playlistShows)[number]['value']
export const isPlaylistShow = (value: unknown): value is PlaylistShow => playlistShows.some((show) => show.value === value)

const KEY = 'rc:playlists-sort'

/** The sort last picked on this device, or Spotify's order. */
export function storedPlaylistSort(): PlaylistSort {
  try {
    const stored = localStorage.getItem(KEY)
    return isPlaylistSort(stored) ? stored : 'order'
  } catch {
    return 'order'
  }
}

export function storePlaylistSort(sort: PlaylistSort) {
  try {
    if (sort === 'order') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, sort)
  } catch {
    // Storage blocked: the sort still sits in the URL.
  }
}

const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true })
/** Newest first; playlists without the date last. ISO strings compare as dates. */
const newest = (a: string | null, b: string | null) => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? 1 : -1)

/**
 * The playlists matching `q` (in the name, any case) and `show`, in the order `sort` asks for.
 * Ties, and `order`, keep the order they came in: Spotify's. `size` counts what the mode lists
 * (`episodes` in podcast mode).
 */
export function arrangePlaylists(
  playlists: PlaylistSummary[],
  { sort, q = '', show = 'all', size = 'tracks' }: { sort: PlaylistSort; q?: string; show?: PlaylistShow; size?: 'tracks' | 'episodes' },
): PlaylistSummary[] {
  const needle = q.trim().toLocaleLowerCase()
  const kept = playlists.filter(
    (playlist) =>
      (!needle || playlist.name.toLocaleLowerCase().includes(needle)) &&
      (show === 'all' || (show === 'played') === playlist.playsFrom > 0),
  )
  const sizeOf = (playlist: PlaylistSummary) => (size === 'episodes' ? playlist.episodeCount : playlist.trackCount)
  const compare: Record<PlaylistSort, ((a: PlaylistSummary, b: PlaylistSummary) => number) | null> = {
    order: null,
    played: (a, b) => newest(a.lastPlayedFrom, b.lastPlayedFrom),
    plays: (a, b) => b.playsFrom - a.playsFrom,
    added: (a, b) => newest(a.lastAddedAt, b.lastAddedAt),
    name: (a, b) => collator.compare(a.name, b.name),
    size: (a, b) => sizeOf(b) - sizeOf(a),
  }
  const by = compare[sort]
  // toSorted is stable, so equal playlists stay in Spotify's order.
  return by ? kept.toSorted(by) : kept
}
