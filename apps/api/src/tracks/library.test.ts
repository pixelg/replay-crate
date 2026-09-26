import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, play, track } from '../testing.ts'

describe('GET /api/v1/tracks', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string

  // oxlint-disable-next-line typescript/no-explicit-any
  const json = (res: Response): Promise<any> => res.json()
  const get = (query = '') => ctx.app.request(`/api/v1/tracks${query}`, { headers: { Cookie: cookie } })
  /** Every page of a sort, following nextCursor. */
  async function all(sort: string, limit: number) {
    const names: string[] = []
    let cursor: string | null = null
    do {
      const page = await json(await get(`?sort=${sort}&limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`))
      names.push(...page.items.map((item: { track: { name: string } }) => item.track.name))
      cursor = page.nextCursor
    } while (cursor)
    return names
  }

  // Plays per track: banger 3, deep 2, aria 2, zebra 1. Last played: zebra newest, then aria, deep, banger.
  const banger = track('t-banger', { name: 'banger' })
  const deep = track('t-deep', { name: 'Deep Cut' })
  const aria = track('t-aria', { name: 'Aria' })
  const zebra = track('t-zebra', { name: 'zebra' })

  beforeEach(async () => {
    ctx = await createTestContext()
    cookie = `rc_session=${(await ctx.login()).token}`
    ctx.spotify.getRecentlyPlayed.mockResolvedValue({
      items: [
        play(zebra, '2026-09-21T11:00:00.000Z'),
        play(aria, '2026-09-21T10:00:00.000Z'),
        play(deep, '2026-09-21T09:00:00.000Z'),
        play(banger, '2026-09-21T08:00:00.000Z'),
        play(aria, '2026-09-20T10:00:00.000Z'),
        play(deep, '2026-09-20T09:00:00.000Z'),
        play(banger, '2026-09-20T08:00:00.000Z'),
        play(banger, '2026-09-19T08:00:00.000Z'),
      ],
      cursors: null,
    })
    await ctx.app.request('/api/v1/history/sync', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173' } })
  })
  afterEach(() => ctx.close())

  it('lists every played track with its plays, most played first', async () => {
    const page = await json(await get())
    expect(page.total).toBe(4)
    expect(page.nextCursor).toBeNull()
    expect(page.items[0]).toEqual({
      track: {
        id: 't-banger',
        name: 'banger',
        durationMs: expect.any(Number),
        explicit: false,
        album: { id: expect.any(String), name: expect.any(String), thumbUrl: expect.any(String) },
        artists: [expect.objectContaining({ name: expect.any(String) })],
        rating: null,
      },
      playCount: 3,
      firstPlayedAt: '2026-09-19T08:00:00.000Z',
      lastPlayedAt: '2026-09-21T08:00:00.000Z',
    })
    // Ties (Deep Cut and Aria, 2 plays each) go by track id.
    expect(page.items.map((item: { track: { name: string } }) => item.track.name)).toEqual(['banger', 'Aria', 'Deep Cut', 'zebra'])
  })

  it('sorts by last play and by name (ignoring case)', async () => {
    expect(await all('last_played', 50)).toEqual(['zebra', 'Aria', 'Deep Cut', 'banger'])
    expect(await all('name', 50)).toEqual(['Aria', 'banger', 'Deep Cut', 'zebra'])
  })

  it('pages with the cursor, never repeating or skipping a track', async () => {
    for (const sort of ['plays', 'last_played', 'name']) {
      expect(await all(sort, 1)).toEqual(await all(sort, 50))
    }
    const first = await json(await get('?limit=2'))
    expect(first.items).toHaveLength(2)
    expect(first.total).toBe(4)
    expect(first.nextCursor).toEqual(expect.any(String))
  })

  it("starts a sort from the top when given another sort's cursor", async () => {
    const { nextCursor } = await json(await get('?sort=name&limit=1'))
    const page = await json(await get(`?sort=plays&limit=1&cursor=${nextCursor}`))
    expect(page.items[0].track.name).toBe('banger')
  })

  it('rejects a cursor it did not make', async () => {
    const res = await get('?cursor=not-a-cursor')
    expect(res.status).toBe(400)
    expect(await json(res)).toMatchObject({ error: 'invalid_request', issues: [{ path: 'cursor' }] })
  })

  it("only lists the user's own plays", async () => {
    ctx.spotify.getCurrentUser.mockResolvedValueOnce({ id: 'someone-else', display_name: 'Other', images: [] })
    ctx.spotify.getRecentlyPlayed.mockResolvedValueOnce({ items: [], cursors: null })
    const other = `rc_session=${(await ctx.login()).token}`
    const res = await ctx.app.request('/api/v1/tracks', { headers: { Cookie: other } })
    expect(await json(res)).toEqual({ items: [], nextCursor: null, total: 0 })
  })
})
