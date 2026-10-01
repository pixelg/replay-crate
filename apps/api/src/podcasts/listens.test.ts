import { schema } from '@replay-crate/db'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runJobs } from '../jobs/queue.ts'
import { createTestContext, episode, track } from '../testing.ts'
import { recordObservation } from './listens.ts'

const MIN = 60_000

describe('episode listens', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string

  beforeEach(async () => {
    ctx = await createTestContext()
    cookie = `rc_session=${(await ctx.login()).token}`
    ctx.library.addEpisodes(talk)
  })
  afterEach(() => ctx.close())

  const talk = episode('talk', { name: 'On Listening', show: ['pod', 'The Pod'], durationMs: 60 * MIN })
  const poll = async () => expect((await ctx.app.request('/api/v1/player', { headers: { Cookie: cookie } })).status).toBe(200)
  const listens = () => ctx.db.select().from(schema.episodeListens).orderBy(asc(schema.episodeListens.startedAt))
  const progress = async () => (await ctx.db.select().from(schema.episodeProgress))[0]

  it('turns polls of a playing episode into one listen, with the episode and its show', async () => {
    ctx.player.nowPlaying(talk, { positionMs: 10 * MIN })
    await poll()
    ctx.advance(2 * MIN)
    await poll()
    ctx.advance(2 * MIN)
    await poll()

    const [listen, ...others] = await listens()
    expect(others).toEqual([])
    expect(listen).toMatchObject({ episodeId: 'talk', source: 'poll', startPositionMs: 10 * MIN, endPositionMs: 14 * MIN, listenedMs: 4 * MIN })
    expect(listen!.endedAt.getTime() - listen!.startedAt.getTime()).toBe(4 * MIN)
    expect(await progress()).toMatchObject({ episodeId: 'talk', resumePositionMs: 14 * MIN, fullyPlayed: false })
    const [show] = await ctx.db.select().from(schema.shows)
    expect(show).toMatchObject({ id: 'pod', name: 'The Pod' })
    const [stored] = await ctx.db.select().from(schema.episodes)
    expect(stored).toMatchObject({ id: 'talk', showId: 'pod', name: 'On Listening', releaseDate: '2026-09-01' })
  })

  it('records one moment once, however often the app polls', async () => {
    ctx.player.nowPlaying(talk)
    await poll()
    ctx.advance(10_000)
    await poll()
    ctx.advance(10_000)
    await poll()
    expect((await listens())[0]).toMatchObject({ listenedMs: 0, endPositionMs: 0 })
    ctx.advance(10_000)
    await poll()
    expect((await listens())[0]).toMatchObject({ listenedMs: 30_000, endPositionMs: 30_000 })
  })

  it('lets only one of two simultaneous looks record', async () => {
    ctx.player.nowPlaying(talk)
    const state = await ctx.player.gateway.getPlaybackState('t')
    const at = new Date()
    const userId = 'pixelg'
    const recorded = await Promise.all([recordObservation(ctx.db, userId, state, at), recordObservation(ctx.db, userId, state, at)])
    expect(recorded.toSorted()).toEqual([false, true])
    expect(await listens()).toHaveLength(1)
  })

  it('keeps a paused listen open and carries on when playback resumes', async () => {
    ctx.player.nowPlaying(talk)
    await poll()
    ctx.advance(3 * MIN)
    await ctx.player.gateway.pause('t', {})
    await poll()
    ctx.advance(5 * MIN)
    await poll()
    await ctx.player.gateway.play('t', {})
    ctx.advance(2 * MIN)
    await poll()

    const [listen, ...others] = await listens()
    expect(others).toEqual([])
    expect(listen).toMatchObject({ listenedMs: 5 * MIN, endPositionMs: 5 * MIN })
  })

  it('starts a new listen after a long break or a jump', async () => {
    ctx.player.nowPlaying(talk)
    await poll()
    ctx.advance(2 * MIN)
    await poll()
    await ctx.player.gateway.pause('t', {})
    ctx.advance(30 * MIN)
    await ctx.player.gateway.play('t', {})
    await poll()
    ctx.advance(30_000)
    await ctx.player.gateway.seek('t', 40 * MIN, {})
    ctx.advance(MIN)
    await poll()

    expect((await listens()).map((listen) => [listen.startPositionMs, listen.endPositionMs])).toEqual([
      [0, 2 * MIN],
      [2 * MIN, 2 * MIN],
      [40 * MIN, 41 * MIN],
    ])
  })

  it('marks an episode played to the end as finished', async () => {
    ctx.player.nowPlaying(talk, { positionMs: 57 * MIN })
    await poll()
    ctx.advance(2 * MIN)
    await poll()
    expect(await progress()).toMatchObject({ fullyPlayed: true, resumePositionMs: 59 * MIN })
  })

  it('records nothing for tracks', async () => {
    ctx.player.nowPlaying(track('song'))
    await poll()
    ctx.advance(2 * MIN)
    await poll()
    expect(await listens()).toEqual([])
  })

  it("looks up Spotify's resume point once the episode changes", async () => {
    ctx.player.nowPlaying(talk, { positionMs: 20 * MIN })
    await poll()
    ctx.advance(MIN)
    ctx.player.nowPlaying(track('song'))
    await poll()

    const queued = await ctx.db.select().from(schema.jobs)
    expect(queued).toMatchObject([{ kind: 'episode', ref: 'pixelg:talk', userId: 'pixelg' }])
    ctx.library.setResumePoint('talk', { fully_played: false, resume_position_ms: 21 * MIN })
    await runJobs(ctx.deps, { intervalMs: 0 })
    expect(ctx.spotify.getEpisode).toHaveBeenCalledWith(expect.any(String), 'talk')
    expect(await progress()).toMatchObject({ resumePositionMs: 21 * MIN, fullyPlayed: false })
  })

  it('takes Spotify at its word when it says an episode is no longer finished', async () => {
    ctx.player.nowPlaying(talk, { positionMs: 59 * MIN, playing: true })
    await poll()
    expect(await progress()).toMatchObject({ fullyPlayed: true })
    ctx.player.deactivate()
    ctx.advance(MIN)
    await poll()
    ctx.library.setResumePoint('talk', { fully_played: false, resume_position_ms: 0 })
    await runJobs(ctx.deps, { intervalMs: 0 })
    expect(await progress()).toMatchObject({ fullyPlayed: false, resumePositionMs: 0 })
  })

  it('looks up an episode the player sent without a release date', async () => {
    const bare = { ...episode('bare', { show: ['pod', 'The Pod'] }), release_date: undefined }
    ctx.player.nowPlaying(bare)
    await poll()
    expect(await ctx.db.select().from(schema.jobs)).toMatchObject([{ kind: 'episode', ref: 'pixelg:bare' }])
    ctx.library.addEpisodes(episode('bare', { show: ['pod', 'The Pod'], releaseDate: '2026-08-15' }))
    await runJobs(ctx.deps, { intervalMs: 0 })
    const [stored] = await ctx.db.select().from(schema.episodes).where(eq(schema.episodes.id, 'bare'))
    expect(stored?.releaseDate).toBe('2026-08-15')
  })
})
