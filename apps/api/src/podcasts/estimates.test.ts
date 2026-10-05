import { schema } from '@replay-crate/db'
import { SpotifyApiError } from '@replay-crate/spotify'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { enqueue, runJobs } from '../jobs/queue.ts'
import { createTestContext, episode } from '../testing.ts'
import { episodeJobRef } from './listens.ts'

const ORIGIN = 'http://127.0.0.1:5173'
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
// 22-character Spotify ids, so the import takes them.
const LONG = 'LongEpisode00000000000'
const FRESH = 'FreshEpisode0000000000'
const OLD = 'OldEpisode000000000000'

describe('estimated podcast listens', () => {
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
  const sync = () => send('POST', '/history/listens/sync')
  const look = () => send('GET', '/player')
  const listens = () =>
    ctx.db
      .select({
        episodeId: schema.episodeListens.episodeId,
        startedAt: schema.episodeListens.startedAt,
        endedAt: schema.episodeListens.endedAt,
        listenedMs: schema.episodeListens.listenedMs,
        source: schema.episodeListens.source,
      })
      .from(schema.episodeListens)
      .orderBy(asc(schema.episodeListens.startedAt), asc(schema.episodeListens.episodeId))
  const estimates = async () => (await listens()).filter((listen) => listen.source === 'estimate')

  // The clock says 2026-09-21 12:00 UTC.
  const show: [string, string] = ['pod', 'The Pod']
  const long = episode(LONG, { name: 'A Long One', show, durationMs: 60 * MIN, releaseDate: '2026-09-20' })
  const fresh = episode(FRESH, { name: 'Out Tomorrow', show, durationMs: 40 * MIN, releaseDate: '2026-09-22' })
  const old = episode(OLD, { name: 'From Last Year', show, durationMs: 30 * MIN, releaseDate: '2025-06-01' })

  beforeEach(async () => {
    ctx = await createTestContext()
    cookie = `rc_session=${(await ctx.login()).token}`
    ctx.library.followShow(long.show, long, old)
    // The app watches ten minutes of LONG (12:00–12:10), then the player goes quiet.
    ctx.player.nowPlaying(long)
    await look()
    ctx.advance(10 * MIN)
    await look()
    ctx.player.deactivate()
    ctx.advance(MIN)
    await look()
    ctx.library.setResumePoint(LONG, { fully_played: false, resume_position_ms: 10 * MIN })
  })
  afterEach(() => ctx.close())

  it('records what a resume point says was heard while nobody watched the player', async () => {
    expect(await json(await sync())).toEqual({ total: 1, refreshed: 1, estimated: 0 })
    // A day later, on the phone with the server off: 25 more minutes of LONG.
    ctx.advance(DAY)
    ctx.library.setResumePoint(LONG, { fully_played: false, resume_position_ms: 35 * MIN })

    const res = await sync()
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ total: 1, refreshed: 1, estimated: 1 })
    expect(await estimates()).toEqual([
      // From when the app last knew the position (the first sync) to now.
      { episodeId: LONG, startedAt: new Date('2026-09-21T12:11:00Z'), endedAt: new Date('2026-09-22T12:11:00Z'), listenedMs: 25 * MIN, source: 'estimate' },
    ])
    const { items } = await json(await send('GET', '/history/listens'))
    expect(items[0]).toMatchObject({ source: 'estimate', listenedMs: 25 * MIN, startPositionMs: 10 * MIN, endPositionMs: 35 * MIN })
  })

  it('counts a finished episode up to its end', async () => {
    ctx.advance(HOUR)
    ctx.library.setResumePoint(LONG, { fully_played: true, resume_position_ms: 0 })
    expect(await json(await sync())).toMatchObject({ estimated: 1 })
    expect(await estimates()).toMatchObject([{ episodeId: LONG, startedAt: new Date('2026-09-21T12:10:00Z'), listenedMs: 50 * MIN }])
  })

  it('starts a new episode from its show’s last refresh, or its release', async () => {
    await sync()
    // FRESH comes out the next day and is listed at the next refresh, unstarted.
    ctx.advance(DAY)
    ctx.library.addEpisodes(fresh)
    await sync()
    ctx.advance(2 * HOUR)
    ctx.library.setResumePoint(FRESH, { fully_played: false, resume_position_ms: 30 * MIN })
    // Old, but listed unstarted at the last refresh, when the app was already watching.
    ctx.library.setResumePoint(OLD, { fully_played: false, resume_position_ms: 20 * MIN })

    expect(await json(await sync())).toMatchObject({ estimated: 2 })
    expect(await estimates()).toEqual([
      { episodeId: FRESH, startedAt: new Date('2026-09-22T12:11:00Z'), endedAt: new Date('2026-09-22T14:11:00Z'), listenedMs: 30 * MIN, source: 'estimate' },
      { episodeId: OLD, startedAt: new Date('2026-09-22T12:11:00Z'), endedAt: new Date('2026-09-22T14:11:00Z'), listenedMs: 20 * MIN, source: 'estimate' },
    ])
  })

  it('makes no guess for an episode with no starting point', async () => {
    // OLD's first refresh already shows progress: it may have been heard before the app watched.
    ctx.library.setResumePoint(OLD, { fully_played: true, resume_position_ms: 0 })
    expect(await json(await sync())).toMatchObject({ estimated: 0 })
    expect(await estimates()).toEqual([])
  })

  it('leaves small moves, replays and episodes the player is on to the player', async () => {
    ctx.advance(HOUR)
    // Spotify a minute ahead of what the app saw.
    ctx.library.setResumePoint(LONG, { fully_played: false, resume_position_ms: 11 * MIN })
    expect(await json(await sync())).toMatchObject({ estimated: 0 })

    // Started over: the position went back.
    ctx.advance(HOUR)
    ctx.library.setResumePoint(LONG, { fully_played: false, resume_position_ms: 5 * MIN })
    expect(await json(await sync())).toMatchObject({ estimated: 0 })

    // Playing it now: the watcher records it.
    ctx.player.nowPlaying(long)
    await look()
    ctx.advance(5 * MIN)
    ctx.library.setResumePoint(LONG, { fully_played: false, resume_position_ms: 40 * MIN })
    expect(await json(await sync())).toMatchObject({ estimated: 0 })
    expect(await estimates()).toEqual([])
  })

  it('estimates from an episode lookup too', async () => {
    ctx.advance(DAY)
    ctx.library.setResumePoint(LONG, { fully_played: false, resume_position_ms: 45 * MIN })
    await enqueue(ctx.db, [{ kind: 'episode', ref: episodeJobRef('pixelg', LONG), userId: 'pixelg' }], ctx.deps.now!())
    await runJobs(ctx.deps, { intervalMs: 0 })
    expect(await estimates()).toMatchObject([{ episodeId: LONG, listenedMs: 35 * MIN }])
  })

  it('leaves shows refreshed a few minutes ago, and drops their queued jobs', async () => {
    await send('POST', '/shows/sync')
    expect(await ctx.db.select().from(schema.jobs).where(eq(schema.jobs.kind, 'show'))).toHaveLength(1)
    expect(await json(await sync())).toMatchObject({ refreshed: 1 })
    expect(await ctx.db.select().from(schema.jobs).where(eq(schema.jobs.kind, 'show'))).toEqual([])
    ctx.advance(5 * MIN)
    expect(await json(await sync())).toMatchObject({ refreshed: 0 })
    expect(ctx.spotify.getShowEpisodes).toHaveBeenCalledOnce()
  })

  it('says when Spotify asks to wait, and waits', async () => {
    ctx.spotify.getShowEpisodes.mockRejectedValueOnce(new SpotifyApiError(429, 'slow down', 120))
    const res = await sync()
    expect(res.status).toBe(503)
    expect(await json(res)).toEqual({ error: 'rate_limited', retryAfter: 120 })
    expect((await sync()).status).toBe(503)

    ctx.advance(121_000)
    expect((await sync()).status).toBe(200)
  })

  it('gives way to an import of the same episode in its window', async () => {
    ctx.advance(DAY)
    ctx.library.setResumePoint(LONG, { fully_played: false, resume_position_ms: 35 * MIN })
    await sync()
    expect(await estimates()).toHaveLength(1)

    const { id } = await json(await send('POST', '/imports'))
    // What really happened: 25 minutes on the evening of the 21st.
    await send('POST', `/imports/${id}/plays`, { listens: [{ ts: '2026-09-21T19:25:00Z', ms: 25 * MIN, episodeId: LONG }] })
    await send('POST', `/imports/${id}/finish`)
    expect(await listens()).toEqual([
      { episodeId: LONG, startedAt: new Date('2026-09-21T12:00:00Z'), endedAt: new Date('2026-09-21T12:10:00Z'), listenedMs: 10 * MIN, source: 'poll' },
      { episodeId: LONG, startedAt: new Date('2026-09-21T19:00:00Z'), endedAt: new Date('2026-09-21T19:25:00Z'), listenedMs: 25 * MIN, source: 'import' },
    ])
  })
})
