import { schema } from '@replay-crate/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, play, playlistContext, track } from '../testing.ts'
import { addDays, weekStart } from './ranges.ts'

// The test clock is 2026-09-21T12:00:00Z (a Monday).
describe('stats', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string

  // oxlint-disable-next-line typescript/no-explicit-any
  const json = (res: Response): Promise<any> => res.json()
  const get = (path: string) => ctx.app.request(path, { headers: { Cookie: cookie } })

  const loop = track('loop', { name: 'Loop', album: ['alb-a', 'Album A'], artists: [['band', 'Band'], ['guest', 'Guest']] })
  const fresh = track('fresh', { name: 'Fresh', album: ['alb-a', 'Album A'], artists: [['band', 'Band']] })
  const other = track('other', { name: 'Other', album: ['alb-b', 'Album B'], artists: [['solo', 'Solo']] })

  beforeEach(async () => {
    ctx = await createTestContext()
    const { token } = await ctx.login()
    cookie = `rc_session=${token}`
    ctx.spotify.getRecentlyPlayed.mockResolvedValue({
      items: [
        play(loop, '2026-09-21T11:00:00.000Z', playlistContext('pl')), // replay
        play(fresh, '2026-09-21T10:00:00.000Z'), // new today
        play(loop, '2026-09-21T03:00:00.000Z'), // replay; the 20th in Los Angeles
        play(loop, '2026-09-19T12:00:00.000Z'), // replay
        play(loop, '2026-09-18T12:00:00.000Z'), // first ever play of loop
        play(other, '2026-06-01T12:00:00.000Z'), // outside 90d
      ],
      cursors: null,
    })
    await ctx.app.request('/api/v1/sync', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173' } })
  })
  afterEach(() => ctx.close())

  it('date helpers', () => {
    expect(addDays('2026-02-27', 3)).toBe('2026-03-02')
    expect(weekStart('2026-09-20')).toBe('2026-09-14') // Sunday -> Monday before
    expect(weekStart('2026-09-21')).toBe('2026-09-21')
  })

  describe('GET /api/v1/stats/overview', () => {
    it('splits each day into new tracks and replays, filling empty days', async () => {
      const body = await json(await get('/api/v1/stats/overview?range=7d&tz=UTC'))
      expect(body.bucket).toBe('day')
      expect(body.series.map((p: { date: string }) => p.date)).toEqual([
        '2026-09-15',
        '2026-09-16',
        '2026-09-17',
        '2026-09-18',
        '2026-09-19',
        '2026-09-20',
        '2026-09-21',
      ])
      const byDate = Object.fromEntries(body.series.map((p: { date: string }) => [p.date, p]))
      expect(byDate['2026-09-18']).toEqual({ date: '2026-09-18', newTracks: 1, replays: 0, minutes: 3 })
      expect(byDate['2026-09-19']).toMatchObject({ newTracks: 0, replays: 1 })
      expect(byDate['2026-09-21']).toMatchObject({ newTracks: 1, replays: 2 })
      expect(byDate['2026-09-16']).toEqual({ date: '2026-09-16', newTracks: 0, replays: 0, minutes: 0 })
      expect(body.totals).toEqual({ plays: 5, minutes: 17, tracks: 2, artists: 2, newTracks: 2 })
    })

    it('buckets by the user’s local day', async () => {
      const body = await json(await get('/api/v1/stats/overview?range=7d&tz=America/Los_Angeles'))
      const byDate = Object.fromEntries(body.series.map((p: { date: string }) => [p.date, p]))
      // 03:00 UTC on the 21st is still the 20th in Los Angeles.
      expect(byDate['2026-09-20']).toMatchObject({ replays: 1 })
      expect(byDate['2026-09-21']).toMatchObject({ newTracks: 1, replays: 1 })
    })

    it('uses weekly buckets for a year and covers all history for "all"', async () => {
      const year = await json(await get('/api/v1/stats/overview?range=1y&tz=UTC'))
      expect(year.bucket).toBe('week')
      expect(year.series.every((p: { date: string }) => weekStart(p.date) === p.date)).toBe(true)
      expect(year.series.at(-1)).toMatchObject({ date: '2026-09-21', newTracks: 1, replays: 2 })

      const all = await json(await get('/api/v1/stats/overview?range=all&tz=UTC'))
      expect(all.series[0].date).toBe(weekStart('2026-06-01'))
      expect(all.totals.plays).toBe(6)
    })

    it('rejects an unknown time zone', async () => {
      const res = await get('/api/v1/stats/overview?tz=Mars/Olympus')
      expect(res.status).toBe(400)
      expect((await json(res)).issues[0].path).toBe('tz')
    })
  })

  describe('GET /api/v1/stats/top', () => {
    it('ranks tracks by plays', async () => {
      const body = await json(await get('/api/v1/stats/top?type=tracks&range=30d'))
      expect(body.items).toEqual([
        { rank: 1, id: 'loop', name: 'Loop', subtitle: 'Band, Guest', imageUrl: 'https://i.scdn.co/alb-a-64', plays: 4, minutes: 13 },
        { rank: 2, id: 'fresh', name: 'Fresh', subtitle: 'Band', imageUrl: 'https://i.scdn.co/alb-a-64', plays: 1, minutes: 3 },
      ])
    })

    it('credits every artist on a track, and ranks albums with their artist', async () => {
      const topArtists = await json(await get('/api/v1/stats/top?type=artists&range=30d'))
      expect(topArtists.items.map((i: { id: string; plays: number; subtitle: string }) => [i.id, i.plays, i.subtitle])).toEqual([
        ['band', 5, '2 tracks'],
        ['guest', 4, '1 track'],
      ])
      const topAlbums = await json(await get('/api/v1/stats/top?type=albums&range=all'))
      expect(topAlbums.items.map((i: { id: string; plays: number; subtitle: string }) => [i.id, i.plays, i.subtitle])).toEqual([
        ['alb-a', 5, 'Band'],
        ['alb-b', 1, 'Solo'],
      ])
    })

    it('can rank by minutes instead', async () => {
      const body = await json(await get('/api/v1/stats/top?type=tracks&range=all&metric=minutes&limit=1'))
      expect(body.items).toEqual([expect.objectContaining({ id: 'loop', minutes: 13 })])
    })
  })

  describe('GET /api/v1/stats/spotify-top', () => {
    beforeEach(() => {
      ctx.spotify.getTopTracks.mockResolvedValue({
        items: [loop, track('never', { name: 'Never played here', artists: [['newcomer', 'Newcomer']] })],
        next: null,
        total: 2,
        offset: 0,
        limit: 20,
      })
    })

    it('shows Spotify’s top tracks with our play counts', async () => {
      const body = await json(await get('/api/v1/stats/spotify-top?type=tracks&timeRange=short_term'))
      expect(body.items.map((i: { id: string; rank: number; plays: number }) => [i.rank, i.id, i.plays])).toEqual([
        [1, 'loop', 4],
        [2, 'never', 0],
      ])
      expect(ctx.spotify.getTopTracks).toHaveBeenCalledWith('access-1', 'short_term')
    })

    it('shows top artists and keeps their images', async () => {
      const artist = (id: string, name: string) => ({
        id,
        name,
        uri: `spotify:artist:${id}`,
        images: [{ url: `https://i.scdn.co/${id}`, width: 300, height: 300 }],
      })
      ctx.spotify.getTopArtists.mockResolvedValue({
        items: [artist('band', 'Band'), artist('guest', 'Guest'), artist('newcomer', 'Newcomer')],
        next: null,
        total: 3,
        offset: 0,
        limit: 20,
      })
      const body = await json(await get('/api/v1/stats/spotify-top?type=artists&timeRange=long_term'))
      expect(body.items.map((i: { id: string; plays: number }) => [i.id, i.plays])).toEqual([
        ['band', 5],
        ['guest', 4],
        ['newcomer', 0],
      ])
      const [band] = await ctx.db.select().from(schema.artists).where(eq(schema.artists.id, 'band'))
      expect(band!.imageUrl).toBe('https://i.scdn.co/band')
    })
  })
})
