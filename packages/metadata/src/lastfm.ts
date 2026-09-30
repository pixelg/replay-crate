import { MetadataApiError, retryAfterSeconds, type Fetch } from './http.ts'

export const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/'

/** A Last.fm tag on an artist: `count` is 0–100, relative to the artist's top tag. */
export type LastfmTag = { name: string; count: number }

export type LastfmOptions = { apiKey: string; fetchFn?: Fetch }

type ErrorBody = { error: number; message?: string }
type TopTagsBody = { toptags?: { tag?: LastfmTag | LastfmTag[] } }

/**
 * Last.fm's error codes (https://www.last.fm/api/errorcodes) as HTTP-style statuses: it answers
 * most errors with 200 and an `error` field.
 */
function errorStatus(code: number): number {
  switch (code) {
    case 6: // not found (artist, track)
      return 404
    case 29: // rate limit exceeded
      return 429
    case 10: // invalid API key
    case 26: // suspended API key
      return 403
    case 11: // service offline
    case 16: // temporary error
      return 503
    default:
      return 400
  }
}

/**
 * `artist.getTopTags`: the tags listeners gave an artist, strongest first. Looks the artist up by
 * name with Last.fm's autocorrect ("the beatles" finds The Beatles). Throws `MetadataApiError`
 * (404 when Last.fm doesn't know the artist, 429 when it asks us to slow down).
 */
export async function getArtistTopTags(artist: string, { apiKey, fetchFn = fetch }: LastfmOptions): Promise<LastfmTag[]> {
  const url = new URL(LASTFM_API_URL)
  // Last.fm decodes values twice, so a "+" (Florence + The Machine) must reach it as %252B, or it's a space.
  const name = artist.replaceAll('+', '%2B')
  url.search = new URLSearchParams({ method: 'artist.gettoptags', artist: name, autocorrect: '1', api_key: apiKey, format: 'json' }).toString()
  const res = await fetchFn(url, { headers: { Accept: 'application/json' } })
  const body = (await res.json().catch(() => null)) as (TopTagsBody & Partial<ErrorBody>) | null
  if (body && typeof body.error === 'number') {
    const status = errorStatus(body.error)
    throw new MetadataApiError(status, `Last.fm error ${body.error}: ${body.message ?? 'unknown'}`, status === 429 ? (retryAfterSeconds(res) ?? 60) : undefined)
  }
  if (!res.ok || !body) {
    throw new MetadataApiError(res.status === 429 ? 429 : res.status || 503, `Last.fm answered ${res.status}`, retryAfterSeconds(res))
  }
  // A lone tag comes back as an object rather than an array.
  const tags = body.toptags?.tag ?? []
  return (Array.isArray(tags) ? tags : [tags]).map((tag) => ({ name: tag.name, count: Number(tag.count) || 0 }))
}
