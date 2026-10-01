import { SPOTIFY_SCOPES, SpotifyApiError } from '@replay-crate/spotify'
import type {
  Paging,
  PlayHistoryItem,
  SpotifyContext,
  SpotifyEpisode,
  SpotifyImage,
  SpotifyPlaylist,
  SpotifyPlaylistItem,
  SpotifyTrack,
  TokenResponse,
} from '@replay-crate/spotify'
import { MetadataApiError, type LastfmTag, type MusicBrainzGenre } from '@replay-crate/metadata'
import type { LastfmGateway, MusicBrainzGateway, SpotifyGateway } from './deps.ts'
import { createFakePlayer, type FakePlayer } from './fake-player.ts'

export { createFakePlayer, fakeDevices, type FakePlayer } from './fake-player.ts'

// A stand-in Spotify for unit tests (wrapped in vi.fn by testing.ts) and for the
// end-to-end server (e2e-server.ts). No test framework imports here.

export const tokens = (overrides: Partial<TokenResponse> = {}): TokenResponse => ({
  accessToken: 'access-1',
  refreshToken: 'refresh-1',
  expiresIn: 3600,
  scope: SPOTIFY_SCOPES.join(' '),
  ...overrides,
})

/** A Spotify track object. Artists are `[id, name]` pairs; the album defaults to one per track. */
export function track(
  id: string,
  options: { name?: string; album?: [id: string, name: string]; artists?: Array<[id: string, name: string]> } = {},
): SpotifyTrack {
  const [albumId, albumName] = options.album ?? [`album-${id}`, `Album ${id}`]
  const artists = (options.artists ?? [['artist-1', 'Artist One']]).map(([artistId, name]) => ({
    id: artistId,
    name,
    uri: `spotify:artist:${artistId}`,
  }))
  return {
    id,
    name: options.name ?? `Track ${id}`,
    uri: `spotify:track:${id}`,
    duration_ms: 200_000,
    explicit: false,
    is_local: false,
    external_ids: { isrc: `ISRC${id}` },
    album: {
      id: albumId,
      name: albumName,
      uri: `spotify:album:${albumId}`,
      album_type: 'album',
      release_date: '2024-05-01',
      release_date_precision: 'day',
      images: [
        { url: `https://i.scdn.co/${albumId}-300`, width: 300, height: 300 },
        { url: `https://i.scdn.co/${albumId}-64`, width: 64, height: 64 },
      ],
      artists: artists.slice(0, 1),
    },
    artists,
  }
}

/** A Spotify episode object; the show defaults to one per episode. */
export function episode(
  id: string,
  options: { name?: string; show?: [id: string, name: string]; durationMs?: number; releaseDate?: string } = {},
): SpotifyEpisode {
  const [showId, showName] = options.show ?? [`show-${id}`, `Show ${id}`]
  return {
    type: 'episode',
    id,
    name: options.name ?? `Episode ${id}`,
    uri: `spotify:episode:${id}`,
    duration_ms: options.durationMs ?? 3_600_000,
    explicit: false,
    images: [
      { url: `https://i.scdn.co/${id}-300`, width: 300, height: 300 },
      { url: `https://i.scdn.co/${id}-64`, width: 64, height: 64 },
    ],
    show: {
      id: showId,
      name: showName,
      uri: `spotify:show:${showId}`,
      images: [{ url: `https://i.scdn.co/${showId}-300`, width: 300, height: 300 }],
      description: `About ${showName}`,
    },
    description: `In this episode of ${showName}…`,
    release_date: options.releaseDate ?? '2026-09-01',
    release_date_precision: 'day',
  }
}

export const playlistContext = (id: string): SpotifyContext => ({ type: 'playlist', uri: `spotify:playlist:${id}` })

export function play(t: SpotifyTrack, playedAt: string, context: SpotifyContext | null = null): PlayHistoryItem {
  return { track: t, played_at: playedAt, context }
}

/** A `GET /me/playlists` entry owned by `ownerId` (default: the test user). */
export function playlist(
  id: string,
  options: { name?: string; ownerId?: string; snapshot?: string; total?: number; collaborative?: boolean } = {},
): SpotifyPlaylist {
  return {
    id,
    name: options.name ?? `Playlist ${id}`,
    description: null,
    images: [{ url: `https://i.scdn.co/${id}-300`, width: 300, height: 300 }],
    owner: { id: options.ownerId ?? 'pixelg', display_name: 'Pixel G' },
    collaborative: options.collaborative ?? false,
    public: true,
    snapshot_id: options.snapshot ?? `${id}-v1`,
    items: { total: options.total ?? 0 },
  }
}

export const playlistEntry = (t: SpotifyTrack, addedAt = '2026-01-01T00:00:00Z'): SpotifyPlaylistItem => ({
  added_at: addedAt,
  added_by: { id: 'pixelg' },
  is_local: false,
  item: t,
})

/** Serves `items` as Spotify-style pages of `pageSize`. */
export function paged<T>(items: T[], pageSize = 50) {
  return async (offset: number): Promise<Paging<T>> => ({
    items: items.slice(offset, offset + pageSize),
    next: offset + pageSize < items.length ? `next?offset=${offset + pageSize}` : null,
    total: items.length,
    offset,
    limit: pageSize,
  })
}

/**
 * In-memory stand-in for the user's Spotify playlists, so write operations can be
 * followed by a re-read exactly like against the real API.
 */
export function createFakeLibrary() {
  const store = new Map<string, { meta: SpotifyPlaylist; entries: SpotifyTrack[]; version: number }>()
  let nextId = 1
  /** When set, `GET /me/playlists` keeps returning these copies, like Spotify's lagging listing. */
  let frozenListing: SpotifyPlaylist[] | null = null

  const snapshot = (id: string) => {
    const playlist = store.get(id)!
    playlist.version++
    playlist.meta.snapshot_id = `${id}-v${playlist.version}`
    playlist.meta.items = { total: playlist.entries.length }
    return { snapshot_id: playlist.meta.snapshot_id }
  }
  const get = (id: string) => {
    const playlist = store.get(id)
    if (!playlist) throw new SpotifyApiError(404, `playlist ${id} not found`)
    return playlist
  }
  /** Every track the fake has seen, so adding by URI returns the real track like Spotify does. */
  const catalog = new Map<string, SpotifyTrack>()
  const remember = (tracks: SpotifyTrack[]) => {
    for (const t of tracks) if (t.id) catalog.set(t.id, t)
  }
  const trackFromUri = (uri: string) => {
    const id = uri.replace('spotify:track:', '')
    return catalog.get(id) ?? track(id)
  }
  /** Episodes the fake knows, and the user's place in each (Spotify's resume point). */
  const episodes = new Map<string, SpotifyEpisode>()
  const resumePoints = new Map<string, { fully_played: boolean; resume_position_ms: number }>()
  const episodeFromUri = (uri: string) => {
    const id = uri.replace('spotify:episode:', '')
    return episodes.get(id) ?? episode(id)
  }

  return {
    store,
    catalog,
    remember,
    trackFromUri,
    episodes,
    episodeFromUri,
    /** Episodes Spotify knows of (playing or looking up any other answers with a made-up one). */
    addEpisodes(...added: SpotifyEpisode[]) {
      for (const e of added) episodes.set(e.id, e)
    },
    /** Where Spotify says the user got to in an episode. */
    setResumePoint(id: string, point: { fully_played: boolean; resume_position_ms: number }) {
      resumePoints.set(id, point)
    },
    resumePoints,
    /** A playlist's tracks by `spotify:playlist:` URI, as the player plays them. */
    contextTracks: (uri: string) => store.get(uri.replace('spotify:playlist:', ''))?.entries,
    /** Seeds a playlist the user owns. */
    add(id: string, tracks: SpotifyTrack[], name = `Playlist ${id}`) {
      remember(tracks)
      store.set(id, { meta: playlist(id, { name, total: tracks.length }), entries: [...tracks], version: 1 })
    },
    trackIds: (id: string) => get(id).entries.map((entry) => entry.id),
    /** From now on the listing reports the current versions, even after later changes. */
    freezeListing() {
      frozenListing = [...store.values()].map((p) => ({ ...p.meta, items: { ...p.meta.items! } }))
    },
    has: (id: string) => store.has(id),
    snapshotOf: (id: string) => get(id).meta.snapshot_id,
    gateway: {
      getMyPlaylists: async (_token: string, offset: number) =>
        paged(frozenListing ?? [...store.values()].map((p) => ({ ...p.meta })))(offset),
      getPlaylistItems: async (_token: string, id: string, offset: number) =>
        paged(get(id).entries.map((entry) => playlistEntry(entry)))(offset),
      createPlaylist: async (_token: string, details: { name: string; description?: string; public?: boolean }) => {
        const id = `new-${nextId++}`
        store.set(id, {
          meta: { ...playlist(id, { name: details.name }), description: details.description ?? null, public: details.public ?? true, images: [] },
          entries: [],
          version: 1,
        })
        return { ...store.get(id)!.meta }
      },
      addPlaylistItems: async (_token: string, id: string, uris: string[], position?: number) => {
        const entries = get(id).entries
        entries.splice(position ?? entries.length, 0, ...uris.map(trackFromUri))
        return snapshot(id)
      },
      removePlaylistItems: async (_token: string, id: string, uris: string[]) => {
        const playlistEntries = get(id)
        playlistEntries.entries = playlistEntries.entries.filter((entry) => !uris.includes(entry.uri))
        return snapshot(id)
      },
      reorderPlaylistItems: async (
        _token: string,
        id: string,
        move: { rangeStart: number; insertBefore: number; snapshotId?: string },
      ) => {
        const playlistEntries = get(id)
        if (move.snapshotId && move.snapshotId !== playlistEntries.meta.snapshot_id) {
          throw new SpotifyApiError(400, 'snapshot mismatch')
        }
        const [moved] = playlistEntries.entries.splice(move.rangeStart, 1)
        const target = move.insertBefore > move.rangeStart ? move.insertBefore - 1 : move.insertBefore
        playlistEntries.entries.splice(target, 0, moved!)
        return snapshot(id)
      },
    },
  }
}

/** The fake player over `library`'s tracks and playlists (Premium, laptop active, nothing playing). */
export const fakePlayerFor = (library: ReturnType<typeof createFakeLibrary>, options: { now?: () => number } = {}) =>
  createFakePlayer({
    resolveTrack: library.trackFromUri,
    resolveEpisode: library.episodeFromUri,
    resolveContext: library.contextTracks,
    ...options,
  })

/** A Spotify gateway backed by `library`, with a fixed user and optional recent plays. */
export function createFakeSpotify(
  library: ReturnType<typeof createFakeLibrary>,
  {
    recentlyPlayed = () => [],
    topTracks = () => [],
    player = fakePlayerFor(library),
  }: { recentlyPlayed?: () => PlayHistoryItem[]; topTracks?: () => SpotifyTrack[]; player?: FakePlayer } = {},
): SpotifyGateway {
  return {
    exchangeCode: async () => tokens(),
    refreshAccessToken: async () => tokens({ accessToken: 'access-2', refreshToken: undefined }),
    getCurrentUser: async () => ({
      id: 'pixelg',
      display_name: 'Pixel G',
      images: [
        { url: 'https://i.scdn.co/image/small', width: 64, height: 64 },
        { url: 'https://i.scdn.co/image/large', width: 300, height: 300 },
      ],
    }),
    getRecentlyPlayed: async () => {
      const items = recentlyPlayed()
      library.remember(items.map((item) => item.track))
      return { items, cursors: null }
    },
    getPlaylistMeta: async (_token, id) => {
      const stored = library.store.get(id)?.meta
      return {
        id,
        name: stored?.name ?? `Playlist ${id}`,
        images: [{ url: `https://i.scdn.co/${id}`, width: 300, height: 300 }],
        owner: { id: 'pixelg', display_name: 'Pixel G' },
        // Live version for playlists in the fake library.
        snapshot_id: stored?.snapshot_id ?? `${id}-v1`,
      }
    },
    getAlbum: async (_token, id) => {
      throw new SpotifyApiError(404, `album ${id} not in the fake`)
    },
    getArtist: async (_token, id) => ({
      id,
      name: `Artist ${id}`,
      uri: `spotify:artist:${id}`,
      images: [{ url: `https://i.scdn.co/${id}`, width: 300, height: 300 }],
    }),
    getTopTracks: async () => paged(topTracks())(0),
    // Every track the fake knows (its playlists, recent plays, top tracks), by name or artist.
    searchTracks: async (_token, q, limit = 10) => {
      const words = q.toLowerCase().split(/\s+/).filter(Boolean)
      const known = new Map<string, SpotifyTrack>(library.catalog)
      for (const t of [...recentlyPlayed().map((item) => item.track), ...topTracks()]) if (t.id) known.set(t.id, t)
      const matches = [...known.values()].filter((t) => {
        const text = [t.name, ...t.artists.map((artist) => artist.name)].join(' ').toLowerCase()
        return words.every((word) => text.includes(word))
      })
      return paged(matches.slice(0, Math.min(limit, 10)))(0)
    },
    // Top artists are the credited artists of the top tracks, in order, with images.
    getTopArtists: async () => {
      const seen = new Map<string, { id: string; name: string; uri: string; images: SpotifyImage[] }>()
      for (const t of topTracks()) {
        for (const artist of t.artists) {
          if (!seen.has(artist.id)) {
            seen.set(artist.id, { ...artist, images: [{ url: `https://i.scdn.co/${artist.id}`, width: 300, height: 300 }] })
          }
        }
      }
      return paged([...seen.values()])(0)
    },
    // Tracks the fake has seen come back as themselves; anything else is a made-up track.
    getTrack: async (_token, id) => library.catalog.get(id) ?? track(id),
    // Only episodes the fake was told about; the resume point is left out until one is set, as
    // without the user-read-playback-position scope.
    getEpisode: async (_token, id) => {
      const known = library.episodes.get(id)
      if (!known) throw new SpotifyApiError(404, `episode ${id} not in the fake`)
      const point = library.resumePoints.get(id)
      return { ...known, ...(point && { resume_point: point }) }
    },
    ...library.gateway,
    ...player.gateway,
  }
}

type FakeMbArtist = { mbid: string; name: string; spotifyId?: string; genres: MusicBrainzGenre[] }
const counted = (tags: Record<string, number>) => Object.entries(tags).map(([name, count]) => ({ name, count }))

/**
 * Stand-ins for Last.fm and MusicBrainz, for artists' genres. Both know nothing until told, and
 * fail the way the real ones do: Last.fm with a 404 for a name it doesn't know, MusicBrainz with
 * a 404 for an unknown id and no match for an unknown link or name.
 */
export function createFakeMetadata() {
  const lastfmTags = new Map<string, LastfmTag[]>()
  const mbArtists: FakeMbArtist[] = []
  const byMbid = (mbid: string) => mbArtists.find((artist) => artist.mbid === mbid)

  const lastfm: LastfmGateway = {
    async getArtistTopTags(artist) {
      // Case-insensitive, like Last.fm's autocorrect for the easy cases.
      const tags = lastfmTags.get(artist.toLowerCase())
      if (!tags) throw new MetadataApiError(404, 'Last.fm error 6: The artist you supplied could not be found')
      return tags
    },
  }
  const musicbrainz: MusicBrainzGateway = {
    async findArtistBySpotifyId(spotifyId) {
      return mbArtists.find((artist) => artist.spotifyId === spotifyId)?.mbid ?? null
    },
    async searchArtists(name) {
      return mbArtists
        .filter((artist) => artist.name.toLowerCase() === name.toLowerCase())
        .map((artist) => ({ mbid: artist.mbid, name: artist.name, score: 100 }))
    },
    async getArtistGenres(mbid) {
      const artist = byMbid(mbid)
      if (!artist) throw new MetadataApiError(404, 'MusicBrainz answered 404 for /artist')
      return artist.genres
    },
  }

  return {
    lastfm,
    musicbrainz,
    /** Last.fm's tags for an artist's name, e.g. `{ rock: 100, 'seen live': 40 }`. */
    tagOnLastfm(name: string, tags: Record<string, number>) {
      lastfmTags.set(name.toLowerCase(), counted(tags))
    },
    /** An artist on MusicBrainz: its genres' vote counts, and its Spotify link when editors added one. */
    addToMusicBrainz(artist: { mbid: string; name: string; spotifyId?: string; genres: Record<string, number> }) {
      mbArtists.push({ ...artist, genres: counted(artist.genres) })
    },
  }
}
