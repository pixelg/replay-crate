// Episode listens from player snapshots. Spotify's recently-played never lists podcast episodes,
// so the API polls what's playing (every couple of minutes, or every few seconds with the app
// open) and joins the snapshots of one episode into listens: where it started, where it got to,
// and how much of it was heard.

/** Snapshots further apart than this belong to different listens. */
export const LISTEN_GAP_MS = 10 * 60_000
/** Spotify plays podcasts at up to 3.5×, so the position can move that much faster than the clock. */
export const MAX_PLAYBACK_SPEED = 3.5
/** Room for small rewinds and the skip-back/forward buttons without starting a new listen. */
export const POSITION_SLACK_MS = 60_000

/** What the player reported at one moment. Times are ms since the epoch. */
export type ListenObservation = {
  at: number
  positionMs: number
  isPlaying: boolean
  durationMs: number
  /** When Spotify says playback last changed (play, pause, seek…), if it said. */
  changedAt?: number
}

/** The latest listen of the same episode, as last seen. */
export type OpenListen = { lastSeenAt: number; positionMs: number }

export type ListenStep =
  /** The snapshot carries on `open`: add `listenedMs`, move to `positionMs`, and stretch its end when `advanced`. */
  | { kind: 'continue'; listenedMs: number; positionMs: number; advanced: boolean }
  /** A new listen, started at `startedAt` and already `listenedMs` long. */
  | { kind: 'start'; startedAt: number; listenedMs: number; positionMs: number }
  /** Nothing to record: paused, with no listen to carry on. */
  | { kind: 'ignore' }

/** What a player snapshot means for the episode's latest listen (`open`, or null when there's none). */
export function mergeListen(open: OpenListen | null, observation: ListenObservation): ListenStep {
  const { at, positionMs, isPlaying } = observation
  if (open) {
    const elapsed = Math.max(0, at - open.lastSeenAt)
    const reach = elapsed * MAX_PLAYBACK_SPEED
    const carriesOn =
      elapsed <= LISTEN_GAP_MS &&
      positionMs >= open.positionMs - POSITION_SLACK_MS &&
      positionMs <= open.positionMs + reach + POSITION_SLACK_MS
    if (carriesOn) {
      const listenedMs = Math.round(Math.min(Math.max(0, positionMs - open.positionMs), reach))
      return { kind: 'continue', listenedMs, positionMs, advanced: listenedMs > 0 }
    }
  }
  if (!isPlaying) return { kind: 'ignore' }
  // Spotify's timestamp says when this stretch of playing began; trust it while it's recent, and
  // never back past the listen before (whose last sighting came first).
  const { changedAt } = observation
  let startedAt = changedAt !== undefined && changedAt <= at && at - changedAt <= LISTEN_GAP_MS ? changedAt : at
  if (open && startedAt <= open.lastSeenAt) startedAt = Math.min(at, open.lastSeenAt + 1)
  const listenedMs = Math.round(Math.min(at - startedAt, positionMs))
  return { kind: 'start', startedAt, listenedMs, positionMs }
}

/** An episode counts as finished once played to within a minute (or 3%, for long ones) of its end. */
export function isFinished(positionMs: number, durationMs: number): boolean {
  return durationMs > 0 && positionMs >= durationMs - Math.max(60_000, durationMs * 0.03)
}
