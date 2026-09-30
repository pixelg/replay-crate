import { MetadataApiError, retryAfterSeconds, type Fetch } from './http.ts'

export const MUSICBRAINZ_API_URL = 'https://musicbrainz.org/ws/2'

/**
 * MusicBrainz asks every client to identify itself (https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting)
 * and to make at most one call a second; the job queue does the pacing.
 */
export type MusicBrainzOptions = { userAgent: string; fetchFn?: Fetch }

export type MusicBrainzArtist = { mbid: string; name: string; score: number }
/** A genre on an artist: `count` is how many editors voted for it. */
export type MusicBrainzGenre = { name: string; count: number }

async function mbGet<T>(path: string, { userAgent, fetchFn = fetch }: MusicBrainzOptions): Promise<T> {
  const res = await fetchFn(`${MUSICBRAINZ_API_URL}${path}`, { headers: { 'User-Agent': userAgent, Accept: 'application/json' } })
  if (res.ok) return (await res.json()) as T
  // MusicBrainz answers 503 when a client goes over its rate limit.
  if (res.status === 503 || res.status === 429) {
    throw new MetadataApiError(429, `MusicBrainz answered ${res.status}`, retryAfterSeconds(res) ?? 5)
  }
  throw new MetadataApiError(res.status, `MusicBrainz answered ${res.status} for ${path.split('?')[0]}`)
}

/**
 * The MusicBrainz artist linked to a Spotify artist, when an editor has added the link: the
 * surest match, since names are ambiguous. Null when there's no link.
 */
export async function findArtistBySpotifyId(spotifyId: string, options: MusicBrainzOptions): Promise<string | null> {
  const resource = encodeURIComponent(`https://open.spotify.com/artist/${spotifyId}`)
  try {
    const body = await mbGet<{ relations?: Array<{ 'target-type'?: string; artist?: { id: string } }> }>(
      `/url?resource=${resource}&inc=artist-rels&fmt=json`,
      options,
    )
    return body.relations?.find((relation) => relation['target-type'] === 'artist' && relation.artist)?.artist?.id ?? null
  } catch (error) {
    if (error instanceof MetadataApiError && error.status === 404) return null
    throw error
  }
}

/** Artists whose name matches `name`, best first; `score` is 100 for the closest matches. */
export async function searchArtists(name: string, options: MusicBrainzOptions): Promise<MusicBrainzArtist[]> {
  // A quoted phrase in Lucene syntax: only a backslash and a quote need escaping inside it.
  const phrase = `"${name.replace(/[\\"]/g, '\\$&')}"`
  const body = await mbGet<{ artists?: Array<{ id: string; name: string; score: number }> }>(
    `/artist?query=${encodeURIComponent(`artist:${phrase}`)}&limit=5&fmt=json`,
    options,
  )
  return (body.artists ?? []).map((artist) => ({ mbid: artist.id, name: artist.name, score: Number(artist.score) || 0 }))
}

/** An artist's genres as MusicBrainz editors voted them. Throws a 404 `MetadataApiError` for an unknown id. */
export async function getArtistGenres(mbid: string, options: MusicBrainzOptions): Promise<MusicBrainzGenre[]> {
  const body = await mbGet<{ genres?: Array<{ name: string; count: number }> }>(`/artist/${encodeURIComponent(mbid)}?inc=genres&fmt=json`, options)
  return (body.genres ?? []).map((genre) => ({ name: genre.name, count: Number(genre.count) || 0 }))
}
