import { describe, expect, it, vi } from 'vitest'
import { MetadataApiError } from './http.ts'
import { getArtistTopTags } from './lastfm.ts'
import { findArtistBySpotifyId, getArtistGenres, searchArtists } from './musicbrainz.ts'

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
const fetchReturning = (res: Response) => vi.fn<typeof fetch>().mockResolvedValue(res)
const errorOf = (promise: Promise<unknown>) => promise.then(() => null, (error: unknown) => error as MetadataApiError)

describe('Last.fm artist.getTopTags', () => {
  const tags = { toptags: { tag: [{ count: 100, name: 'rock', url: 'x' }, { count: 54, name: 'alternative', url: 'y' }] } }

  it('asks by name with autocorrect and returns the tags', async () => {
    const fetchFn = fetchReturning(json(200, tags))
    expect(await getArtistTopTags('Radiohead', { apiKey: 'k', fetchFn })).toEqual([
      { name: 'rock', count: 100 },
      { name: 'alternative', count: 54 },
    ])
    const url = new URL(String(fetchFn.mock.calls[0]![0]))
    expect(Object.fromEntries(url.searchParams)).toEqual({
      method: 'artist.gettoptags',
      artist: 'Radiohead',
      autocorrect: '1',
      api_key: 'k',
      format: 'json',
    })
  })

  it('encodes a plus sign twice, since Last.fm decodes twice', async () => {
    const fetchFn = fetchReturning(json(200, tags))
    await getArtistTopTags('Florence + The Machine', { apiKey: 'k', fetchFn })
    expect(String(fetchFn.mock.calls[0]![0])).toContain('artist=Florence+%252B+The+Machine&')
  })

  it('reads a lone tag and no tags', async () => {
    expect(await getArtistTopTags('a', { apiKey: 'k', fetchFn: fetchReturning(json(200, { toptags: { tag: { count: 100, name: 'jazz' } } })) })).toEqual([
      { name: 'jazz', count: 100 },
    ])
    expect(await getArtistTopTags('a', { apiKey: 'k', fetchFn: fetchReturning(json(200, { toptags: { tag: [] } })) })).toEqual([])
  })

  it('turns its error codes into statuses', async () => {
    const notFound = await errorOf(getArtistTopTags('nobody', { apiKey: 'k', fetchFn: fetchReturning(json(200, { error: 6, message: 'The artist you supplied could not be found' })) }))
    expect(notFound).toMatchObject({ status: 404 })
    const limited = await errorOf(getArtistTopTags('a', { apiKey: 'k', fetchFn: fetchReturning(json(200, { error: 29, message: 'Rate limit exceeded' })) }))
    expect(limited).toMatchObject({ status: 429, retryAfter: 60 })
    const badKey = await errorOf(getArtistTopTags('a', { apiKey: 'bad', fetchFn: fetchReturning(json(403, { error: 10, message: 'Invalid API key' })) }))
    expect(badKey).toBeInstanceOf(MetadataApiError)
    expect(badKey).toMatchObject({ status: 403 })
  })

  it('reports a failed response that has no error body', async () => {
    const error = await errorOf(getArtistTopTags('a', { apiKey: 'k', fetchFn: fetchReturning(new Response('Bad Gateway', { status: 502 })) }))
    expect(error).toMatchObject({ status: 502 })
  })
})

describe('MusicBrainz', () => {
  const options = (fetchFn: typeof fetch) => ({ userAgent: 'replay-crate/test (x)', fetchFn })

  it('finds the artist linked to a Spotify artist, sending our User-Agent', async () => {
    const fetchFn = fetchReturning(
      json(200, { relations: [{ 'target-type': 'artist', artist: { id: 'a74b1b7f', name: 'Radiohead' } }] }),
    )
    expect(await findArtistBySpotifyId('4Z8W4fKeB5YxbusRsdQVPb', options(fetchFn))).toBe('a74b1b7f')
    const [url, init] = fetchFn.mock.calls[0]!
    expect(String(url)).toBe(
      'https://musicbrainz.org/ws/2/url?resource=https%3A%2F%2Fopen.spotify.com%2Fartist%2F4Z8W4fKeB5YxbusRsdQVPb&inc=artist-rels&fmt=json',
    )
    expect(init?.headers).toMatchObject({ 'User-Agent': 'replay-crate/test (x)' })
  })

  it('finds no artist when the Spotify link is unknown', async () => {
    expect(await findArtistBySpotifyId('nope', options(fetchReturning(json(404, { error: 'Not Found' }))))).toBeNull()
    expect(await findArtistBySpotifyId('nope', options(fetchReturning(json(200, { relations: [] }))))).toBeNull()
  })

  it('searches artists by exact phrase', async () => {
    const fetchFn = fetchReturning(json(200, { artists: [{ id: 'm1', name: 'Nirvana', score: 100 }, { id: 'm2', name: 'Nirvana', score: 100 }] }))
    expect(await searchArtists('Say "Hi"', options(fetchFn))).toEqual([
      { mbid: 'm1', name: 'Nirvana', score: 100 },
      { mbid: 'm2', name: 'Nirvana', score: 100 },
    ])
    const url = new URL(String(fetchFn.mock.calls[0]![0]))
    expect(url.searchParams.get('query')).toBe('artist:"Say \\"Hi\\""')
  })

  it('reads an artist\'s genres', async () => {
    const fetchFn = fetchReturning(json(200, { genres: [{ name: 'art rock', count: 30, id: 'g' }] }))
    expect(await getArtistGenres('a74b1b7f', options(fetchFn))).toEqual([{ name: 'art rock', count: 30 }])
    expect(String(fetchFn.mock.calls[0]![0])).toBe('https://musicbrainz.org/ws/2/artist/a74b1b7f?inc=genres&fmt=json')
  })

  it('treats a 503 as being asked to slow down, and passes a 404 on', async () => {
    expect(await errorOf(getArtistGenres('x', options(fetchReturning(json(503, {}, { 'Retry-After': '3' })))))).toMatchObject({ status: 429, retryAfter: 3 })
    expect(await errorOf(getArtistGenres('x', options(fetchReturning(json(503, {})))))).toMatchObject({ status: 429, retryAfter: 5 })
    expect(await errorOf(getArtistGenres('x', options(fetchReturning(json(404, {})))))).toMatchObject({ status: 404 })
  })
})
