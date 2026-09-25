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

// Player API (needs Premium, and the user-*-playback-state scopes).

/** A podcast episode, as the player reports it when one is playing or queued. */
export type SpotifyEpisode = {
  type: 'episode'
  id: string
  name: string
  uri: string
  duration_ms: number
  explicit: boolean
  images: SpotifyImage[]
  show: { id: string; name: string; uri: string; images: SpotifyImage[] }
}

/** What the player can hold: a track or an episode, told apart by `type`. */
export type SpotifyPlayable = (SpotifyTrack & { type: 'track' }) | SpotifyEpisode

export type SpotifyDevice = {
  /** Null for some devices Spotify can't address directly. */
  id: string | null
  is_active: boolean
  is_private_session: boolean
  /** No Web API control at all (commands to it fail). */
  is_restricted: boolean
  name: string
  type: string
  volume_percent: number | null
  supports_volume: boolean
}

export type RepeatState = 'off' | 'track' | 'context'

export type SpotifyPlaybackState = {
  device: SpotifyDevice
  repeat_state: RepeatState
  shuffle_state: boolean
  context: (SpotifyContext & { href?: string }) | null
  /** When the state last changed (ms since the epoch). */
  timestamp: number
  progress_ms: number | null
  is_playing: boolean
  item: SpotifyPlayable | null
  currently_playing_type: 'track' | 'episode' | 'ad' | 'unknown'
  /** Controls the current context doesn't allow (e.g. `skipping_prev` on the first track). */
  actions?: { disallows?: Partial<Record<string, boolean>> }
}

export type SpotifyQueue = {
  currently_playing: SpotifyPlayable | null
  /** Up next: the user's queue first, then the rest of the context. */
  queue: SpotifyPlayable[]
}

/** Where to start playback: tracks by URI, or a context (album, playlist, artist) with an offset. */
export type PlayRequest = {
  uris?: string[]
  contextUri?: string
  offset?: { position: number } | { uri: string }
  positionMs?: number
}
