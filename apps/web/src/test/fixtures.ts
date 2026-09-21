import type { Me, PlayItem, PlaysPage, TrackDetail } from '@replay-crate/api-client'

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
}
