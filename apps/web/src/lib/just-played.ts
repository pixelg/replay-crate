import type { Playback, PlayItem, TrackDetail } from '@replay-crate/api-client'
import { useSyncExternalStore } from 'react'

/**
 * Tracks that just finished playing, for History to show until their plays arrive. Spotify lists a
 * play in recently played a moment after the track ends, and History syncs a while after that
 * (`SYNC_TIMING`), so without these the track would be gone from Now playing and not yet under
 * Today.
 */
export type JustPlayed = {
  /** The play as History will list it: ended now, polled. */
  play: PlayItem
  /** The recording's track id, when the track Spotify played is another copy of it. */
  recordingId: string
  /** When it started (ms since the epoch), as far as the player showed. */
  startedAt: number
}

/** Spotify counts a track as played after 30 seconds; a quicker skip leaves no play to wait for. */
export const PLAYED_AFTER_MS = 30_000

/** A just-played track goes after this long even if its play never turns up. */
export const JUST_PLAYED_FOR_MS = 5 * 60_000

type Watched = { playback: Playback & { item: { type: 'track'; id: string } }; seenAt: number; startedAt: number }

/**
 * Watches playback answers for the track playing to change: when one heard for at least
 * `PLAYED_AFTER_MS` gives way to something else (or to nothing), it's `onPlayed`. `detail` looks
 * up what History shows beside a play (its playlists, and the recording it belongs to), from what's
 * already been fetched for Now playing.
 */
export function createJustPlayedTracker(
  onPlayed: (justPlayed: JustPlayed) => void,
  detail: (trackId: string) => TrackDetail | undefined = () => undefined,
) {
  let watched: Watched | null = null
  return {
    seen(playback: Playback | null, now = Date.now()) {
      const item = playback?.item ?? null
      const previous = watched
      if (previous && previous.playback.item.uri !== item?.uri) {
        const { playback: last, seenAt, startedAt } = previous
        const durationMs = last.item.durationMs
        // Where it got to: on from the last look while it played, but not past its end.
        const heardMs = Math.min((last.progressMs ?? 0) + (last.isPlaying ? now - seenAt : 0), durationMs)
        if (heardMs >= PLAYED_AFTER_MS) {
          const endedAt = last.isPlaying ? Math.min(now, seenAt + durationMs - (last.progressMs ?? 0)) : seenAt
          const known = detail(last.item.id)
          onPlayed({
            play: {
              playedAt: new Date(endedAt).toISOString(),
              msPlayed: null,
              source: 'poll',
              context: last.fromQueue ? null : last.context,
              track: {
                id: last.item.id,
                name: last.item.name,
                durationMs,
                explicit: last.item.explicit,
                album: { id: last.item.album.id, name: last.item.album.name, thumbUrl: last.item.album.thumbUrl },
                artists: last.item.artists,
                genres: last.item.genres,
                rating: known?.track.rating ?? last.item.rating,
                playlists: known?.playlists ?? [],
              },
            },
            recordingId: known?.track.id ?? last.item.id,
            startedAt,
          })
        }
      }
      if (item?.type === 'track' && item.id) {
        const same = previous?.playback.item.uri === item.uri
        watched = {
          playback: playback as Watched['playback'],
          seenAt: now,
          startedAt: same ? previous.startedAt : now - (playback?.progressMs ?? 0),
        }
      } else {
        watched = null
      }
    },
  }
}

/** How far off the start worked out from the player can be (it's a few seconds stale at most). */
const START_SLACK_MS = 10_000

/** Whether `play` is the synced play of `justPlayed`: the same recording, played since it started. */
export const isPlayOf = (play: PlayItem, justPlayed: JustPlayed) =>
  (play.track.id === justPlayed.recordingId || play.track.id === justPlayed.play.track.id) &&
  new Date(play.playedAt).getTime() >= justPlayed.startedAt - START_SLACK_MS

let justPlayed: JustPlayed[] = []
const listeners = new Set<() => void>()
const changed = (next: JustPlayed[]) => {
  justPlayed = next
  for (const listener of listeners) listener()
}

/** Adds a just-played track, newest first, for `JUST_PLAYED_FOR_MS`. */
export function addJustPlayed(entry: JustPlayed) {
  changed([entry, ...justPlayed])
  setTimeout(() => changed(justPlayed.filter((other) => other !== entry)), JUST_PLAYED_FOR_MS)
}

/** Forgets every just-played track (between stories, say). */
export function clearJustPlayed() {
  changed([])
}

/** The tracks that just finished, newest first. */
export function useJustPlayed() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => justPlayed,
  )
}

/**
 * `plays` (newest first, from the present) with the just-played tracks whose plays haven't
 * arrived yet, in their places.
 */
export function withJustPlayed(plays: PlayItem[], pending: JustPlayed[]): PlayItem[] {
  const waiting = pending.filter((entry) => !plays.some((play) => isPlayOf(play, entry))).map((entry) => entry.play)
  return waiting.length ? [...waiting, ...plays].toSorted((a, b) => b.playedAt.localeCompare(a.playedAt)) : plays
}
