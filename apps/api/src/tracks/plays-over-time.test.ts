import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, play, track } from '../testing.ts'

// The test clock is 2026-09-21T12:00:00Z (a Monday).
describe('GET /api/v1/tracks/{id}/plays-over-time', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string

  // oxlint-disable-next-line typescript/no-explicit-any
  const json = (res: Response): Promise<any> => res.json()
  const get = (id: string, query = '') => ctx.app.request(`/api/v1/tracks/${id}/plays-over-time${query}`, { headers: { Cookie: cookie } })
  const withPlays = (series: Array<{ date: string; plays: number }>) => series.filter((point) => point.plays > 0)

  const loop = track('loop', { name: 'Loop' })
  const other = track('other', { name: 'Other' })
  const old = track('old', { name: 'Old' })

  beforeEach(async () => {
    ctx = await createTestContext()
    cookie = `rc_session=${(await ctx.login()).token}`
    ctx.spotify.getRecentlyPlayed.mockResolvedValue({
      items: [
        play(loop, '2026-09-21T03:00:00.000Z'), // Sunday the 20th in Los Angeles
        play(loop, '2026-09-19T12:00:00.000Z'),
        play(other, '2026-09-18T12:00:00.000Z'),
        play(loop, '2026-07-04T12:00:00.000Z'),
        play(loop, '2025-12-31T12:00:00.000Z'),
        play(old, '2021-03-05T12:00:00.000Z'),
      ],
      cursors: null,
    })
    await ctx.app.request('/api/v1/history/sync', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173' } })
  })
  afterEach(() => ctx.close())

  it('charts the last 12 months by month, with zeros for the months between', async () => {
    const body = await json(await get('loop'))
    expect(body).toMatchObject({ range: '1y', tz: 'UTC', bucket: 'month' })
    expect(body.series).toHaveLength(12)
    expect(body.series[0]).toEqual({ date: '2025-10-01', plays: 0 })
    expect(withPlays(body.series)).toEqual([
      { date: '2025-12-01', plays: 1 },
      { date: '2026-07-01', plays: 1 },
      { date: '2026-09-01', plays: 2 },
    ])
  })

  it('charts 90 days by week, in the user’s local days', async () => {
    const utc = await json(await get('loop', '?range=90d'))
    expect(utc.bucket).toBe('week')
    expect(utc.series.at(-1)).toEqual({ date: '2026-09-21', plays: 1 })
    expect(withPlays(utc.series)).toEqual([
      { date: '2026-06-29', plays: 1 },
      { date: '2026-09-14', plays: 1 },
      { date: '2026-09-21', plays: 1 },
    ])
    const la = await json(await get('loop', '?range=90d&tz=America/Los_Angeles'))
    expect(la.series.at(-1)).toEqual({ date: '2026-09-21', plays: 0 })
    expect(withPlays(la.series).at(-1)).toEqual({ date: '2026-09-14', plays: 2 })
  })

  it('charts all time from the first play, and nothing for a track never played', async () => {
    const body = await json(await get('loop', '?range=all'))
    expect(body.bucket).toBe('month')
    expect(body.series[0]).toEqual({ date: '2025-12-01', plays: 1 })
    expect(body.series).toHaveLength(10)
    expect((await json(await get('nope', '?range=all'))).series).toEqual([])
  })

  it('turns to years once the first play is more than three years back', async () => {
    const body = await json(await get('old', '?range=all'))
    expect(body.bucket).toBe('year')
    expect(body.series).toEqual([
      { date: '2021-01-01', plays: 1 },
      { date: '2022-01-01', plays: 0 },
      { date: '2023-01-01', plays: 0 },
      { date: '2024-01-01', plays: 0 },
      { date: '2025-01-01', plays: 0 },
      { date: '2026-01-01', plays: 0 },
    ])
  })

  it('rejects an unknown range', async () => {
    expect((await get('loop', '?range=5y')).status).toBe(400)
  })
})
