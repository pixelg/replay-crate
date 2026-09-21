import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext, play, track } from '../testing.ts'
import { syncAllUsers } from './all-users.ts'
import { startSyncScheduler } from './scheduler.ts'

// Real (short) timers: the scheduler's work runs against PGlite, which needs the real
// event loop, so fake timers would freeze it.
describe('scheduled sync', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let stop = () => {}
  const log = { info: vi.fn<(message: string) => void>(), error: vi.fn<(message: string, error: unknown) => void>() }
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  beforeEach(async () => {
    ctx = await createTestContext()
    await ctx.login()
    log.info.mockClear()
    log.error.mockClear()
  })
  afterEach(async () => {
    stop()
    await ctx.close()
  })

  it('syncAllUsers records plays for every connected user', async () => {
    ctx.spotify.getRecentlyPlayed.mockResolvedValue({ items: [play(track('a'), '2026-09-21T11:00:00.000Z')], cursors: null })
    expect(await syncAllUsers(ctx.deps)).toEqual([{ userId: 'pixelg', inserted: 1 }])
  })

  it('runs after the first delay, then on every interval, until stopped', async () => {
    stop = startSyncScheduler(ctx.deps, { intervalMs: 150, firstRunAfterMs: 20, log })

    await vi.waitFor(() => expect(log.info).toHaveBeenCalledWith('[sync] 1 user(s), 0 new play(s)'))
    await vi.waitFor(() => expect(ctx.spotify.getRecentlyPlayed.mock.calls.length).toBeGreaterThanOrEqual(2), {
      timeout: 2_000,
    })

    stop()
    const callsWhenStopped = ctx.spotify.getRecentlyPlayed.mock.calls.length
    await sleep(400)
    expect(ctx.spotify.getRecentlyPlayed).toHaveBeenCalledTimes(callsWhenStopped)
  })

  it('never overlaps a slow run', async () => {
    let finish: () => void = () => {}
    ctx.spotify.getRecentlyPlayed.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ items: [], cursors: null })
        }),
    )
    stop = startSyncScheduler(ctx.deps, { intervalMs: 30, firstRunAfterMs: 0, log })

    await vi.waitFor(() => expect(ctx.spotify.getRecentlyPlayed).toHaveBeenCalledOnce())
    await sleep(200) // several intervals pass while the first run is stuck
    expect(ctx.spotify.getRecentlyPlayed).toHaveBeenCalledOnce()

    finish()
    await vi.waitFor(() => expect(ctx.spotify.getRecentlyPlayed.mock.calls.length).toBeGreaterThanOrEqual(2))
  })

  it('logs a failed user and keeps going', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ctx.spotify.getRecentlyPlayed.mockRejectedValueOnce(new Error('Spotify is down'))
    stop = startSyncScheduler(ctx.deps, { intervalMs: 100, firstRunAfterMs: 0, log })

    await vi.waitFor(() => expect(log.info).toHaveBeenCalledWith('[sync] 1 user(s), 0 new play(s), 1 failed'))
    await vi.waitFor(() => expect(log.info).toHaveBeenCalledWith('[sync] 1 user(s), 0 new play(s)'), { timeout: 2_000 })
  })
})
