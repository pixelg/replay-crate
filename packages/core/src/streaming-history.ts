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
}

/** What we keep of a play: when it ended, how long it played, which track. */
export type ImportedPlay = { ts: string; ms: number; trackId: string }

export type ParseResult = {
  plays: ImportedPlay[]
  /** Entries that aren't music (podcasts, audiobooks, videos) or have no track id. */
  notMusic: number
  /** Music played for less than 30 seconds, which Spotify doesn't count as a stream. */
  tooShort: number
  /** Entries missing a timestamp or play time. */
  malformed: number
}

const TRACK_URI = /^spotify:track:([0-9A-Za-z]{22})$/

/** Keeps music plays of 30s or more, reduced to timestamp, play time and track id. */
export function parseStreamingHistory(entries: unknown[]): ParseResult {
  const result: ParseResult = { plays: [], notMusic: 0, tooShort: 0, malformed: 0 }
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
      result.notMusic++
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
