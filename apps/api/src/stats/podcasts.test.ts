import { schema } from '@replay-crate/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { upsertEpisodes, saveProgress } from '../podcasts/catalog.ts'
import { createTestContext, episode } from '../testing.ts'

const MIN = 60_000

describe('podcast stats', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string

  // oxlint-disable-next-line typescript/no-explicit-any
  const get = async (path: string): Promise<any> => {
    const res = await ctx.app.request(`/api/v1${path}`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    return res.json()
  }
  /** A listen of `episodeId` ending at `endedAt`, `minutes` long. */
  const listen = (episodeId: string, endedAt: string, minutes: number) =>
    ctx.db.insert(schema.episodeListens).values({
      userId: 'pixelg',
      episodeId,
      startedAt: new Date(Date.parse(endedAt) - minutes * MIN),
      endedAt: new Date(endedAt),
      lastSeenAt: new Date(endedAt),
      listenedMs: minutes * MIN,
      source: 'import',
    })

  beforeEach(async () => {
    ctx = await createTestContext() // the clock says 2026-09-21T12:00Z
    cookie = `rc_session=${(await ctx.login()).token}`
    await upsertEpisodes(ctx.db, [
      episode('a1', { name: 'Pod A, one', show: ['a', 'Pod A'] }),
      episode('a2', { name: 'Pod A, two', show: ['a', 'Pod A'] }),
      episode('b1', { name: 'Pod B, one', show: ['b', 'Pod B'] }),
    ])
    await listen('a1', '2026-09-20T08:00:00Z', 30)
    await listen('a1', '2026-09-21T08:00:00Z', 10)
    await listen('a2', '2026-09-21T09:00:00Z', 5)
    await listen('b1', '2026-09-19T09:00:00Z', 50)
    // Last year: outside the last 30 days.
    await listen('b1', '2025-03-01T09:00:00Z', 20)
    await saveProgress(ctx.db, { userId: 'pixelg', episodeId: 'b1', resumePositionMs: 0, fullyPlayed: true }, new Date())
  })
  afterEach(() => ctx.close())

  it('sums the last 30 days, by show and by day', async () => {
    const body = await get('/stats/podcasts/overview?range=30d&tz=UTC')
    expect(body).toMatchObject({ range: '30d', bucket: 'day', totals: { listens: 4, minutes: 95, episodes: 3, shows: 2, finished: 1 } })
    expect(body.shows).toEqual([
      { id: 'b', name: 'Pod B', thumbUrl: 'https://i.scdn.co/b-300', listens: 1, minutes: 50 },
      { id: 'a', name: 'Pod A', thumbUrl: 'https://i.scdn.co/a-300', listens: 3, minutes: 45 },
    ])
    expect(body.series).toHaveLength(30)
    expect(body.series.at(-1)).toEqual({ date: '2026-09-21', listens: 2, minutes: 15, byShow: [{ listens: 0, minutes: 0 }, { listens: 2, minutes: 15 }], others: { listens: 0, minutes: 0 } })
    expect(body.series.at(-3)).toMatchObject({ date: '2026-09-19', minutes: 50, byShow: [{ minutes: 50 }, { minutes: 0 }] })
  })

  it('covers all time by week, or a calendar period', async () => {
    const all = await get('/stats/podcasts/overview?range=all&tz=UTC')
    expect(all).toMatchObject({ bucket: 'week', totals: { listens: 5, minutes: 115 } })
    expect(all.series[0].date).toBe('2025-02-24')
    expect(await get('/stats/podcasts/overview?period=2025-03&tz=UTC')).toMatchObject({ period: '2025-03', totals: { listens: 1, minutes: 20 } })
    expect(await get('/stats/podcasts/overview?period=2019')).toMatchObject({ totals: { listens: 0 } })
  })

  it('is empty before any listen', async () => {
    await ctx.db.delete(schema.episodeListens)
    expect(await get('/stats/podcasts/overview?range=all')).toMatchObject({ totals: { listens: 0, minutes: 0 }, shows: [], series: [] })
  })

  it('ranks shows and episodes by time or listens', async () => {
    const shows = await get('/stats/podcasts/top?type=shows&range=30d')
    expect(shows.items.map((item: { id: string; subtitle: string }) => [item.id, item.subtitle])).toEqual([
      ['b', '1 episode'],
      ['a', '2 episodes'],
    ])
    const byListens = await get('/stats/podcasts/top?type=shows&metric=listens&range=30d')
    expect(byListens.items[0]).toMatchObject({ rank: 1, id: 'a', listens: 3, minutes: 45 })
    const episodes = await get('/stats/podcasts/top?type=episodes&range=all&limit=2')
    expect(episodes.items).toEqual([
      { rank: 1, id: 'b1', name: 'Pod B, one', subtitle: 'Pod B', imageUrl: 'https://i.scdn.co/b1-64', listens: 2, minutes: 70 },
      { rank: 2, id: 'a1', name: 'Pod A, one', subtitle: 'Pod A', imageUrl: 'https://i.scdn.co/a1-64', listens: 2, minutes: 40 },
    ])
  })

  it('has time per day for a year, and the years with listens', async () => {
    const body = await get('/stats/podcasts/calendar?year=2026&tz=UTC')
    expect(body.years).toEqual([2025, 2026])
    expect(body.days).toEqual([
      { date: '2026-09-19', listens: 1, minutes: 50 },
      { date: '2026-09-20', listens: 1, minutes: 30 },
      { date: '2026-09-21', listens: 2, minutes: 15 },
    ])
  })

  it('counts listens per month for the period picker', async () => {
    expect(await get('/history/listens/timeline?tz=UTC')).toEqual({
      months: [
        { month: '2026-09', listens: 4 },
        { month: '2025-03', listens: 1 },
      ],
    })
  })
})
