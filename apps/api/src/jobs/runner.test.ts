import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext, track } from '../testing.ts'
import { enqueue } from './queue.ts'
import { startJobRunner } from './runner.ts'

// Real (short) timers, as in the scheduler's tests: PGlite needs the real event loop.
describe('job runner', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  const stops: Array<() => void> = []
  const logFor = () => ({ info: vi.fn<(message: string) => void>(), error: vi.fn<(message: string, error: unknown) => void>() })
  const start = (holder: string, log = logFor()) => {
    stops.push(startJobRunner(ctx.deps, { holder, idleMs: 20, busyPauseMs: 10, log }))
    return log
  }
  const trackJobs = (refs: string[]) => refs.map((ref) => ({ kind: 'track' as const, ref, userId: 'pixelg' }))

  beforeEach(async () => {
    ctx = await createTestContext()
    await ctx.login()
  })
  afterEach(async () => {
    for (const stop of stops.splice(0)) stop()
    await ctx.close()
  })

  it('runs jobs in one process only when two are up (dev and serve)', async () => {
    const refs = ['a', 'b', 'c']
    ctx.library.remember(refs.map((ref) => track(ref)))
    await enqueue(ctx.db, trackJobs(refs), ctx.deps.now!())

    const dev = start('dev')
    const serve = start('serve')
    await vi.waitFor(() => expect(ctx.spotify.getTrack).toHaveBeenCalledTimes(3), { timeout: 5_000 })
    const logs = [...dev.info.mock.calls, ...serve.info.mock.calls].map(([message]) => message)
    expect(logs.filter((message) => message === '[jobs] running background jobs')).toHaveLength(1)
    expect(logs.filter((message) => message.includes('standing by'))).toHaveLength(1)
    // Each track once: nothing asked of Spotify twice.
    expect(ctx.spotify.getTrack.mock.calls.map(([, id]) => id).toSorted()).toEqual(refs)
  })

  it('lets the other process take over when the one running jobs stops', async () => {
    const first = start('dev')
    await vi.waitFor(() => expect(first.info).toHaveBeenCalledWith('[jobs] running background jobs'))
    const second = start('serve')
    await vi.waitFor(() => expect(second.info).toHaveBeenCalledWith(expect.stringContaining('standing by')))

    stops.shift()!() // dev closes, handing the lease on
    ctx.library.remember([track('late')])
    await enqueue(ctx.db, trackJobs(['late']), ctx.deps.now!())
    await vi.waitFor(() => expect(second.info).toHaveBeenCalledWith('[jobs] running background jobs'), { timeout: 5_000 })
    await vi.waitFor(() => expect(ctx.spotify.getTrack).toHaveBeenCalledWith(expect.anything(), 'late'), { timeout: 5_000 })
  })
})
