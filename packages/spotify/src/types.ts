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
  item: (SpotifyTrack & { type?: 'track' }) | SpotifyEpisode | null
}

export type TopTimeRange = 'short_term' | 'medium_term' | 'long_term'

// Player API (needs Premium, and the user-*-playback-state scopes).

/** A show, as nested in an episode. (`publisher` and `available_markets` went in Feb 2026.) */
export type SpotifySimplifiedShow = {
  id: string
  name: string
  uri: string
  images: SpotifyImage[]
  description?: string
  explicit?: boolean
}

/**
 * A podcast episode. The player and `GET /episodes/{id}` both send the whole object, but only the
 * fields the player is sure to carry are required.
 */
export type SpotifyEpisode = {
  type: 'episode'
  id: string
  name: string
  uri: string
  duration_ms: number
  explicit: boolean
  images: SpotifyImage[]
  show: SpotifySimplifiedShow
  /** Plain text (`html_description` has the markup). */
  description?: string
  release_date?: string
  release_date_precision?: 'year' | 'month' | 'day'
  /** The user's place in it; only with the user-read-playback-position scope. */
  resume_point?: { fully_played: boolean; resume_position_ms: number }
}

/** A show the user saved ("followed"), from `GET /me/shows`. */
export type SavedShow = { added_at: string; show: SpotifySimplifiedShow & { total_episodes?: number } }

/** An episode as a show's episode list has it: without the show. */
export type SpotifyShowEpisode = Omit<SpotifyEpisode, 'show'>

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
  /** Smart shuffle (Spotify's recommendations mixed in), when the client reports it. */
  smart_shuffle?: boolean
  /**
   * Controls Spotify won't allow right now, e.g. `{ disallows: { resuming: true, toggling_shuffle: true } }`
   * (only `true` entries are sent).
   */
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
