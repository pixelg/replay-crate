import type {
  Device,
  SpotifyPodcastHits,
  NewEpisodes,
  ListensTimeline,
  PodcastStatsCalendar,
  PodcastStatsOverview,
  PodcastStatsTop,
  EpisodeDetail,
  EpisodesPage,
  EpisodeSummary,
  ListenedShow,
  ListenItem,
  ListensPage,
  ShowDetail,
  ShowRef,
  ShowsList,
  GenrePlays,
  GenreRef,
  HistoryGap,
  HistoryTimeline,
  ImportStatus,
  LibraryPage,
  Me,
  OnThisDay,
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
  StatsCalendar,
  StatsOverview,
  StatsTop,
  TrackDetail,
} from '@replay-crate/api-client'
import { localDayKey } from '@replay-crate/core'

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

/** Genres from the canonical list (ids are fictional). */
export const genre = {
  hipHop: { id: 957, name: 'hip hop' },
  boomBap: { id: 234, name: 'boom bap' },
  jazz: { id: 1041, name: 'jazz' },
  indiePop: { id: 1003, name: 'indie pop' },
  dreamPop: { id: 551, name: 'dream pop' },
  funk: { id: 640, name: 'funk' },
} satisfies Record<string, GenreRef>

/** The fictional tracks' genres, as History lists them (t3's artist hasn't been looked up yet). */
const trackGenres: Record<string, GenreRef[]> = {
  t1: [genre.hipHop, genre.boomBap, genre.jazz],
  t2: [genre.indiePop, genre.dreamPop],
  t4: [genre.funk],
}

/** The fictional tracks' places in the fixture playlists (t1 was played from Late Night Crate). */
const trackPlaylists: Record<string, PlayItem['track']['playlists']> = {
  t1: [
    { id: 'p1', name: 'Late Night Crate' },
    { id: 'p2', name: 'Boom Bap Essentials' },
  ],
  t2: [{ id: 'p3', name: 'Road Trip (with Sam)' }],
}

const track = (id: string, name: string, artists: string[], album: string): PlayItem['track'] => ({
  rating: ratingOf(id),
  id,
  name,
  durationMs: 213_000,
  explicit: false,
  album: { id: `album-${id}`, name: album, thumbUrl: null },
  artists: artists.map((artist, i) => ({ id: `${id}-artist-${i}`, name: artist })),
  genres: trackGenres[id] ?? [],
  playlists: trackPlaylists[id] ?? [],
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

/** The genres in the fictional plays, most played first. */
export const genres: GenrePlays[] = [
  { ...genre.hipHop, playCount: 2 },
  { ...genre.boomBap, playCount: 2 },
  { ...genre.jazz, playCount: 2 },
  { ...genre.dreamPop, playCount: 1 },
  { ...genre.funk, playCount: 1 },
  { ...genre.indiePop, playCount: 1 },
]

export const trackDetail: TrackDetail = {
  track: {
    rating: ratingOf('t1'),
    id: 't1',
    name: 'Brass Monkey Business',
    durationMs: 213_000,
    explicit: false,
    album: { id: 'album-t1', name: 'Dusty Grooves', imageUrl: null, releaseDate: '1994-03-08' },
    artists: [
      { id: 'a1', name: 'The Loop Collective', genres: [genre.hipHop, genre.boomBap] },
      { id: 'a2', name: 'MC Vinyl', genres: [genre.jazz, genre.hipHop] },
    ],
    genres: [genre.hipHop, genre.boomBap, genre.jazz],
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
      trackCount: 42,
      episodeCount: 0,
      playsFrom: 318,
      lastPlayedFrom: hoursAgo(0.2),
      lastAddedAt: hoursAgo(48),
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
      trackCount: 118,
      episodeCount: 2,
      playsFrom: 57,
      lastPlayedFrom: hoursAgo(30),
      // The one being built: added to a few minutes ago.
      lastAddedAt: hoursAgo(0.1),
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
      trackCount: 18,
      episodeCount: 0,
      playsFrom: 0,
      lastPlayedFrom: null,
      lastAddedAt: null,
    },
    // Podcasts only: music mode leaves it out.
    {
      id: 'p5',
      name: 'Commute',
      thumbUrl: null,
      ownerName: 'Pixel G',
      owned: true,
      collaborative: false,
      isPublic: false,
      itemCount: 3,
      trackCount: 0,
      episodeCount: 3,
      playsFrom: 0,
      lastPlayedFrom: null,
      lastAddedAt: hoursAgo(5),
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
  episodes: [],
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
/** Top artists in the stats fixture, each with a run: one peaks early, one mid-month, one late. */
const overviewArtists = [
  { id: 'pete', name: 'Pete Rock', peak: 0.25 },
  { id: 'atcq', name: 'A Tribe Called Quest', peak: 0.55 },
  { id: 'showbiz', name: 'Showbiz & A.G.', peak: 0.85 },
  { id: 'miilkbone', name: 'Miilkbone', peak: 0.5 },
]

export function statsOverview(days = 30): StatsOverview {
  const today = new Date()
  const series = Array.from({ length: days }, (_, i) => {
    const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (days - 1 - i))
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const at = i / Math.max(1, days - 1)
    const byArtist = overviewArtists.map((artist, n) => {
      const plays = Math.max(0, Math.round((n === 3 ? 2 : 7) - Math.abs(at - artist.peak) * 18))
      return { plays, minutes: plays * (3 + n) }
    })
    const othersPlays = 3 + ((i * 5) % 4)
    const others = { plays: othersPlays, minutes: othersPlays * 4 }
    const all = byArtist.reduce((sum, a) => sum + a.plays, 0) + othersPlays
    const newTracks = 1 + ((i * 5) % 3)
    return {
      date: iso,
      newTracks,
      replays: all - newTracks,
      minutes: byArtist.reduce((sum, a) => sum + a.minutes, 0) + others.minutes,
      byArtist,
      others,
    }
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
    artists: overviewArtists.map((artist, n) => ({
      id: artist.id,
      name: artist.name,
      plays: series.reduce((sum, p) => sum + p.byArtist[n]!.plays, 0),
      minutes: series.reduce((sum, p) => sum + p.byArtist[n]!.minutes, 0),
    })),
    series,
    openGaps: 0,
  }
}

export const statsTop: StatsTop = {
  type: 'tracks',
  range: '30d',
  tz: 'UTC',
  metric: 'plays',
  limit: 10,
  items: [
    { rank: 1, id: 't1', name: 'Brass Monkey Business', subtitle: 'The Loop Collective', imageUrl: null, plays: 27, minutes: 96, rating: ratingOf('t1') },
    { rank: 2, id: 't4', name: 'Searched And Played', subtitle: 'Direct Hit', imageUrl: null, plays: 18, minutes: 64, rating: ratingOf('t4') },
    { rank: 3, id: 't2', name: 'Sunday Morning Static', subtitle: 'Paper Kites Club', imageUrl: null, plays: 9, minutes: 31, rating: ratingOf('t2') },
    { rank: 4, id: 't3', name: 'A Very Long Track Title That Needs To Truncate Gracefully', subtitle: 'Somebody', imageUrl: null, plays: 1, minutes: 4, rating: ratingOf('t3') },
  ],
}

/** The top genres for the same plays: a play counts for each genre its artists have. */
export const topGenres: StatsTop['items'] = [
  { rank: 1, id: String(genre.hipHop.id), name: 'hip hop', subtitle: '2 artists', imageUrl: null, plays: 27, minutes: 96, rating: null },
  { rank: 2, id: String(genre.boomBap.id), name: 'boom bap', subtitle: '1 artist', imageUrl: null, plays: 27, minutes: 96, rating: null },
  { rank: 3, id: String(genre.funk.id), name: 'funk', subtitle: '1 artist', imageUrl: null, plays: 18, minutes: 64, rating: null },
  { rank: 4, id: String(genre.indiePop.id), name: 'indie pop', subtitle: '1 artist', imageUrl: null, plays: 9, minutes: 31, rating: null },
]

export const spotifyTop: SpotifyTop = {
  type: 'tracks',
  timeRange: 'short_term',
  items: [
    { rank: 1, id: 't1', name: 'Brass Monkey Business', subtitle: 'The Loop Collective', imageUrl: null, plays: 27 },
    { rank: 2, id: 't9', name: 'Heard Elsewhere', subtitle: 'Other Device', imageUrl: null, plays: 0 },
  ],
}

const thisYear = new Date().getFullYear()
const localToday = localDayKey(new Date())
/** The years `statsCalendar` has plays in: a gap in 2020, then every year to this one. */
export const calendarYears = [...new Set([2019, 2021, 2022, 2023, 2024, 2025, thisYear])]

/**
 * Plays per day through `year` (up to today): busier at weekends, with a few days off. Deterministic,
 * so a story can name a day's count.
 */
export function statsCalendar(year = thisYear): StatsCalendar {
  const days: StatsCalendar['days'] = []
  for (let day = new Date(Date.UTC(year, 0, 1)); day.getUTCFullYear() === year; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10)
    if (date > localToday) break
    const [dayOfMonth, month, weekday] = [day.getUTCDate(), day.getUTCMonth(), day.getUTCDay()]
    if ((dayOfMonth * 7 + month * 3) % 11 === 0) continue
    days.push({ date, plays: ((dayOfMonth * 13 + month * 29 + weekday * 5) % 40) + (weekday === 0 || weekday === 6 ? 25 : 5) })
  }
  return { year, tz: 'UTC', years: calendarYears, days }
}

/** Today in three earlier years. */
export const onThisDay: OnThisDay = (() => {
  const [year, monthDay] = [thisYear, localToday.slice(4)]
  const tracks = Object.fromEntries(plays.map((play) => [play.track.id, play.track]))
  return {
    date: `${year}${monthDay}`,
    years: [
      {
        year: year - 1,
        date: `${year - 1}${monthDay}`,
        plays: 42,
        tracks: [
          { track: tracks.t1!, plays: 6 },
          { track: tracks.t2!, plays: 4 },
          { track: tracks.t3!, plays: 3 },
          { track: tracks.t4!, plays: 1 },
        ],
      },
      { year: year - 3, date: `${year - 3}${monthDay}`, plays: 17, tracks: [{ track: tracks.t4!, plays: 5 }, { track: tracks.t2!, plays: 2 }] },
      { year: year - 7, date: `${year - 7}${monthDay}`, plays: 1, tracks: [{ track: tracks.t2!, plays: 1 }] },
    ],
  }
})()

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
  listenCount: 0,
  listensUnavailable: 0,
  waitingListens: 0,
  episodesToFetch: 0,
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
// Three devices have Spotify open; two more were played on before.

const laptop: Playback['device'] = {
  id: 'laptop',
  name: 'Studio Laptop',
  type: 'Computer',
  isActive: true,
  isRestricted: false,
  isPrivateSession: false,
  volumePercent: 70,
  supportsVolume: true,
}

/** What the player shows of a device Spotify doesn't list now. */
const rememberedDevice = (rememberedId: number, id: string | null, name: string, type: string, lastSeenAt: string): Device => ({
  id,
  name,
  type,
  isActive: false,
  isRestricted: false,
  isPrivateSession: false,
  volumePercent: null,
  supportsVolume: false,
  isAvailable: false,
  lastSeenAt,
  rememberedId,
})

export const devices: Device[] = [
  { ...laptop, isAvailable: true, lastSeenAt: hoursAgo(0), rememberedId: 1 },
  {
    id: 'phone',
    name: 'Pixel Phone',
    type: 'Smartphone',
    isActive: false,
    isRestricted: false,
    isPrivateSession: false,
    volumePercent: 100,
    supportsVolume: false,
    isAvailable: true,
    lastSeenAt: hoursAgo(0),
    rememberedId: 2,
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
    isAvailable: true,
    lastSeenAt: hoursAgo(0),
    rememberedId: 3,
  },
  rememberedDevice(4, 'living-room', 'Living Room TV', 'TV', dayAt(2, 21)),
  // Spotify can't address this one, so there's no trying it.
  rememberedDevice(5, null, 'Car Stereo', 'Automobile', dayAt(12, 8)),
]

const playerTrack = (id: string, name: string, artists: string[], album: string, rating = ratingOf(id)): PlayerItem => ({
  type: 'track',
  rating,
  id,
  uri: `spotify:track:${id}`,
  name,
  durationMs: 213_000,
  explicit: false,
  album: { id: `album-${id}`, name: album, imageUrl: null, thumbUrl: null },
  artists: artists.map((artist, i) => ({ id: `${id}-artist-${i}`, name: artist })),
  genres: trackGenres[id] ?? [],
})

export const nowPlaying = playerTrack('t1', 'Brass Monkey Business', ['The Loop Collective', 'MC Vinyl'], 'Dusty Grooves')

export const playback: Playback = {
  device: laptop,
  isPlaying: true,
  progressMs: 81_000,
  shuffle: false,
  repeat: 'off',
  context: { type: 'playlist', uri: 'spotify:playlist:p1', name: 'Late Night Crate', imageUrl: null },
  fromQueue: false,
  item: nowPlaying,
  disallows: ['resuming'],
}

export const pausedPlayback: Playback = { ...playback, isPlaying: false, disallows: ['pausing'] }

export const queue: PlayerQueue = {
  currentlyPlaying: nowPlaying,
  queue: [
    playerTrack('t2', 'Sunday Morning Static', ['Paper Kites Club'], 'Sunday Sessions'),
    playerTrack('t5', 'Crate Digger', ['Needle Drop'], 'Wax Poetics', 5),
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
    // Found years ago, from the imported history.
    { track: plays[0]!.track, playCount: 12, firstPlayedAt: '2019-03-14T20:00:00.000Z', lastPlayedAt: plays[0]!.playedAt },
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

/**
 * Plays per month, newest first, like an imported history: from this month back to June 2011,
 * busier each era, with nothing from January to August 2014.
 */
export const timeline: HistoryTimeline = {
  months: Array.from({ length: 12 * 20 }, (_, i) => {
    const now = new Date()
    return new Date(now.getFullYear(), now.getMonth() - i, 1)
  })
    .filter((date) => date >= new Date(2011, 5, 1) && !(date.getFullYear() === 2014 && date.getMonth() < 8))
    .map((date) => {
      const year = date.getFullYear()
      const base = year >= 2022 ? 2400 : year >= 2019 ? 500 : 150
      return { month: `${year}-${pad(date.getMonth() + 1)}`, plays: base + ((date.getMonth() * 37 + year) % 11) * Math.round(base / 10) }
    }),
}

/** `count` plays at the end of March 2019, newest first, two an evening: what a jump to that month opens. */
export const march2019Plays = (count: number): PlayItem[] =>
  Array.from({ length: count }, (_, i) => ({
    playedAt: new Date(2019, 2, 31 - Math.floor(i / 2), 21 - (i % 2)).toISOString(),
    msPlayed: 200_000,
    source: 'import' as const,
    context: null,
    track: track(`old-${pad(i + 1)}`, `Old Favourite ${pad(i + 1)}`, ['Showbiz & A.G.'], 'Runaway Slave'),
  }))

// Search: what "pete" finds in the fixture library.
const hit = (partial: Partial<SearchHit> & Pick<SearchHit, 'type' | 'id' | 'name'>): SearchHit => ({
  artists: [],
  album: null,
  genres: [],
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
          genres: ['hip hop', 'boom bap'],
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
          genres: ['hip hop', 'boom bap'],
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
      hits: [hit({ type: 'artist', id: 'pete', name: 'Pete Rock', genres: ['hip hop', 'boom bap'], playCount: 36, score: 4.2, highlights: { name: [[0, 4]], artists: [] } })],
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
    genres: [
      { value: 'boom bap', count: 2 },
      { value: 'hip hop', count: 2 },
    ],
  },
  suggestion: null,
}

/** What Spotify's catalogue has for "pete": one you've played, and two you haven't. */
export const spotifyTracks: SpotifyTrackHit[] = [
  { id: 'troy', name: 'T.R.O.Y. (They Reminisce Over You)', artists: ['Pete Rock', 'C.L. Smooth'], album: 'Mecca and the Soul Brother', imageUrl: null, durationMs: 283_000, explicit: false, playCount: 30 },
  { id: 'lots', name: 'Lots of Lovin', artists: ['Pete Rock', 'C.L. Smooth'], album: 'All Souled Out', imageUrl: null, durationMs: 250_000, explicit: false, playCount: 0 },
  { id: 'rock-box', name: 'Rock Box', artists: ['Run-DMC'], album: 'Run-D.M.C.', imageUrl: null, durationMs: 330_000, explicit: false, playCount: 0 },
]

// Podcasts: two shows, a few episodes, and listens to them over the last days.

const sampleScience = { id: 's1', name: 'Sample Science', thumbUrl: null }
const crateTalk = { id: 's2', name: 'Crate Talk', thumbUrl: null }
const MIN = 60_000

const episodeSummary = (
  id: string,
  name: string,
  show: ShowRef,
  { durationMs = 45 * MIN, releaseDate = '2026-09-01', progress = null as EpisodeSummary['progress'], rating = null as number | null } = {},
): EpisodeSummary => ({ id, name, durationMs, explicit: false, releaseDate, thumbUrl: null, show, progress, rating })

export const episodes = {
  breakbeat: episodeSummary('e1', 'The History of the Breakbeat', sampleScience, {
    durationMs: 45 * MIN,
    releaseDate: '2026-09-24',
    progress: { resumePositionMs: 18 * MIN, fullyPlayed: false },
    rating: 4,
  }),
  amen: episodeSummary('e2', 'Six Seconds of Amen', sampleScience, {
    durationMs: 38 * MIN,
    releaseDate: '2026-09-10',
    progress: { resumePositionMs: 38 * MIN, fullyPlayed: true },
  }),
  digging: episodeSummary('e3', 'Digging in Osaka', crateTalk, {
    durationMs: 62 * MIN,
    releaseDate: '2026-09-28',
    progress: { resumePositionMs: 4 * MIN, fullyPlayed: false },
  }),
}

const listen = (id: number, episode: EpisodeSummary, endedAt: string, listenedMs: number, from: number | null = 0): ListenItem => ({
  id,
  startedAt: new Date(Date.parse(endedAt) - listenedMs).toISOString(),
  endedAt,
  listenedMs,
  startPositionMs: from,
  endPositionMs: from === null ? null : from + listenedMs,
  source: from === null ? 'import' : 'poll',
  episode,
})

export const listens: ListenItem[] = [
  listen(5, episodes.digging, today(20), 4 * MIN),
  listen(4, episodes.breakbeat, dayAt(1, 9), 10 * MIN, 8 * MIN),
  listen(3, episodes.breakbeat, dayAt(1, 8), 8 * MIN),
  listen(2, episodes.amen, dayAt(3, 18), 38 * MIN),
  listen(1, episodes.amen, dayAt(40, 18), 12 * MIN, null),
]

export const listensPage: ListensPage = { items: listens, nextCursor: null }

export const listenedShows: ListenedShow[] = [
  { ...sampleScience, listens: 4 },
  { ...crateTalk, listens: 1 },
]

export const episodesPage: EpisodesPage = {
  items: [
    { episode: episodes.digging, listens: 1, listenedMs: 4 * MIN, lastListenedAt: listens[0]!.endedAt },
    { episode: episodes.breakbeat, listens: 2, listenedMs: 18 * MIN, lastListenedAt: listens[1]!.endedAt },
    { episode: episodes.amen, listens: 2, listenedMs: 50 * MIN, lastListenedAt: listens[3]!.endedAt },
  ],
  total: 3,
}

export const showsList: ShowsList = {
  items: [
    { show: crateTalk, followed: false, stats: { episodes: 1, listens: 1, listenedMs: 4 * MIN, lastListenedAt: listens[0]!.endedAt } },
    { show: sampleScience, followed: true, stats: { episodes: 2, listens: 4, listenedMs: 68 * MIN, lastListenedAt: listens[1]!.endedAt } },
    // Followed on Spotify, never listened to here.
    { show: { id: 's3', name: 'Liner Notes', thumbUrl: null }, followed: true, stats: { episodes: 0, listens: 0, listenedMs: 0, lastListenedAt: null } },
  ],
  syncedAt: hoursAgo(0.2),
}

/** New from the shows the user follows: one untouched, one started. */
export const newEpisodes: NewEpisodes = {
  items: [
    episodeSummary('e4', 'Chopping Soul', sampleScience, { releaseDate: localDayKey(new Date()) }),
    episodeSummary('e5', 'The Gatefold Issue', { id: 's3', name: 'Liner Notes', thumbUrl: null }, {
      releaseDate: '2026-09-25',
      progress: { resumePositionMs: 9 * MIN, fullyPlayed: false },
    }),
  ],
  syncedAt: hoursAgo(0.2),
}

export const episodeDetail: EpisodeDetail = {
  episode: {
    ...episodes.breakbeat,
    description: 'Where the break came from: a drummer, a turntable, and a block party in the Bronx.',
    imageUrl: null,
  },
  stats: { listens: 2, listenedMs: 18 * MIN, firstListenedAt: listens[2]!.startedAt, lastListenedAt: listens[1]!.endedAt },
  recentListens: [listens[1]!, listens[2]!].map(({ id, startedAt, endedAt, listenedMs, startPositionMs, endPositionMs, source }) => ({
    id,
    startedAt,
    endedAt,
    listenedMs,
    startPositionMs,
    endPositionMs,
    source,
  })),
}

export const showDetail: ShowDetail = {
  show: { ...sampleScience, description: 'Where the samples in your favourite records came from.', imageUrl: null },
  followed: true,
  stats: { episodes: 2, listens: 4, listenedMs: 68 * MIN, lastListenedAt: listens[1]!.endedAt },
  episodes: [
    { episode: episodeSummary('e4', 'Chopping Soul', sampleScience, { releaseDate: '2026-09-30' }), listens: 0, listenedMs: 0, lastListenedAt: null },
    { episode: episodes.breakbeat, listens: 2, listenedMs: 18 * MIN, lastListenedAt: listens[1]!.endedAt },
    { episode: episodes.amen, listens: 2, listenedMs: 50 * MIN, lastListenedAt: listens[3]!.endedAt },
  ],
}

/** The breakbeat episode on the player, 18 minutes in. */
export const playingEpisode: Extract<PlayerItem, { type: 'episode' }> = {
  type: 'episode',
  id: 'e1',
  uri: 'spotify:episode:e1',
  name: 'The History of the Breakbeat',
  durationMs: 45 * MIN,
  explicit: false,
  show: { id: 's1', name: 'Sample Science' },
  imageUrl: null,
  thumbUrl: null,
}

export const episodePlayback: Playback = { ...playback, context: null, item: playingEpisode, progressMs: 18 * MIN }

/** Podcast stats over `days` days: two shows, most days a bit of each. */
export function podcastStatsOverview(days = 30): PodcastStatsOverview {
  const series = Array.from({ length: days }, (_, i) => {
    const date = localDayKey(new Date(Date.now() - (days - 1 - i) * 86_400_000))
    const science = i % 3 === 0 ? 0 : 20 + (i % 5) * 6
    const talk = i % 4 === 0 ? 35 : 0
    return {
      date,
      listens: (science ? 1 : 0) + (talk ? 1 : 0),
      minutes: science + talk,
      byShow: [
        { listens: science ? 1 : 0, minutes: science },
        { listens: talk ? 1 : 0, minutes: talk },
      ],
      others: { listens: 0, minutes: 0 },
    }
  })
  const sum = (pick: (point: (typeof series)[number]) => number) => series.reduce((total, point) => total + pick(point), 0)
  return {
    range: '30d',
    tz: 'UTC',
    bucket: 'day',
    totals: { listens: sum((point) => point.listens), minutes: sum((point) => point.minutes), episodes: 9, shows: 2, finished: 4 },
    shows: [
      { id: 's1', name: 'Sample Science', thumbUrl: null, listens: sum((point) => point.byShow[0]!.listens), minutes: sum((point) => point.byShow[0]!.minutes) },
      { id: 's2', name: 'Crate Talk', thumbUrl: null, listens: sum((point) => point.byShow[1]!.listens), minutes: sum((point) => point.byShow[1]!.minutes) },
    ],
    series,
  }
}

export const podcastStatsTop: PodcastStatsTop = {
  type: 'shows',
  range: '30d',
  tz: 'UTC',
  metric: 'minutes',
  limit: 10,
  items: [
    { rank: 1, id: 's1', name: 'Sample Science', subtitle: '6 episodes', imageUrl: null, listens: 20, minutes: 610 },
    { rank: 2, id: 's2', name: 'Crate Talk', subtitle: '3 episodes', imageUrl: null, listens: 8, minutes: 280 },
  ],
}

export const podcastTopEpisodes: PodcastStatsTop['items'] = [
  { rank: 1, id: 'e1', name: 'The History of the Breakbeat', subtitle: 'Sample Science', imageUrl: null, listens: 2, minutes: 45 },
  { rank: 2, id: 'e3', name: 'Digging in Osaka', subtitle: 'Crate Talk', imageUrl: null, listens: 1, minutes: 30 },
]

export function podcastStatsCalendar(year = thisYear): PodcastStatsCalendar {
  return {
    year,
    tz: 'UTC',
    years: [2025, thisYear],
    days: [
      { date: `${year}-03-02`, listens: 1, minutes: 45 },
      { date: `${year}-03-09`, listens: 2, minutes: 70 },
      { date: `${year}-06-21`, listens: 1, minutes: 20 },
    ],
  }
}

export const listensTimeline: ListensTimeline = {
  months: [
    { month: localDayKey(new Date()).slice(0, 7), listens: 5 },
    { month: '2025-08', listens: 1 },
  ],
}

/** The podcast-only playlist: three episodes, in Spotify's order. */
export const podcastPlaylistDetail: PlaylistDetail = {
  playlist: {
    id: 'p5',
    name: 'Commute',
    description: null,
    imageUrl: null,
    ownerName: 'Pixel G',
    owned: true,
    collaborative: false,
    isPublic: false,
    itemCount: 3,
    playsFrom: 0,
    itemsSynced: true,
  },
  items: [],
  episodes: [episodes.digging, episodes.breakbeat, episodes.amen].map((episode, position) => {
    const listened = episodesPage.items.find((item) => item.episode.id === episode.id)!
    return { position, addedAt: hoursAgo(5 + position), episode, listens: listened.listens, listenedMs: listened.listenedMs, lastListenedAt: listened.lastListenedAt }
  }),
}

/** Search in podcast mode: "sample" finds the show and two of its episodes. */
export const podcastSearchResponse: SearchResponse = {
  query: { text: 'sample', filters: [], issues: [] },
  engine: 'postgres',
  tookMs: 3,
  total: 3,
  groups: [
    {
      type: 'show',
      total: 1,
      hits: [hit({ type: 'show', id: 's1', name: 'Sample Science', playCount: 4, score: 3, highlights: { name: [[0, 6]], artists: [] } })],
    },
    {
      type: 'episode',
      total: 2,
      hits: [
        hit({ type: 'episode', id: 'e1', name: 'The History of the Breakbeat', artists: ['Sample Science'], year: 2026, playCount: 2, rating: 4, score: 2, highlights: { name: [], artists: [[[0, 6]]] } }),
        hit({ type: 'episode', id: 'e2', name: 'Six Seconds of Amen', artists: ['Sample Science'], year: 2026, playCount: 2, score: 1.8, highlights: { name: [], artists: [[[0, 6]]] } }),
      ],
    },
  ],
  suggestion: null,
}

export const spotifyPodcastHits: SpotifyPodcastHits = {
  shows: [{ id: 's9', name: 'Sampling Stories', imageUrl: null, listens: 0 }],
  episodes: [{ id: 'e9', name: 'Who Sampled Whom', imageUrl: null, releaseDate: '2026-08-12', durationMs: 50 * MIN, listens: 0 }],
}
