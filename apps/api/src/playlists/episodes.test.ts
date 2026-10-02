import { schema } from '@replay-crate/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { saveProgress } from '../podcasts/catalog.ts'
import { createTestContext, episode, track } from '../testing.ts'

const ORIGIN = 'http://127.0.0.1:5173'
const MIN = 60_000

describe('episode playlists', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string

  // oxlint-disable-next-line typescript/no-explicit-any
  const json = (res: Response): Promise<any> => res.json()
  const send = (method: string, path: string, body?: unknown) =>
    ctx.app.request(`/api/v1${path}`, {
      method,
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const get = async (path: string) => {
    const res = await send('GET', path)
    expect(res.status).toBe(200)
    return json(res)
  }
  const positions = async (id: string) => {
    const { items, episodes } = await get(`/playlists/${id}`)
    return {
      tracks: items.map((item: { position: number; track: { id: string } }) => [item.position, item.track.id]),
      episodes: episodes.map((item: { position: number; episode: { id: string } }) => [item.position, item.episode.id]),
    }
  }

  const song = track('song')
  const tune = track('tune')
  const talk = episode('talk', { name: 'Talk', show: ['pod', 'The Pod'], durationMs: 60 * MIN, releaseDate: '2026-09-18' })
  const chat = episode('chat', { name: 'Chat', show: ['pod', 'The Pod'], durationMs: 30 * MIN, releaseDate: '2026-09-01' })

  beforeEach(async () => {
    ctx = await createTestContext()
    cookie = `rc_session=${(await ctx.login()).token}`
    ctx.library.add('mix', [song, talk, tune, chat], 'Mixed')
    ctx.library.add('pods', [chat], 'Podcasts only')
    ctx.library.add('songs', [song], 'Songs only')
    ctx.library.add('empty', [], 'Empty')
    const synced = await send('POST', '/playlists/sync')
    if (synced.status !== 200) throw new Error(`playlist sync answered ${synced.status}`)
  })
  afterEach(() => ctx.close())

  it('keeps episodes at their Spotify positions, beside the tracks', async () => {
    expect(await positions('mix')).toEqual({ tracks: [[0, 'song'], [2, 'tune']], episodes: [[1, 'talk'], [3, 'chat']] })
    const { episodes } = await get('/playlists/mix')
    expect(episodes[0]).toMatchObject({ episode: { id: 'talk', name: 'Talk', show: { id: 'pod', name: 'The Pod' } }, listens: 0, listenedMs: 0 })
  })

  it('counts tracks and episodes, and lists playlists by what they hold', async () => {
    const { playlists } = await get('/playlists')
    expect(playlists.find((p: { id: string }) => p.id === 'mix')).toMatchObject({ itemCount: 4, trackCount: 2, episodeCount: 2 })
    const names = async (contains: string) => (await get(`/playlists?contains=${contains}`)).playlists.map((p: { id: string }) => p.id).toSorted()
    expect(await names('tracks')).toEqual(['mix', 'songs'])
    expect(await names('episodes')).toEqual(['mix', 'pods'])
  })

  it('adds, moves and removes episodes', async () => {
    expect((await send('POST', '/playlists/songs/episodes', { episodeIds: ['talk', 'chat'] })).status).toBe(200)
    expect(await positions('songs')).toEqual({ tracks: [[0, 'song']], episodes: [[1, 'talk'], [2, 'chat']] })
    expect((await send('PUT', '/playlists/songs/items/move', { from: 2, to: 0 })).status).toBe(200)
    expect(await positions('songs')).toEqual({ tracks: [[1, 'song']], episodes: [[0, 'chat'], [2, 'talk']] })
    expect((await send('DELETE', '/playlists/songs/episodes', { episodeIds: ['chat'] })).status).toBe(200)
    expect(await positions('songs')).toEqual({ tracks: [[0, 'song']], episodes: [[1, 'talk']] })
    expect((await send('POST', '/playlists/nope/episodes', { episodeIds: ['talk'] })).status).toBe(404)
  })

  it('creates a playlist of episodes', async () => {
    const res = await send('POST', '/playlists', { name: 'For the commute', episodeIds: ['chat', 'talk'] })
    expect(res.status).toBe(201)
    const { id } = await json(res)
    expect(await positions(id)).toEqual({ tracks: [], episodes: [[0, 'chat'], [1, 'talk']] })
  })

  describe('rules', () => {
    const preview = async (rule: unknown) => {
      const res = await send('POST', '/playlists/episode-preview', { rule })
      expect(res.status).toBe(200)
      const body = await json(res)
      return { name: body.suggestedName, ids: body.episodes.map((e: { id: string }) => e.id) }
    }
    const listen = (episodeId: string, endedAt: string) =>
      ctx.db.insert(schema.episodeListens).values({
        userId: 'pixelg',
        episodeId,
        startedAt: new Date(Date.parse(endedAt) - 10 * MIN),
        endedAt: new Date(endedAt),
        lastSeenAt: new Date(endedAt),
        listenedMs: 10 * MIN,
        source: 'import',
      })

    it('picks unfinished episodes, the most recently listened first', async () => {
      await listen('chat', '2026-09-19T10:00:00Z')
      await listen('talk', '2026-09-20T10:00:00Z')
      await saveProgress(ctx.db, { userId: 'pixelg', episodeId: 'chat', resumePositionMs: 10 * MIN, fullyPlayed: false }, new Date())
      await saveProgress(ctx.db, { userId: 'pixelg', episodeId: 'talk', resumePositionMs: 10 * MIN, fullyPlayed: false }, new Date())
      expect(await preview({ kind: 'unfinished' })).toEqual({ name: 'Unfinished episodes', ids: ['talk', 'chat'] })
      await saveProgress(ctx.db, { userId: 'pixelg', episodeId: 'talk', resumePositionMs: 60 * MIN, fullyPlayed: true }, new Date())
      expect((await preview({ kind: 'unfinished' })).ids).toEqual(['chat'])
    })

    it('picks what was played recently', async () => {
      await listen('chat', '2026-09-19T10:00:00Z')
      await listen('talk', '2026-08-01T10:00:00Z')
      expect(await preview({ kind: 'recently_played', range: '7d' })).toEqual({ name: 'Podcasts from the last 7 days', ids: ['chat'] })
      expect((await preview({ kind: 'recently_played', range: 'all' })).ids).toEqual(['chat', 'talk'])
    })

    it('picks top rated episodes', async () => {
      expect((await send('PUT', '/episodes/talk/rating', { rating: 5 })).status).toBe(200)
      expect((await send('PUT', '/episodes/chat/rating', { rating: 3 })).status).toBe(200)
      expect(await preview({ kind: 'top_rated' })).toEqual({ name: 'Top rated episodes (4★ and up)', ids: ['talk'] })
      expect((await preview({ kind: 'top_rated', minRating: 3 })).ids).toEqual(['talk', 'chat'])
    })

    it("picks the newest unfinished episodes of the shows you follow", async () => {
      ctx.library.followShow(talk.show, talk, chat)
      expect((await send('POST', '/shows/sync')).status).toBe(200)
      expect(await preview({ kind: 'newest_from_shows', days: 14 })).toEqual({ name: 'New from your shows', ids: ['talk'] })
      expect((await preview({ kind: 'newest_from_shows', days: 30 })).ids).toEqual(['talk', 'chat'])
    })
  })
})
