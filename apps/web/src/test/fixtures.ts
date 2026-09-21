import type {
  HistoryGap,
  ImportStatus,
  Me,
  PlaylistDetail,
  PlaylistsList,
  PlayItem,
  PlaysPage,
  RulePreview,
  SpotifyTop,
  StatsOverview,
  StatsTop,
  TrackDetail,
} from '@replay-crate/api-client'

// Fictional data for stories. Images are null so tests never hit the network.

export const pixelg: Me = { id: 'pixelg', displayName: 'Pixel G', imageUrl: null, needsReauth: false }

const hoursAgo = (hours: number) => new Date(Date.now() - hours * 3_600_000).toISOString()

const track = (id: string, name: string, artists: string[], album: string): PlayItem['track'] => ({
  id,
  name,
  durationMs: 213_000,
  explicit: false,
  album: { id: `album-${id}`, name: album, thumbUrl: null },
  artists: artists.map((artist, i) => ({ id: `${id}-artist-${i}`, name: artist })),
})

export const plays: PlayItem[] = [
  {
    playedAt: hoursAgo(0.2),
    msPlayed: null,
    source: 'poll',
    context: { type: 'playlist', uri: 'spotify:playlist:p1', name: 'Late Night Crate', imageUrl: null },
    track: track('t1', 'Brass Monkey Business', ['The Loop Collective', 'MC Vinyl'], 'Dusty Grooves'),
  },
  {
    playedAt: hoursAgo(0.3),
    msPlayed: null,
    source: 'poll',
    context: { type: 'album', uri: 'spotify:album:a2', name: 'Sunday Sessions', imageUrl: null },
    track: track('t2', 'Sunday Morning Static', ['Paper Kites Club'], 'Sunday Sessions'),
  },
  {
    playedAt: hoursAgo(26),
    msPlayed: null,
    source: 'poll',
    context: { type: 'collection', uri: 'spotify:user:pixelg:collection', name: 'Liked Songs', imageUrl: null },
    track: track('t3', 'A Very Long Track Title That Needs To Truncate Gracefully On Small Screens', ['Somebody'], 'Singles'),
  },
  {
    playedAt: hoursAgo(27),
    msPlayed: null,
    source: 'poll',
    context: { type: 'playlist', uri: 'spotify:playlist:discover', name: null, imageUrl: null },
    track: track('t1', 'Brass Monkey Business', ['The Loop Collective', 'MC Vinyl'], 'Dusty Grooves'),
  },
  {
    playedAt: hoursAgo(75),
    msPlayed: null,
    source: 'poll',
    context: null,
    track: track('t4', 'Searched And Played', ['Direct Hit'], 'Found It'),
  },
]

export const playsPage: PlaysPage = { items: plays, nextCursor: null, lastSyncedAt: hoursAgo(0.05) }

export const trackDetail: TrackDetail = {
  track: {
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
    { rank: 1, id: 't1', name: 'Brass Monkey Business', subtitle: 'The Loop Collective', imageUrl: null, plays: 27, minutes: 96 },
    { rank: 2, id: 't4', name: 'Searched And Played', subtitle: 'Direct Hit', imageUrl: null, plays: 18, minutes: 64 },
    { rank: 3, id: 't2', name: 'Sunday Morning Static', subtitle: 'Paper Kites Club', imageUrl: null, plays: 9, minutes: 31 },
    { rank: 4, id: 't3', name: 'A Very Long Track Title That Needs To Truncate Gracefully', subtitle: 'Somebody', imageUrl: null, plays: 1, minutes: 4 },
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
