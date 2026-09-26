import { SpotifyApiError } from '@replay-crate/spotify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, play, track } from '../testing.ts'

describe('GET /api/v1/search', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string
  // oxlint-disable-next-line typescript/no-explicit-any
  const json = (res: Response): Promise<any> => res.json()
  const get = (query: string) => ctx.app.request(`/api/v1/search?${query}`, { headers: { Cookie: cookie } })

  beforeEach(async () => {
    ctx = await createTestContext()
    cookie = `rc_session=${(await ctx.login()).token}`
    ctx.spotify.getRecentlyPlayed.mockResolvedValue({
      items: [play(track('brass', { name: 'Brass Monkey Business', artists: [['loop', 'The Loop Collective']] }), '2026-09-21T11:00:00.000Z')],
      cursors: null,
    })
    await ctx.app.request('/api/v1/history/sync', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173' } })
    await ctx.indexSearch()
  })
  afterEach(() => ctx.close())

  it('requires a session', async () => {
    expect((await ctx.app.request('/api/v1/search?q=brass')).status).toBe(401)
  })

  it('returns groups with highlights, and which engine answered', async () => {
    const body = await json(await get('q=brass%20mon'))
    expect(body).toMatchObject({ engine: 'postgres', total: 2, suggestion: null })
    expect(body.groups.map((group: { type: string }) => group.type)).toEqual(['track', 'play'])
    expect(body.groups[0].hits[0]).toMatchObject({
      type: 'track',
      id: 'brass',
      name: 'Brass Monkey Business',
      artists: ['The Loop Collective'],
      playCount: 1,
      highlights: { name: [[0, 5], [6, 9]], artists: [[]] },
    })
  })

  it('echoes the parsed query, so the box can show filters as chips', async () => {
    const q = 'brass rating:>=4 title:x artist:"loop'
    const body = await json(await get(`q=${encodeURIComponent(q)}`))
    expect(body.query.text).toBe('brass title:x')
    expect(body.query.filters).toEqual([
      { token: 'rating:>=4', label: 'Rating: 4★ or more', start: 6, end: 16 },
      { token: 'artist:loop', label: 'Artist: loop', start: 25, end: 37 },
    ])
    expect(body.query.issues.map((issue: { kind: string }) => issue.kind)).toEqual(['unknown-field', 'unclosed-quote'])
  })

  it('counts facets on request', async () => {
    const body = await json(await get('q=brass&facets=true'))
    expect(body.facets.types).toEqual(expect.arrayContaining([{ value: 'track', count: 1 }]))
    expect(body.facets.artists).toEqual([{ value: 'The Loop Collective', count: 1 }])
  })

  it('rejects unknown types', async () => {
    expect((await get('q=brass&types=song')).status).toBe(400)
  })
})

describe('GET /api/v1/search/spotify', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string
  // oxlint-disable-next-line typescript/no-explicit-any
  const json = (res: Response): Promise<any> => res.json()
  const get = (query: string) => ctx.app.request(`/api/v1/search/spotify?${query}`, { headers: { Cookie: cookie } })
  const played = track('played', { name: 'Brass Monkey Business', artists: [['loop', 'The Loop Collective']] })
  const fresh = track('fresh', { name: 'Brass Section', artists: [['horns', 'The Horns']] })

  beforeEach(async () => {
    ctx = await createTestContext()
    cookie = `rc_session=${(await ctx.login()).token}`
    // The fake Spotify searches every track it knows.
    ctx.library.remember([played, fresh])
    ctx.spotify.getRecentlyPlayed.mockResolvedValue({ items: [play(played, '2026-09-21T11:00:00.000Z')], cursors: null })
    await ctx.app.request('/api/v1/history/sync', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173' } })
  })
  afterEach(() => ctx.close())

  it("finds tracks across Spotify, saying which you've played", async () => {
    const body = await json(await get('q=brass'))
    expect(body.tracks.map((t: { id: string; playCount: number }) => [t.id, t.playCount])).toEqual([
      ['played', 1],
      ['fresh', 0],
    ])
    expect(body.tracks[1]).toMatchObject({ name: 'Brass Section', artists: ['The Horns'], album: 'Album fresh' })
  })

  it('sends only the free text, and nothing at all without any', async () => {
    await get(`q=${encodeURIComponent('brass rating:>=4 artist:"horns"')}`)
    expect(ctx.spotify.searchTracks).toHaveBeenLastCalledWith(expect.any(String), 'brass', 10)
    ctx.spotify.searchTracks.mockClear()
    expect(await json(await get('q=rating:5'))).toEqual({ tracks: [] })
    expect(ctx.spotify.searchTracks).not.toHaveBeenCalled()
  })

  it("passes on Spotify's rate limit", async () => {
    ctx.spotify.searchTracks.mockRejectedValueOnce(new SpotifyApiError(429, 'slow down', 30))
    const res = await get('q=brass')
    expect(res.status).toBe(503)
    expect(await json(res)).toEqual({ error: 'rate_limited', retryAfter: 30 })
  })
})
