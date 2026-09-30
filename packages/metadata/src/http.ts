/** A failed call to Last.fm or MusicBrainz, shaped like `SpotifyApiError` so the job queue treats them alike. */
export class MetadataApiError extends Error {
  /** HTTP-style: 404 when the thing doesn't exist, 429 when we must slow down. */
  readonly status: number
  /** Seconds to wait before retrying, when rate-limited. */
  readonly retryAfter: number | undefined

  constructor(status: number, message: string, retryAfter?: number) {
    super(message)
    this.name = 'MetadataApiError'
    this.status = status
    this.retryAfter = retryAfter
  }
}

export type Fetch = typeof fetch

/** Seconds in a Retry-After header, when it holds a number. */
export function retryAfterSeconds(res: Response): number | undefined {
  const value = Number(res.headers.get('Retry-After'))
  return Number.isFinite(value) && value > 0 ? value : undefined
}
