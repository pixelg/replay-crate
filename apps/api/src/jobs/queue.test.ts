import { schema } from '@replay-crate/db'
import { SpotifyApiError, SpotifyAuthError } from '@replay-crate/spotify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, track } from '../testing.ts'
import { enqueue, jobStatus, runJobs } from './queue.ts'

const MINUTE = 60_000
const noPause = { pauseMs: 0 }

describe('job queue', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  const trackJob = (ref: string) => ({ kind: 'track' as const, ref, userId: 'pixelg' })
  const queued = () => ctx.db.select().from(schema.jobs)

  beforeEach(async () => {
    ctx = await createTestContext()
    await ctx.login()
  })
  afterEach(() => ctx.close())

  it('fetches a track into the catalog and removes the job', async () => {
    ctx.library.remember([track('abc', { name: 'Imported Song', album: ['alb', 'Some Album'], artists: [['ar', 'Artist']] })])
    await enqueue(ctx.db, [trackJob('abc')], ctx.deps.now!())

    expect(await runJobs(ctx.deps, noPause)).toMatchObject({ done: 1, remaining: 0 })
    expect(ctx.spotify.getTrack).toHaveBeenCalledWith('access-1', 'abc')
    expect(await ctx.db.select({ id: schema.tracks.id, name: schema.tracks.name }).from(schema.tracks)).toEqual([
      { id: 'abc', name: 'Imported Song' },
    ])
    expect(await queued()).toEqual([])
  })

  it('ignores a job that is already queued', async () => {
    await enqueue(ctx.db, [trackJob('a'), trackJob('a'), trackJob('b')], ctx.deps.now!())
    await enqueue(ctx.db, [trackJob('a')], ctx.deps.now!())
    expect(await queued()).toHaveLength(2)
  })

  it('drops jobs for things Spotify no longer has', async () => {
    ctx.spotify.getTrack.mockRejectedValueOnce(new SpotifyApiError(404, 'gone'))
    await enqueue(ctx.db, [trackJob('gone'), trackJob('fine')], ctx.deps.now!())
    expect(await runJobs(ctx.deps, noPause)).toMatchObject({ done: 1, dropped: 1, remaining: 0 })
  })

  it('stops the batch and waits when rate limited', async () => {
    ctx.spotify.getTrack.mockRejectedValueOnce(new SpotifyApiError(429, 'slow down', 30))
    await enqueue(ctx.db, [trackJob('first'), trackJob('second')], ctx.deps.now!())

    const result = await runJobs(ctx.deps, noPause)
    expect(result).toMatchObject({ done: 0, remaining: 2, rateLimitedUntil: new Date('2026-09-21T12:00:30Z') })
    expect(ctx.spotify.getTrack).toHaveBeenCalledOnce()

    // Not due until Retry-After has passed.
    expect(await runJobs(ctx.deps, noPause)).toMatchObject({ done: 1 }) // "second" was never tried
    ctx.advance(31_000)
    expect(await runJobs(ctx.deps, noPause)).toMatchObject({ done: 1, remaining: 0 })
  })

  it('retries other failures with growing backoff', async () => {
    ctx.spotify.getTrack.mockRejectedValue(new Error('network down'))
    await enqueue(ctx.db, [trackJob('flaky')], ctx.deps.now!())

    expect(await runJobs(ctx.deps, noPause)).toMatchObject({ retrying: 1, remaining: 1 })
    let [job] = await queued()
    expect(job).toMatchObject({ attempts: 1, lastError: 'network down', runAfter: new Date('2026-09-21T12:01:00Z') })

    ctx.advance(MINUTE)
    await runJobs(ctx.deps, noPause)
    ;[job] = await queued()
    expect(job).toMatchObject({ attempts: 2, runAfter: new Date('2026-09-21T12:03:00Z') })

    ctx.spotify.getTrack.mockReset()
    ctx.advance(2 * MINUTE)
    expect(await runJobs(ctx.deps, noPause)).toMatchObject({ done: 1, remaining: 0 })
  })

  it('holds a user’s jobs while they need to reconnect', async () => {
    ctx.spotify.refreshAccessToken.mockRejectedValueOnce(new SpotifyAuthError(400, 'invalid_grant'))
    ctx.advance(2 * 60 * MINUTE) // token expired
    await enqueue(ctx.db, [trackJob('waits')], ctx.deps.now!())
    expect(await runJobs(ctx.deps, noPause)).toMatchObject({ retrying: 1 })
    const [job] = await queued()
    expect(job!.runAfter.getTime()).toBe(new Date('2026-09-21T14:00:00Z').getTime() + 6 * 60 * MINUTE)
  })

  it('respects the time budget', async () => {
    await enqueue(ctx.db, ['a', 'b', 'c'].map(trackJob), ctx.deps.now!())
    expect(await runJobs(ctx.deps, { budgetMs: -1, pauseMs: 0 })).toMatchObject({ done: 0, remaining: 3 })
  })

  it('reports queue status per user', async () => {
    ctx.spotify.getTrack.mockRejectedValueOnce(new Error('nope'))
    await enqueue(ctx.db, ['a', 'b'].map(trackJob), ctx.deps.now!())
    await runJobs(ctx.deps, { ...noPause, limit: 1 })
    expect(await jobStatus(ctx.db, 'pixelg')).toEqual({ pending: 2, failing: 1 })
  })
})
