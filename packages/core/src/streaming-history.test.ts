import { describe, expect, it } from 'vitest'
import { isStreamingHistoryFile, parseStreamingHistory, summarizeImport } from './streaming-history.ts'

const entry = (overrides: Record<string, unknown> = {}) => ({
  ts: '2024-03-10T21:44:02Z',
  platform: 'linux',
  ms_played: 200_000,
  conn_country: 'US',
  ip_addr: '203.0.113.7',
  master_metadata_track_name: 'Straighten It Out',
  master_metadata_album_artist_name: 'Pete Rock & C.L. Smooth',
  master_metadata_album_album_name: 'Mecca And The Soul Brother',
  spotify_track_uri: 'spotify:track:4dI2tnLrhe8u4jWjoLC5NK',
  episode_name: null,
  episode_show_name: null,
  spotify_episode_uri: null,
  reason_start: 'trackdone',
  reason_end: 'trackdone',
  shuffle: false,
  skipped: false,
  offline: false,
  offline_timestamp: 0,
  incognito_mode: false,
  ...overrides,
})

describe('parseStreamingHistory', () => {
  it('keeps music plays reduced to timestamp, play time and track id', () => {
    const { plays } = parseStreamingHistory([entry()])
    expect(plays).toEqual([{ ts: '2024-03-10T21:44:02.000Z', ms: 200_000, trackId: '4dI2tnLrhe8u4jWjoLC5NK' }])
    // Nothing else (IP address, platform...) comes along.
    expect(Object.keys(plays[0]!)).toEqual(['ts', 'ms', 'trackId'])
  })

  it('counts what it leaves out', () => {
    const result = parseStreamingHistory([
      entry(),
      entry({ ms_played: 12_000 }), // skipped after 12s
      entry({ spotify_track_uri: null, spotify_episode_uri: 'spotify:episode:abc', episode_name: 'A podcast' }),
      entry({ spotify_track_uri: 'spotify:local:::song' }),
      entry({ ts: 'not a date' }),
      entry({ ms_played: undefined }),
      'garbage',
    ])
    expect(result).toMatchObject({ notMusic: 2, tooShort: 1, malformed: 3 })
    expect(result.plays).toHaveLength(1)
  })
})

describe('summarizeImport', () => {
  it('reports plays, distinct tracks and the date range', () => {
    const { plays } = parseStreamingHistory([
      entry({ ts: '2019-01-02T00:00:00Z' }),
      entry({ ts: '2024-06-30T12:00:00Z' }),
      entry({ ts: '2021-05-05T12:00:00Z', spotify_track_uri: 'spotify:track:0000000000000000000000' }),
    ])
    expect(summarizeImport(plays)).toEqual({
      plays: 3,
      tracks: 2,
      earliest: '2019-01-02T00:00:00.000Z',
      latest: '2024-06-30T12:00:00.000Z',
    })
    expect(summarizeImport([])).toEqual({ plays: 0, tracks: 0, earliest: null, latest: null })
  })
})

describe('isStreamingHistoryFile', () => {
  it('picks the audio history files out of the export', () => {
    expect(isStreamingHistoryFile('Spotify Extended Streaming History/Streaming_History_Audio_2019-2021_0.json')).toBe(true)
    expect(isStreamingHistoryFile('Streaming_History_Video_2023.json')).toBe(false)
    expect(isStreamingHistoryFile('ReadMeFirst_ExtendedStreamingHistory.pdf')).toBe(false)
  })
})
