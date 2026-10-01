import { MIN_STREAM_MS } from './constants.ts'

/**
 * One entry of Spotify's "Extended streaming history" export
 * (Streaming_History_Audio_*.json). Only the fields we use are typed; the files also carry
 * platform, IP address, country, reasons for start/end and more, which never leave the device.
 */
export type StreamingHistoryEntry = {
  /** When the stream **ended**, in UTC (ISO 8601). */
  ts: string
  ms_played: number
  spotify_track_uri: string | null
  master_metadata_track_name?: string | null
  master_metadata_album_artist_name?: string | null
  master_metadata_album_album_name?: string | null
  /** Set instead of the track fields for a podcast episode. */
  spotify_episode_uri?: string | null
  episode_name?: string | null
  episode_show_name?: string | null
}

/** What we keep of a play: when it ended, how long it played, which track. */
export type ImportedPlay = { ts: string; ms: number; trackId: string }

/** What we keep of a stretch of listening to a podcast episode: when it ended, how long, which episode. */
export type ImportedListen = { ts: string; ms: number; episodeId: string }

export type ParseResult = {
  plays: ImportedPlay[]
  /**
   * Podcast episode entries, as they are: one per stretch of playing, however short (pausing
   * splits a listen in the export). `mergeListens` joins and filters them.
   */
  episodes: ImportedListen[]
  /** Entries that are neither music nor podcast episodes (audiobooks, videos), or have no id. */
  other: number
  /** Music played for less than 30 seconds, which Spotify doesn't count as a stream. */
  tooShort: number
  /** Entries missing a timestamp or play time. */
  malformed: number
}

const TRACK_URI = /^spotify:track:([0-9A-Za-z]{22})$/
const EPISODE_URI = /^spotify:episode:([0-9A-Za-z]{22})$/

/**
 * Keeps music plays of 30s or more, reduced to timestamp, play time and track id, and every
 * stretch of a podcast episode, reduced the same way.
 */
export function parseStreamingHistory(entries: unknown[]): ParseResult {
  const result: ParseResult = { plays: [], episodes: [], other: 0, tooShort: 0, malformed: 0 }
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') {
      result.malformed++
      continue
    }
    const entry = raw as Partial<StreamingHistoryEntry>
    const ts = typeof entry.ts === 'string' ? new Date(entry.ts) : null
    if (!ts || Number.isNaN(ts.getTime()) || typeof entry.ms_played !== 'number') {
      result.malformed++
      continue
    }
    const match = typeof entry.spotify_track_uri === 'string' ? TRACK_URI.exec(entry.spotify_track_uri) : null
    if (!match) {
      const episode = typeof entry.spotify_episode_uri === 'string' ? EPISODE_URI.exec(entry.spotify_episode_uri) : null
      if (episode && entry.ms_played > 0) result.episodes.push({ ts: ts.toISOString(), ms: entry.ms_played, episodeId: episode[1]! })
      else if (!episode) result.other++
      continue
    }
    if (entry.ms_played < MIN_STREAM_MS) {
      result.tooShort++
      continue
    }
    result.plays.push({ ts: ts.toISOString(), ms: entry.ms_played, trackId: match[1]! })
  }
  return result
}

/** Stretches of one episode closer than this (a pause, a phone call) are one listen. */
export const LISTEN_JOIN_MS = 15 * 60_000

/**
 * Joins an episode's stretches that follow each other within `LISTEN_JOIN_MS` (the export
 * splits a listen wherever it was paused) and drops listens under 30 seconds in all. Each listen
 * ends where its last stretch did.
 */
export function mergeListens(stretches: ImportedListen[]): { listens: ImportedListen[]; tooShort: number } {
  const byEpisode = new Map<string, ImportedListen[]>()
  for (const stretch of stretches) byEpisode.set(stretch.episodeId, [...(byEpisode.get(stretch.episodeId) ?? []), stretch])
  const joined: ImportedListen[] = []
  for (const group of byEpisode.values()) {
    let current: ImportedListen | undefined
    for (const stretch of group.toSorted((a, b) => a.ts.localeCompare(b.ts))) {
      const startsAt = Date.parse(stretch.ts) - stretch.ms
      if (current && startsAt - Date.parse(current.ts) <= LISTEN_JOIN_MS) {
        current.ts = stretch.ts
        current.ms += stretch.ms
      } else {
        current = { ...stretch }
        joined.push(current)
      }
    }
  }
  const listens = joined.filter((listen) => listen.ms >= MIN_STREAM_MS)
  const tooShort = joined.length - listens.length
  return { listens: listens.toSorted((a, b) => a.ts.localeCompare(b.ts)), tooShort }
}

/** Totals for the "here's what we found" step before uploading. */
export function summarizeImport(plays: ImportedPlay[]) {
  if (!plays.length) return { plays: 0, tracks: 0, earliest: null, latest: null }
  let earliest = plays[0]!.ts
  let latest = plays[0]!.ts
  const tracks = new Set<string>()
  for (const play of plays) {
    tracks.add(play.trackId)
    if (play.ts < earliest) earliest = play.ts
    if (play.ts > latest) latest = play.ts
  }
  return { plays: plays.length, tracks: tracks.size, earliest, latest }
}

/** Streaming history files are the audio ones; the export also has video files and a PDF. */
export function isStreamingHistoryFile(name: string): boolean {
  return /Streaming_History_Audio_[^/]*\.json$/i.test(name)
}
