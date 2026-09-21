// Web API object shapes, limited to fields still returned to development-mode apps
// after the Feb 2026 changes (no popularity, followers, available_markets...).

export type SpotifyImage = { url: string; width: number | null; height: number | null }

export type SpotifySimplifiedArtist = { id: string; name: string; uri: string }

export type SpotifySimplifiedAlbum = {
  id: string
  name: string
  uri: string
  album_type: 'album' | 'single' | 'compilation'
  release_date: string
  release_date_precision: 'year' | 'month' | 'day'
  images: SpotifyImage[]
  artists: SpotifySimplifiedArtist[]
}

export type SpotifyTrack = {
  /** Null for local files. */
  id: string | null
  name: string
  uri: string
  duration_ms: number
  explicit: boolean
  is_local: boolean
  external_ids?: { isrc?: string }
  album: SpotifySimplifiedAlbum
  artists: SpotifySimplifiedArtist[]
}

export type SpotifyContext = {
  type: 'album' | 'artist' | 'playlist' | 'show' | 'collection' | (string & {})
  uri: string
}

export type PlayHistoryItem = {
  track: SpotifyTrack
  /** ISO timestamp of when the track was played. */
  played_at: string
  context: SpotifyContext | null
}

export type RecentlyPlayedPage = {
  items: PlayHistoryItem[]
  cursors: { after: string; before: string } | null
}

export type SpotifyPlaylistMeta = {
  id: string
  name: string
  images: SpotifyImage[] | null
  owner: { id: string; display_name: string | null }
  snapshot_id: string
}

export type SpotifyArtist = SpotifySimplifiedArtist & { images: SpotifyImage[] }

export type Paging<T> = {
  items: T[]
  next: string | null
  total: number
  offset: number
  limit: number
}

/** An entry in `GET /me/playlists`. */
export type SpotifyPlaylist = {
  id: string
  name: string
  description: string | null
  images: SpotifyImage[] | null
  owner: { id: string; display_name: string | null }
  collaborative: boolean
  public: boolean | null
  snapshot_id: string
  /** Renamed from `tracks` in Feb 2026; older responses may still carry `tracks`. */
  items?: { total: number }
  tracks?: { total: number }
}

/** An entry in `GET /playlists/{id}/items`. `item` is null for content Spotify removed. */
export type SpotifyPlaylistItem = {
  added_at: string | null
  added_by: { id: string } | null
  is_local: boolean
  item: (SpotifyTrack & { type?: 'track' }) | { type: 'episode'; id: string } | null
}

export type TopTimeRange = 'short_term' | 'medium_term' | 'long_term'
