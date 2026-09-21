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
}

export type SpotifyArtist = SpotifySimplifiedArtist & { images: SpotifyImage[] }
