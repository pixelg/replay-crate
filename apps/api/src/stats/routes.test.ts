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
    await ctx.app.request('/api/v1/history/sync', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173' } })
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
      expect(byDate['2026-09-18']).toMatchObject({ date: '2026-09-18', newTracks: 1, replays: 0, minutes: 3 })
      expect(byDate['2026-09-19']).toMatchObject({ newTracks: 0, replays: 1 })
      expect(byDate['2026-09-21']).toMatchObject({ newTracks: 1, replays: 2 })
      expect(byDate['2026-09-16']).toEqual({
        date: '2026-09-16',
        newTracks: 0,
        replays: 0,
        minutes: 0,
        byArtist: [{ plays: 0, minutes: 0 }],
        others: { plays: 0, minutes: 0 },
      })
      expect(body.totals).toEqual({ plays: 5, minutes: 17, tracks: 2, artists: 2, newTracks: 2 })
    })

    it('splits listening by the top artists (first credit, by plays) and everyone else', async () => {
      // Seven days: Band has all five plays (Guest is only a second credit).
      const week = await json(await get('/api/v1/stats/overview?range=7d&tz=UTC'))
      expect(week.artists).toEqual([{ id: 'band', name: 'Band', plays: 5, minutes: 17 }])
      const byDate = Object.fromEntries(week.series.map((p: { date: string }) => [p.date, p]))
      expect(byDate['2026-09-21']).toMatchObject({ byArtist: [{ plays: 3, minutes: 10 }], others: { plays: 0, minutes: 0 } })

      // All time: Solo joins, ranked below Band on plays.
      const all = await json(await get('/api/v1/stats/overview?range=all&tz=UTC'))
      expect(all.artists.map((artist: { id: string }) => artist.id)).toEqual(['band', 'solo'])
      const june = all.series.find((p: { date: string }) => p.date === weekStart('2026-06-01'))
      expect(june).toMatchObject({ byArtist: [{ plays: 0 }, { plays: 1 }], others: { plays: 0 } })
    })

    it('ranks artists by plays, so a long track doesn’t outrank a short one', async () => {
      // One half-hour epic: more time than all of Band's plays together.
      const epic = { ...track('epic', { name: 'Epic', artists: [['long', 'Long Player']] }), duration_ms: 1_800_000 }
      ctx.advance(60_000)
      ctx.spotify.getRecentlyPlayed.mockResolvedValueOnce({ items: [play(epic, '2026-09-21T11:30:00.000Z')], cursors: null })
      await ctx.app.request('/api/v1/history/sync', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173' } })
      const body = await json(await get('/api/v1/stats/overview?range=all&tz=UTC'))
      // Long Player has the most time (30 min against Band's 17) but one play, so Band stays on top.
      expect(body.artists.map((artist: { id: string; plays: number; minutes: number }) => [artist.id, artist.plays, artist.minutes])).toEqual([
        ['band', 5, 17],
        ['long', 1, 30],
        ['solo', 1, 3],
      ])
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

    it('covers a calendar month by day, up to today while it’s still going', async () => {
      const september = await json(await get('/api/v1/stats/overview?period=2026-09&tz=UTC'))
      expect(september).toMatchObject({ period: '2026-09', bucket: 'day', totals: { plays: 5, tracks: 2 } })
      expect(september).not.toHaveProperty('range')
      expect(september.series[0].date).toBe('2026-09-01')
      expect(september.series.at(-1).date).toBe('2026-09-21')

      const june = await json(await get('/api/v1/stats/overview?period=2026-06&tz=UTC'))
      expect(june.series).toHaveLength(30)
      expect(june.series.at(-1).date).toBe('2026-06-30')
      expect(june.totals).toEqual({ plays: 1, minutes: 3, tracks: 1, artists: 1, newTracks: 1 })
      expect(june.artists).toEqual([{ id: 'solo', name: 'Solo', plays: 1, minutes: 3 }])
    })

    it('covers a calendar year by week, and a year without plays is all zeros', async () => {
      const year = await json(await get('/api/v1/stats/overview?period=2026&tz=UTC'))
      expect(year).toMatchObject({ period: '2026', bucket: 'week', totals: { plays: 6 } })
      // 1 January 2026 is a Thursday: the first week starts the Monday before.
      expect(year.series[0].date).toBe('2025-12-29')
      expect(year.series.at(-1)).toMatchObject({ date: '2026-09-21', newTracks: 1, replays: 2 })

      const empty = await json(await get('/api/v1/stats/overview?period=2025&tz=UTC'))
      expect(empty.totals).toEqual({ plays: 0, minutes: 0, tracks: 0, artists: 0, newTracks: 0 })
      expect(empty.series).toHaveLength(53)
      expect(empty.series.at(-1).date).toBe('2025-12-29')
    })

    it('counts a period in the user’s time zone', async () => {
      // 02:00 UTC on 1 June is still 31 May in Los Angeles.
      ctx.advance(60_000)
      ctx.spotify.getRecentlyPlayed.mockResolvedValueOnce({ items: [play(other, '2026-06-01T02:00:00.000Z')], cursors: null })
      await ctx.app.request('/api/v1/history/sync', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173' } })
      expect((await json(await get('/api/v1/stats/overview?period=2026-06&tz=UTC'))).totals.plays).toBe(2)
      expect((await json(await get('/api/v1/stats/overview?period=2026-06&tz=America/Los_Angeles'))).totals.plays).toBe(1)
      expect((await json(await get('/api/v1/stats/overview?period=2026-05&tz=America/Los_Angeles'))).totals.plays).toBe(1)
    })

    it('rejects a range and a period together, and a malformed period', async () => {
      const both = await get('/api/v1/stats/overview?range=7d&period=2026')
      expect(both.status).toBe(400)
      expect((await json(both)).issues[0].path).toBe('period')
      for (const period of ['2026-13', '26', '2026-9']) {
        expect((await get(`/api/v1/stats/overview?period=${period}`)).status).toBe(400)
      }
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
        { rank: 1, id: 'loop', name: 'Loop', subtitle: 'Band, Guest', imageUrl: 'https://i.scdn.co/alb-a-64', plays: 4, minutes: 13, rating: null },
        { rank: 2, id: 'fresh', name: 'Fresh', subtitle: 'Band', imageUrl: 'https://i.scdn.co/alb-a-64', plays: 1, minutes: 3, rating: null },
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

    it('ranks within a calendar year or month', async () => {
      const june = await json(await get('/api/v1/stats/top?type=tracks&period=2026-06&tz=UTC'))
      expect(june).toMatchObject({ type: 'tracks', period: '2026-06', tz: 'UTC', metric: 'plays', limit: 10 })
      expect(june).not.toHaveProperty('range')
      expect(june.items.map((i: { id: string; plays: number }) => [i.id, i.plays])).toEqual([['other', 1]])

      const year = await json(await get('/api/v1/stats/top?type=artists&period=2026'))
      expect(year.items.map((i: { id: string; plays: number }) => [i.id, i.plays])).toEqual([
        ['band', 5],
        ['guest', 4],
        ['solo', 1],
      ])
      expect((await json(await get('/api/v1/stats/top?period=2025'))).items).toEqual([])
      expect((await get('/api/v1/stats/top?range=all&period=2026')).status).toBe(400)
    })

    it('ranks genres, a play once per genre however many of its artists share it', async () => {
      const [hipHop, jazz] = await ctx.giveGenres('band', ['hip hop', 'jazz'])
      const [, soul] = await ctx.giveGenres('guest', ['hip hop', 'soul'])
      await ctx.giveGenres('solo', ['funk'])
      const body = await json(await get('/api/v1/stats/top?type=genres&range=30d'))
      expect(body).toMatchObject({ type: 'genres', range: '30d' })
      expect(body.items).toEqual([
        // Loop's four plays (Band and Guest are both hip hop) and Fresh's one; ties go A–Z.
        { rank: 1, id: String(hipHop!.id), name: 'hip hop', subtitle: '2 artists', imageUrl: null, plays: 5, minutes: 17, rating: null },
        { rank: 2, id: String(jazz!.id), name: 'jazz', subtitle: '1 artist', imageUrl: null, plays: 5, minutes: 17, rating: null },
        { rank: 3, id: String(soul!.id), name: 'soul', subtitle: '1 artist', imageUrl: null, plays: 4, minutes: 13, rating: null },
      ])
      // Solo's June play is outside 30 days, inside the year.
      const year = await json(await get('/api/v1/stats/top?type=genres&period=2026&metric=minutes'))
      expect(year.items.map((i: { name: string; plays: number }) => [i.name, i.plays])).toEqual([
        ['hip hop', 5],
        ['jazz', 5],
        ['soul', 4],
        ['funk', 1],
      ])
    })

    it('still echoes the default range', async () => {
      expect(await json(await get('/api/v1/stats/top?limit=1'))).toMatchObject({ range: '30d', tz: 'UTC' })
    })

    it('can rank by minutes instead', async () => {
      const body = await json(await get('/api/v1/stats/top?type=tracks&range=all&metric=minutes&limit=1'))
      expect(body.items).toEqual([expect.objectContaining({ id: 'loop', minutes: 13 })])
    })
  })

  describe('GET /api/v1/stats/calendar', () => {
    beforeEach(async () => {
      // Older years: two plays in 2023, and New Year's Eve 2019 in UTC (already 2020 in Tokyo).
      ctx.advance(60_000)
      ctx.spotify.getRecentlyPlayed.mockResolvedValueOnce({
        items: [
          play(other, '2023-03-06T20:00:00.000Z'),
          play(loop, '2023-03-06T09:00:00.000Z'),
          play(fresh, '2019-12-31T23:30:00.000Z'),
        ],
        cursors: null,
      })
      await ctx.app.request('/api/v1/history/sync', { method: 'POST', headers: { Cookie: cookie, Origin: 'http://127.0.0.1:5173' } })
    })

    it('counts plays per local day of the year, leaving out empty days', async () => {
      const body = await json(await get('/api/v1/stats/calendar?year=2026&tz=UTC'))
      expect(body).toEqual({
        year: 2026,
        tz: 'UTC',
        years: [2019, 2023, 2026],
        days: [
          { date: '2026-06-01', plays: 1 },
          { date: '2026-09-18', plays: 1 },
          { date: '2026-09-19', plays: 1 },
          { date: '2026-09-21', plays: 3 },
        ],
      })
      const older = await json(await get('/api/v1/stats/calendar?year=2023&tz=UTC'))
      expect(older.days).toEqual([{ date: '2023-03-06', plays: 2 }])
      expect((await json(await get('/api/v1/stats/calendar?year=2024&tz=UTC'))).days).toEqual([])
    })

    it('defaults to this year', async () => {
      const body = await json(await get('/api/v1/stats/calendar?tz=UTC'))
      expect(body.year).toBe(2026)
      expect(body.days).toHaveLength(4)
    })

    it('uses the user’s days and years', async () => {
      const la = await json(await get('/api/v1/stats/calendar?year=2026&tz=America/Los_Angeles'))
      // 03:00 UTC on the 21st is still the 20th in Los Angeles.
      expect(la.days.slice(-2)).toEqual([
        { date: '2026-09-20', plays: 1 },
        { date: '2026-09-21', plays: 2 },
      ])
      const tokyo = await json(await get('/api/v1/stats/calendar?year=2020&tz=Asia/Tokyo'))
      expect(tokyo.years).toEqual([2020, 2023, 2026])
      expect(tokyo.days).toEqual([{ date: '2020-01-01', plays: 1 }])
    })

    it('has no years before the first play', async () => {
      await ctx.db.delete(schema.plays)
      expect(await json(await get('/api/v1/stats/calendar?year=2026'))).toEqual({ year: 2026, tz: 'UTC', years: [], days: [] })
    })

    it('rejects an unknown time zone or a bad year', async () => {
      const res = await get('/api/v1/stats/calendar?tz=Mars/Olympus')
      expect(res.status).toBe(400)
      expect((await json(res)).issues[0].path).toBe('tz')
      expect((await get('/api/v1/stats/calendar?year=soon')).status).toBe(400)
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
