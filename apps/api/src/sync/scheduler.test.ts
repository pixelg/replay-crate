import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestContext, play, track } from '../testing.ts'
import { SpotifyApiError } from '@replay-crate/spotify'
import { pauseSpotify, pausedUntil } from '../jobs/budget.ts'
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

  it('syncs from one process only when two are up (dev and serve)', async () => {
    const other = { info: vi.fn<(message: string) => void>(), error: vi.fn<(message: string, error: unknown) => void>() }
    stop = startSyncScheduler(ctx.deps, { intervalMs: 100, firstRunAfterMs: 0, holder: 'dev', log })
    const stopOther = startSyncScheduler(ctx.deps, { intervalMs: 100, firstRunAfterMs: 0, holder: 'serve', log: other })
    try {
      await sleep(350)
      const runs = [...log.info.mock.calls, ...other.info.mock.calls].filter(([message]) => message.startsWith('[sync] 1 user'))
      // One recently-played call per interval, not two.
      expect(ctx.spotify.getRecentlyPlayed).toHaveBeenCalledTimes(runs.length)
      expect(other.info).toHaveBeenCalledWith('[sync] another process runs the scheduled sync; standing by')
      expect(other.info).not.toHaveBeenCalledWith(expect.stringMatching(/^\[sync\] 1 user/))
    } finally {
      stopOther()
    }
  })

  it("skips while Spotify's Retry-After runs, and records a new one", async () => {
    await pauseSpotify(ctx.db, new Date(ctx.deps.now!().getTime() + 60 * 60_000), ctx.deps.now!())
    stop = startSyncScheduler(ctx.deps, { intervalMs: 50, firstRunAfterMs: 0, log })
    await vi.waitFor(() => expect(log.info).toHaveBeenCalledWith(expect.stringMatching(/^\[sync\] skipped: Spotify asked us to wait until/)))
    await sleep(120)
    expect(ctx.spotify.getRecentlyPlayed).not.toHaveBeenCalled()
  })

  it('a 429 during a sync pauses background calls for every process', async () => {
    ctx.spotify.getRecentlyPlayed.mockRejectedValueOnce(new SpotifyApiError(429, 'slow down', 600))
    await syncAllUsers(ctx.deps)
    expect(await pausedUntil(ctx.db, ctx.deps.now!())).toEqual(new Date(ctx.deps.now!().getTime() + 600_000))
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
