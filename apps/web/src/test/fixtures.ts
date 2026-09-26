import type {
  Device,
  HistoryGap,
  ImportStatus,
  LibraryPage,
  Me,
  PlaylistDetail,
  Playback,
  PlayerItem,
  PlayerQueue,
  PlaylistsList,
  PlayItem,
  PlaysPage,
  RulePreview,
  SearchHit,
  SearchResponse,
  SpotifyTrackHit,
  SpotifyTop,
  StatsOverview,
  StatsTop,
  TrackDetail,
} from '@replay-crate/api-client'

// Fictional data for stories. Images are null so tests never hit the network.

export const pixelg: Me = { id: 'pixelg', displayName: 'Pixel G', imageUrl: null, needsReauth: false, missingScopes: [] }

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()

/**
 * Times for plays grouped by day, pinned to calendar days so "Today" and "Yesterday" hold at
 * any time of day (hour offsets from now cross midnight early in the morning).
 */
const startOfDay = (daysAgo: number) => {
  const day = new Date()
  day.setHours(0, 0, 0, 0)
  day.setDate(day.getDate() - daysAgo)
  return day.getTime()
}
/** `minutes` ago, but never before today's midnight (then a few seconds after it, keeping order). */
const today = (minutes: number) =>
  new Date(Math.max(Date.now() - minutes * 60_000, startOfDay(0) + (60 - minutes) * 1_000)).toISOString()
/** `hour`:00 local time, `daysAgo` days back. */
const dayAt = (daysAgo: number, hour: number) => new Date(startOfDay(daysAgo) + hour * 3_600_000).toISOString()

/** The user's star ratings of the fictional tracks; the rest are unrated. */
const ratings: Record<string, number> = { t1: 4, t3: 2 }
const ratingOf = (id: string) => ratings[id] ?? null

const track = (id: string, name: string, artists: string[], album: string): PlayItem['track'] => ({
  rating: ratingOf(id),
  id,
  name,
  durationMs: 213_000,
  explicit: false,
  album: { id: `album-${id}`, name: album, thumbUrl: null },
  artists: artists.map((artist, i) => ({ id: `${id}-artist-${i}`, name: artist })),
})

export const plays: PlayItem[] = [
  {
    playedAt: today(12),
    msPlayed: null,
    source: 'poll',
    context: { type: 'playlist', uri: 'spotify:playlist:p1', name: 'Late Night Crate', imageUrl: null },
    track: track('t1', 'Brass Monkey Business', ['The Loop Collective', 'MC Vinyl'], 'Dusty Grooves'),
  },
  {
    playedAt: today(18),
    msPlayed: null,
    source: 'poll',
    context: { type: 'album', uri: 'spotify:album:a2', name: 'Sunday Sessions', imageUrl: null },
    track: track('t2', 'Sunday Morning Static', ['Paper Kites Club'], 'Sunday Sessions'),
  },
  {
    playedAt: dayAt(1, 22),
    msPlayed: null,
    source: 'poll',
    context: { type: 'collection', uri: 'spotify:user:pixelg:collection', name: 'Liked Songs', imageUrl: null },
    track: track('t3', 'A Very Long Track Title That Needs To Truncate Gracefully On Small Screens', ['Somebody'], 'Singles'),
  },
  {
    playedAt: dayAt(1, 21),
    msPlayed: null,
    source: 'poll',
    context: { type: 'playlist', uri: 'spotify:playlist:discover', name: null, imageUrl: null },
    track: track('t1', 'Brass Monkey Business', ['The Loop Collective', 'MC Vinyl'], 'Dusty Grooves'),
  },
  {
    playedAt: dayAt(3, 18),
    msPlayed: null,
    source: 'poll',
    context: null,
    track: track('t4', 'Searched And Played', ['Direct Hit'], 'Found It'),
  },
]

export const playsPage: PlaysPage = { items: plays, nextCursor: null, lastSyncedAt: hoursAgo(0.05) }

export const trackDetail: TrackDetail = {
  track: {
    rating: ratingOf('t1'),
    id: 't1',
    name: 'Brass Monkey Business',
    durationMs: 213_000,
    explicit: false,
    album: { id: 'album-t1', name: 'Dusty Grooves', imageUrl: null, releaseDate: '1994-03-08' },
    artists: [
      { id: 'a1', name: 'The Loop Collective' },
      { id: 'a2', name: 'MC Vinyl' },
    ],
  },
  stats: { playCount: 12, firstPlayedAt: hoursAgo(24 * 40), lastPlayedAt: hoursAgo(0.2) },
  playedFrom: [
    {
      context: { type: 'playlist', uri: 'spotify:playlist:p1', name: 'Late Night Crate', imageUrl: null },
      playCount: 9,
      lastPlayedAt: hoursAgo(0.2),
    },
    { context: null, playCount: 3, lastPlayedAt: hoursAgo(27) },
  ],
  recentPlays: [
    {
      playedAt: hoursAgo(0.2),
      context: { type: 'playlist', uri: 'spotify:playlist:p1', name: 'Late Night Crate', imageUrl: null },
    },
    { playedAt: hoursAgo(27), context: null },
  ],
  playlists: [
    { id: 'p1', name: 'Late Night Crate', thumbUrl: null },
    { id: 'p2', name: 'Boom Bap Essentials', thumbUrl: null },
  ],
}

export const playlistsList: PlaylistsList = {
  syncedAt: hoursAgo(0.5),
  playlists: [
    {
      id: 'p1',
      name: 'Late Night Crate',
      thumbUrl: null,
      ownerName: 'Pixel G',
      owned: true,
      collaborative: false,
      isPublic: true,
      itemCount: 42,
      playsFrom: 318,
      lastPlayedFrom: hoursAgo(0.2),
    },
    {
      id: 'p2',
      name: 'Boom Bap Essentials',
      thumbUrl: null,
      ownerName: 'Pixel G',
      owned: true,
      collaborative: false,
      isPublic: false,
      itemCount: 120,
      playsFrom: 57,
      lastPlayedFrom: hoursAgo(30),
    },
    {
      id: 'p3',
      name: 'Road Trip (with Sam)',
      thumbUrl: null,
      ownerName: 'Sam',
      owned: false,
      collaborative: true,
      isPublic: false,
      itemCount: 18,
      playsFrom: 0,
      lastPlayedFrom: null,
    },
  ],
}

const playlistTrack = (
  position: number,
  t: PlayItem['track'],
  playCount: number,
  playsHere: number,
  alsoOn: Array<{ id: string; name: string }> = [],
): PlaylistDetail['items'][number] => ({
  position,
  addedAt: hoursAgo(24 * 90),
  track: t,
  playCount,
  playsHere,
  lastPlayedAt: playCount ? hoursAgo(position + 1) : null,
  alsoOn,
})

export const playlistDetail: PlaylistDetail = {
  playlist: {
    id: 'p1',
    name: 'Late Night Crate',
    description: 'Dusty loops for after midnight.',
    imageUrl: null,
    ownerName: 'Pixel G',
    owned: true,
    collaborative: false,
    isPublic: true,
    itemCount: 4,
    playsFrom: 318,
    itemsSynced: true,
  },
  items: [
    playlistTrack(0, plays[0]!.track, 12, 9, [
      { id: 'p2', name: 'Boom Bap Essentials' },
      { id: 'p3', name: 'Road Trip (with Sam)' },
      { id: 'p4', name: 'Gym' },
    ]),
    playlistTrack(1, plays[1]!.track, 3, 3),
    playlistTrack(2, plays[2]!.track, 0, 0, [{ id: 'p2', name: 'Boom Bap Essentials' }]),
    playlistTrack(3, plays[4]!.track, 27, 20),
  ],
}

export const rulePreview: RulePreview = {
  suggestedName: 'Top 50 · last 30 days',
  tracks: [
    { ...plays[4]!.track, album: { name: 'Found It', thumbUrl: null }, playCount: 27, lastPlayedAt: hoursAgo(1) },
    { ...plays[0]!.track, album: { name: 'Dusty Grooves', thumbUrl: null }, playCount: 12, lastPlayedAt: hoursAgo(0.2) },
    { ...plays[1]!.track, album: { name: 'Sunday Sessions', thumbUrl: null }, playCount: 3, lastPlayedAt: hoursAgo(0.3) },
  ].map(({ id, name, durationMs, album, artists, playCount, lastPlayedAt }) => ({
    id,
    name,
    durationMs,
    album,
    artists,
    playCount,
    lastPlayedAt,
  })),
}

/** 30 days of made-up listening ending today, as the overview endpoint returns it. */
export function statsOverview(days = 30): StatsOverview {
  const today = new Date()
  const series = Array.from({ length: days }, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i))
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const replays = 6 + ((i * 7) % 11)
    const newTracks = 2 + ((i * 5) % 7)
    return { date: iso, newTracks, replays, minutes: (replays + newTracks) * 3 }
  })
  const plays = series.reduce((sum, p) => sum + p.newTracks + p.replays, 0)
  return {
    range: '30d',
    tz: 'UTC',
    bucket: 'day',
    totals: {
      plays,
      minutes: series.reduce((sum, p) => sum + p.minutes, 0),
      tracks: 212,
      artists: 97,
      newTracks: series.reduce((sum, p) => sum + p.newTracks, 0),
    },
    series,
    openGaps: 0,
  }
}

export const statsTop: StatsTop = {
  type: 'tracks',
  range: '30d',
  metric: 'plays',
  limit: 10,
  items: [
    { rank: 1, id: 't1', name: 'Brass Monkey Business', subtitle: 'The Loop Collective', imageUrl: null, plays: 27, minutes: 96, rating: ratingOf('t1') },
    { rank: 2, id: 't4', name: 'Searched And Played', subtitle: 'Direct Hit', imageUrl: null, plays: 18, minutes: 64, rating: ratingOf('t4') },
    { rank: 3, id: 't2', name: 'Sunday Morning Static', subtitle: 'Paper Kites Club', imageUrl: null, plays: 9, minutes: 31, rating: ratingOf('t2') },
    { rank: 4, id: 't3', name: 'A Very Long Track Title That Needs To Truncate Gracefully', subtitle: 'Somebody', imageUrl: null, plays: 1, minutes: 4, rating: ratingOf('t3') },
  ],
}

export const spotifyTop: SpotifyTop = {
  type: 'tracks',
  timeRange: 'short_term',
  items: [
    { rank: 1, id: 't1', name: 'Brass Monkey Business', subtitle: 'The Loop Collective', imageUrl: null, plays: 27 },
    { rank: 2, id: 't9', name: 'Heard Elsewhere', subtitle: 'Other Device', imageUrl: null, plays: 0 },
  ],
}

/** One gap between the two older plays in `plays`. */
export const gaps: HistoryGap[] = [
  {
    id: 1,
    after: plays[4]!.playedAt,
    before: plays[3]!.playedAt,
    detectedAt: plays[3]!.playedAt,
  },
]

/** An import of about four years of history, uploaded an hour ago, still looking up tracks. */
export const importInProgress: ImportStatus = {
  id: 1,
  playCount: 48_213,
  earliest: '2021-02-14T19:03:00.000Z',
  latest: '2025-06-30T22:41:00.000Z',
  unavailable: 0,
  createdAt: hoursAgo(1.1),
  uploadedAt: hoursAgo(1),
  waitingPlays: 16_870,
  tracksToFetch: 2_904,
  done: false,
}

export const importDone: ImportStatus = {
  ...importInProgress,
  unavailable: 37,
  waitingPlays: 0,
  tracksToFetch: 0,
  done: true,
}

// Player. The laptop is playing "Brass Monkey Business" from Late Night Crate, 1:21 in.

export const devices: Device[] = [
  {
    id: 'laptop',
    name: 'Studio Laptop',
    type: 'Computer',
    isActive: true,
    isRestricted: false,
    isPrivateSession: false,
    volumePercent: 70,
    supportsVolume: true,
  },
  {
    id: 'phone',
    name: 'Pixel Phone',
    type: 'Smartphone',
    isActive: false,
    isRestricted: false,
    isPrivateSession: false,
    volumePercent: 100,
    supportsVolume: false,
  },
  {
    id: 'kitchen',
    name: 'Kitchen Speaker',
    type: 'Speaker',
    isActive: false,
    isRestricted: false,
    isPrivateSession: false,
    volumePercent: 35,
    supportsVolume: true,
  },
]

const playerTrack = (id: string, name: string, artists: string[], album: string): PlayerItem => ({
  type: 'track',
  rating: ratingOf(id),
  id,
  uri: `spotify:track:${id}`,
  name,
  durationMs: 213_000,
  explicit: false,
  album: { id: `album-${id}`, name: album, imageUrl: null, thumbUrl: null },
  artists: artists.map((artist, i) => ({ id: `${id}-artist-${i}`, name: artist })),
})

export const nowPlaying = playerTrack('t1', 'Brass Monkey Business', ['The Loop Collective', 'MC Vinyl'], 'Dusty Grooves')

export const playback: Playback = {
  device: devices[0]!,
  isPlaying: true,
  progressMs: 81_000,
  shuffle: false,
  repeat: 'off',
  context: { type: 'playlist', uri: 'spotify:playlist:p1', name: 'Late Night Crate', imageUrl: null },
  item: nowPlaying,
  disallows: ['resuming'],
}

export const pausedPlayback: Playback = { ...playback, isPlaying: false, disallows: ['pausing'] }

export const queue: PlayerQueue = {
  currentlyPlaying: nowPlaying,
  queue: [
    playerTrack('t2', 'Sunday Morning Static', ['Paper Kites Club'], 'Sunday Sessions'),
    playerTrack('t5', 'Crate Digger', ['Needle Drop'], 'Wax Poetics'),
    {
      type: 'episode',
      id: 'e1',
      uri: 'spotify:episode:e1',
      name: 'The History of the Breakbeat',
      durationMs: 2_700_000,
      explicit: false,
      show: { id: 's1', name: 'Sample Science' },
      imageUrl: null,
      thumbUrl: null,
    },
  ],
}

// Tracks library: every track played, most played first.
export const libraryPage: LibraryPage = {
  items: [
    { track: plays[0]!.track, playCount: 12, firstPlayedAt: hoursAgo(24 * 40), lastPlayedAt: plays[0]!.playedAt },
    { track: plays[4]!.track, playCount: 7, firstPlayedAt: hoursAgo(24 * 20), lastPlayedAt: plays[4]!.playedAt },
    { track: plays[1]!.track, playCount: 3, firstPlayedAt: hoursAgo(24 * 9), lastPlayedAt: plays[1]!.playedAt },
    { track: plays[2]!.track, playCount: 1, firstPlayedAt: plays[2]!.playedAt, lastPlayedAt: plays[2]!.playedAt },
  ],
  nextCursor: null,
  total: 4,
}

// Long lists, for paging. Names count up ("Crate Cut 01", …) so a page's rows are easy to name.
const pad = (n: number) => String(n).padStart(2, '0')

/** `count` plays, newest first, three a day starting yesterday evening. */
export const manyPlays = (count: number): PlayItem[] =>
  Array.from({ length: count }, (_, i) => ({
    playedAt: dayAt(1 + Math.floor(i / 3), 21 - (i % 3)),
    msPlayed: null,
    source: 'poll' as const,
    context: null,
    track: track(`cut-${pad(i + 1)}`, `Crate Cut ${pad(i + 1)}`, ['The Loop Collective'], 'Deep Crates'),
  }))

/** `count` library tracks, most played first. */
export const manyTracks = (count: number): LibraryPage['items'] =>
  manyPlays(count).map((play, i) => ({
    track: play.track,
    playCount: count - i,
    firstPlayedAt: play.playedAt,
    lastPlayedAt: play.playedAt,
  }))
// Search: what "pete" finds in the fixture library.
const hit = (partial: Partial<SearchHit> & Pick<SearchHit, 'type' | 'id' | 'name'>): SearchHit => ({
  artists: [],
  album: null,
  year: null,
  playCount: 0,
  rating: null,
  lastPlayedAt: null,
  playedAt: null,
  context: null,
  imageUrl: null,
  trackId: null,
  score: 1,
  highlights: { name: [], artists: [] },
  ...partial,
})

export const searchResponse: SearchResponse = {
  query: { text: 'pete', filters: [], issues: [] },
  engine: 'postgres',
  tookMs: 4,
  total: 5,
  groups: [
    {
      type: 'track',
      total: 2,
      hits: [
        hit({
          type: 'track',
          id: 'troy',
          name: 'T.R.O.Y. (They Reminisce Over You)',
          artists: ['Pete Rock', 'C.L. Smooth'],
          album: 'Mecca and the Soul Brother',
          year: 1992,
          playCount: 30,
          rating: 5,
          lastPlayedAt: hoursAgo(2),
          score: 3.1,
          highlights: { name: [], artists: [[[0, 4]], []] },
        }),
        hit({
          type: 'track',
          id: 'soul',
          name: 'Straighten It Out',
          artists: ['Pete Rock', 'C.L. Smooth'],
          album: 'Mecca and the Soul Brother',
          year: 1992,
          playCount: 6,
          score: 2.4,
          highlights: { name: [], artists: [[[0, 4]], []] },
        }),
      ],
    },
    {
      type: 'artist',
      total: 1,
      hits: [hit({ type: 'artist', id: 'pete', name: 'Pete Rock', playCount: 36, score: 4.2, highlights: { name: [[0, 4]], artists: [] } })],
    },
    {
      type: 'album',
      total: 1,
      hits: [
        hit({
          type: 'album',
          id: 'mecca',
          name: 'Mecca and the Soul Brother',
          artists: ['Pete Rock', 'C.L. Smooth'],
          year: 1992,
          playCount: 36,
          score: 1.9,
          highlights: { name: [], artists: [[[0, 4]], []] },
        }),
      ],
    },
    {
      type: 'play',
      total: 1,
      hits: [
        hit({
          type: 'play',
          id: '101',
          name: 'T.R.O.Y. (They Reminisce Over You)',
          artists: ['Pete Rock', 'C.L. Smooth'],
          album: 'Mecca and the Soul Brother',
          playedAt: hoursAgo(2),
          context: 'Road Trip',
          trackId: 'troy',
          rating: 5,
          score: 1.5,
          highlights: { name: [], artists: [[[0, 4]], []] },
        }),
      ],
    },
  ],
  facets: {
    types: [
      { value: 'track', count: 2 },
      { value: 'artist', count: 1 },
      { value: 'album', count: 1 },
      { value: 'play', count: 1 },
    ],
    decades: [{ value: 1990, count: 2 }],
    ratings: [{ value: 5, count: 1 }],
    artists: [
      { value: 'Pete Rock', count: 2 },
      { value: 'C.L. Smooth', count: 2 },
    ],
    contexts: [{ value: 'Road Trip', count: 1 }],
  },
  suggestion: null,
}

/** What Spotify's catalogue has for "pete": one you've played, and two you haven't. */
export const spotifyTracks: SpotifyTrackHit[] = [
  { id: 'troy', name: 'T.R.O.Y. (They Reminisce Over You)', artists: ['Pete Rock', 'C.L. Smooth'], album: 'Mecca and the Soul Brother', imageUrl: null, durationMs: 283_000, explicit: false, playCount: 30 },
  { id: 'lots', name: 'Lots of Lovin', artists: ['Pete Rock', 'C.L. Smooth'], album: 'All Souled Out', imageUrl: null, durationMs: 250_000, explicit: false, playCount: 0 },
  { id: 'rock-box', name: 'Rock Box', artists: ['Run-DMC'], album: 'Run-D.M.C.', imageUrl: null, durationMs: 330_000, explicit: false, playCount: 0 },
]
