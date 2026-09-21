import { isStreamingHistoryFile, parseStreamingHistory, type ParseResult } from '@replay-crate/core'
import { unzip, type Unzipped } from 'fflate'

export type StreamingHistory = ParseResult & {
  /** Streaming history files found (inside the zip or chosen directly). */
  files: number
  /** Plays that appeared more than once across the files, e.g. a file chosen twice. */
  repeated: number
}

/** A problem with the chosen files, worded for the person who chose them. */
export class StreamingHistoryError extends Error {
  override name = 'StreamingHistoryError'
}

const unzipHistory = (data: Uint8Array) =>
  new Promise<Unzipped>((resolve, reject) =>
    // Only the audio history is decompressed; the export also has video history and a PDF.
    unzip(data, { filter: (file) => isStreamingHistoryFile(file.name) }, (error, files) =>
      error ? reject(error) : resolve(files),
    ),
  )

/**
 * Reads Spotify's Extended Streaming History, as the my_spotify_data.zip Spotify sends or
 * the Streaming_History_Audio_*.json files inside it. Everything happens on this device;
 * what comes back is only each play's end time, play time and track id.
 */
export async function readStreamingHistory(chosen: File[]): Promise<StreamingHistory> {
  const decoder = new TextDecoder()
  const sources: Array<{ name: string; text: string }> = []
  for (const file of chosen) {
    if (/\.zip$/i.test(file.name)) {
      let files: Unzipped
      try {
        files = await unzipHistory(new Uint8Array(await file.arrayBuffer()))
      } catch {
        throw new StreamingHistoryError(`${file.name} isn't a zip file that can be opened.`)
      }
      for (const [name, data] of Object.entries(files)) sources.push({ name, text: decoder.decode(data) })
    } else {
      sources.push({ name: file.name, text: await file.text() })
    }
  }

  const history: StreamingHistory = { plays: [], notMusic: 0, tooShort: 0, malformed: 0, files: 0, repeated: 0 }
  const seen = new Set<string>()
  for (const { name, text } of sources) {
    let entries: unknown
    try {
      entries = JSON.parse(text)
    } catch {
      throw new StreamingHistoryError(`${name} isn't a streaming history file.`)
    }
    if (!Array.isArray(entries)) throw new StreamingHistoryError(`${name} isn't a streaming history file.`)
    const parsed = parseStreamingHistory(entries)
    history.files++
    history.notMusic += parsed.notMusic
    history.tooShort += parsed.tooShort
    history.malformed += parsed.malformed
    for (const play of parsed.plays) {
      const key = `${play.ts} ${play.trackId}`
      if (seen.has(key)) {
        history.repeated++
        continue
      }
      seen.add(key)
      history.plays.push(play)
    }
  }

  if (!history.files) {
    throw new StreamingHistoryError(
      'No streaming history in there. Choose the zip from Spotify, or the Streaming_History_Audio files inside it.',
    )
  }
  return history
}
