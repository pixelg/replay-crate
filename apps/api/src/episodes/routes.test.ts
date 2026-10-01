import { SpotifyApiError } from '@replay-crate/spotify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, episode } from '../testing.ts'

const MIN = 60_000
const ORIGIN = 'http://127.0.0.1:5173'

describe('episodes, shows and listens', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string

  const talk = episode('talk', { name: 'On Listening', show: ['pod', 'The Pod'], durationMs: 60 * MIN, releaseDate: '2026-08-01' })
  const sequel = episode('sequel', { name: 'On Listening II', show: ['pod', 'The Pod'], durationMs: 30 * MIN, releaseDate: '2026-09-01' })
  const news = episode('news', { name: 'The Day', show: ['daily', 'Daily'], durationMs: 20 * MIN, releaseDate: '2026-09-20' })

  beforeEach(async () => {
    ctx = await createTestContext()
    cookie = `rc_session=${(await ctx.login()).token}`
    ctx.library.addEpisodes(talk, sequel, news)
  })
  afterEach(() => ctx.close())

  // oxlint-disable-next-line typescript/no-explicit-any
  const get = async (path: string): Promise<any> => {
    const res = await ctx.app.request(`/api/v1${path}`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    return res.json()
  }
  const send = (method: string, path: string, body?: unknown) =>
    ctx.app.request(`/api/v1${path}`, {
      method,
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  /** Plays `item` from `fromMs` for `minutes`, looked at every two minutes, then pauses and moves the clock on. */
  async function listen(item: ReturnType<typeof episode>, fromMs: number, minutes: number) {
    ctx.player.nowPlaying(item, { positionMs: fromMs })
    await get('/player')
    for (let done = 0; done < minutes; done += 2) {
      ctx.advance(Math.min(2, minutes - done) * MIN)
      await get('/player')
    }
    await ctx.player.gateway.pause('t', {})
    ctx.advance(30 * MIN)
    await get('/player')
  }

  describe('GET /history/listens', () => {
    it('lists listens, latest first, with the episode, its show and progress', async () => {
      await listen(talk, 0, 4)
      await listen(news, 0, 20)
      const { items, nextCursor } = await get('/history/listens')
      expect(nextCursor).toBeNull()
      expect(items).toMatchObject([
        {
          listenedMs: 20 * MIN,
          startPositionMs: 0,
          endPositionMs: 20 * MIN,
          source: 'poll',
          episode: { id: 'news', name: 'The Day', show: { id: 'daily', name: 'Daily' }, progress: { fullyPlayed: true }, rating: null },
        },
        { listenedMs: 4 * MIN, episode: { id: 'talk', releaseDate: '2026-08-01', progress: { resumePositionMs: 4 * MIN, fullyPlayed: false } } },
      ])
    })

    it('pages by cursor or offset, and filters by show and time', async () => {
      await listen(talk, 0, 2)
      await listen(sequel, 0, 2)
      await listen(news, 0, 2)
      const first = await get('/history/listens?limit=2')
      expect(first.items.map((item: { episode: { id: string } }) => item.episode.id)).toEqual(['news', 'sequel'])
      const rest = await get(`/history/listens?limit=2&before=${first.nextCursor}`)
      expect(rest).toMatchObject({ items: [{ episode: { id: 'talk' } }], nextCursor: null })
      expect(await get('/history/listens?limit=1&offset=1')).toMatchObject({ items: [{ episode: { id: 'sequel' } }], total: 3 })
      expect((await get('/history/listens?show=pod')).items).toHaveLength(2)
      const since = new Date(ctx.deps.now!().getTime() - 40 * MIN).toISOString()
      expect((await get(`/history/listens?since=${since}`)).items.map((item: { episode: { id: string } }) => item.episode.id)).toEqual(['news'])
      expect((await send('GET', '/history/listens?offset=0&before=2026-01-01T00:00:00.000Z')).status).toBe(400)
    })

    it('offers the listened shows to filter by', async () => {
      await listen(talk, 0, 2)
      await listen(sequel, 0, 2)
      await listen(news, 0, 2)
      expect(await get('/history/listens/shows')).toEqual({
        shows: [
          { id: 'pod', name: 'The Pod', thumbUrl: 'https://i.scdn.co/pod-300', listens: 2 },
          { id: 'daily', name: 'Daily', thumbUrl: 'https://i.scdn.co/daily-300', listens: 1 },
        ],
      })
    })
  })

  describe('GET /episodes', () => {
    beforeEach(async () => {
      await listen(talk, 0, 6)
      await listen(news, 0, 20)
      await listen(sequel, 0, 2)
      await listen(talk, 6 * MIN, 4)
    })
    const ids = (body: { items: Array<{ episode: { id: string } }> }) => body.items.map((item) => item.episode.id)

    it('lists each episode once with its listens, recent first', async () => {
      const body = await get('/episodes')
      expect(body.total).toBe(3)
      expect(body.items[0]).toMatchObject({ episode: { id: 'talk' }, listens: 2, listenedMs: 10 * MIN })
      expect(ids(body)).toEqual(['talk', 'sequel', 'news'])
    })

    it('sorts by time listened, rating or release, and leaves out finished ones', async () => {
      expect(ids(await get('/episodes?sort=most'))).toEqual(['news', 'talk', 'sequel'])
      expect(ids(await get('/episodes?sort=newest'))).toEqual(['news', 'sequel', 'talk'])
      expect((await send('PUT', '/episodes/sequel/rating', { rating: 5 })).status).toBe(200)
      expect(ids(await get('/episodes?sort=rating'))).toEqual(['sequel', 'talk', 'news'])
      expect(await get('/episodes?unfinished=true')).toMatchObject({ total: 2 })
      expect(ids(await get('/episodes?sort=most&limit=1&offset=1'))).toEqual(['talk'])
    })
  })

  describe('GET /episodes/{id}', () => {
    it('has the description, stats and recent listens', async () => {
      await listen(talk, 0, 4)
      await listen(talk, 10 * MIN, 2)
      const body = await get('/episodes/talk')
      expect(body.episode).toMatchObject({ id: 'talk', description: 'In this episode of The Pod…', imageUrl: 'https://i.scdn.co/talk-300' })
      expect(body.stats).toMatchObject({ listens: 2, listenedMs: 6 * MIN })
      expect(body.recentListens).toHaveLength(2)
      expect(body.recentListens[0]).toMatchObject({ startPositionMs: 10 * MIN, endPositionMs: 12 * MIN })
    })

    it('404s for an episode the app has never seen', async () => {
      expect((await send('GET', '/episodes/nope')).status).toBe(404)
    })
  })

  describe('rating', () => {
    it('rates, re-rates and clears, fetching an unseen episode first', async () => {
      expect(await (await send('PUT', '/episodes/news/rating', { rating: 3 })).json()).toEqual({ rating: 3 })
      expect(ctx.spotify.getEpisode).toHaveBeenCalledWith(expect.any(String), 'news')
      await send('PUT', '/episodes/news/rating', { rating: 4 })
      expect((await get('/episodes/news')).episode.rating).toBe(4)
      expect((await send('DELETE', '/episodes/news/rating')).status).toBe(204)
      expect((await get('/episodes/news')).episode.rating).toBeNull()
    })

    it('rejects ratings out of range, and episodes Spotify doesn’t have', async () => {
      expect((await send('PUT', '/episodes/news/rating', { rating: 6 })).status).toBe(400)
      ctx.spotify.getEpisode.mockRejectedValueOnce(new SpotifyApiError(404, 'gone'))
      expect((await send('PUT', '/episodes/gone/rating', { rating: 3 })).status).toBe(404)
    })
  })

  describe('shows', () => {
    it('lists listened shows, the most recent first', async () => {
      await listen(talk, 0, 4)
      await listen(sequel, 0, 2)
      await listen(news, 0, 2)
      const { items } = await get('/shows')
      expect(items).toMatchObject([
        { show: { id: 'daily', name: 'Daily' }, stats: { episodes: 1, listens: 1, listenedMs: 2 * MIN } },
        { show: { id: 'pod', name: 'The Pod' }, stats: { episodes: 2, listens: 2, listenedMs: 6 * MIN } },
      ])
    })

    it('shows a show with its known episodes, newest release first', async () => {
      await listen(talk, 0, 4)
      // Seen paused in the player: known, but never listened to.
      ctx.player.nowPlaying(sequel, { playing: false })
      ctx.advance(MIN)
      await get('/player')
      const body = await get('/shows/pod')
      expect(body.show).toMatchObject({ id: 'pod', name: 'The Pod', description: 'About The Pod' })
      expect(body.stats).toMatchObject({ episodes: 1, listens: 1, listenedMs: 4 * MIN })
      expect(body.episodes).toMatchObject([
        { episode: { id: 'sequel', progress: null }, listens: 0, listenedMs: 0, lastListenedAt: null },
        { episode: { id: 'talk' }, listens: 1, listenedMs: 4 * MIN },
      ])
      expect((await send('GET', '/shows/nope')).status).toBe(404)
    })
  })
})
