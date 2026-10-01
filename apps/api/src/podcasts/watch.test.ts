import { schema } from '@replay-crate/db'
import { SpotifyApiError } from '@replay-crate/spotify'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pausedUntil, pauseSpotify } from '../jobs/budget.ts'
import { createTestContext, episode } from '../testing.ts'
import { startPlayerWatch, watchAllUsers } from './watch.ts'

const MIN = 60_000

// Real (short) timers, as in the sync scheduler's tests: PGlite needs the real event loop.
describe('player watch', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let stop = () => {}
  const log = { info: vi.fn<(message: string) => void>(), error: vi.fn<(message: string, error: unknown) => void>() }
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
  const talk = episode('talk', { durationMs: 60 * MIN })
  const listens = () => ctx.db.select().from(schema.episodeListens)

  beforeEach(async () => {
    ctx = await createTestContext()
    await ctx.login()
    ctx.library.addEpisodes(talk)
    log.info.mockClear()
    log.error.mockClear()
  })
  afterEach(async () => {
    stop()
    await ctx.close()
  })

  it('records an episode heard with the app closed', async () => {
    ctx.player.nowPlaying(talk)
    expect(await watchAllUsers(ctx.deps, { freshMs: 90_000 })).toEqual([{ userId: 'pixelg', outcome: 'recorded' }])
    ctx.advance(2 * MIN)
    await watchAllUsers(ctx.deps, { freshMs: 90_000 })
    expect(await listens()).toMatchObject([{ episodeId: 'talk', listenedMs: 2 * MIN }])
  })

  it("leaves users the app is looking at to the app's own polls", async () => {
    ctx.player.nowPlaying(talk)
    await watchAllUsers(ctx.deps, { freshMs: 90_000 })
    ctx.advance(MIN)
    expect(await watchAllUsers(ctx.deps, { freshMs: 90_000 })).toEqual([{ userId: 'pixelg', outcome: 'skipped' }])
    expect(ctx.spotify.getPlaybackState).toHaveBeenCalledOnce()
  })

  it("skips users who haven't granted the player scopes", async () => {
    await ctx.db.update(schema.users).set({ scope: 'user-read-recently-played' }).where(eq(schema.users.id, 'pixelg'))
    expect(await watchAllUsers(ctx.deps, { freshMs: 90_000 })).toEqual([])
    expect(ctx.spotify.getPlaybackState).not.toHaveBeenCalled()
  })

  it('a 429 pauses background calls for every process', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ctx.spotify.getPlaybackState.mockRejectedValueOnce(new SpotifyApiError(429, 'slow down', 600))
    expect(await watchAllUsers(ctx.deps, { freshMs: 90_000 })).toEqual([{ userId: 'pixelg', outcome: 'failed' }])
    expect(await pausedUntil(ctx.db, ctx.deps.now!())).toEqual(new Date(ctx.deps.now!().getTime() + 600_000))
  })

  it('watches from one process only when two are up (dev and serve)', async () => {
    const other = { info: vi.fn<(message: string) => void>(), error: vi.fn<(message: string, error: unknown) => void>() }
    stop = startPlayerWatch(ctx.deps, { intervalMs: 60, firstRunAfterMs: 0, holder: 'dev', log })
    const stopOther = startPlayerWatch(ctx.deps, { intervalMs: 60, firstRunAfterMs: 0, holder: 'serve', log: other })
    try {
      await vi.waitFor(() => expect(other.info).toHaveBeenCalledWith('[watch] another process watches the players; standing by'))
      expect(log.info).not.toHaveBeenCalledWith(expect.stringMatching(/standing by/))
    } finally {
      stopOther()
    }
  })

  it("waits out Spotify's Retry-After", async () => {
    await pauseSpotify(ctx.db, new Date(ctx.deps.now!().getTime() + 60 * MIN), ctx.deps.now!())
    stop = startPlayerWatch(ctx.deps, { intervalMs: 30, firstRunAfterMs: 0, log })
    await sleep(150)
    expect(ctx.spotify.getPlaybackState).not.toHaveBeenCalled()
  })

  it('looks again on every interval until stopped', async () => {
    // The real clock, so each look is stale by the next interval.
    ctx.deps.now = () => new Date()
    stop = startPlayerWatch(ctx.deps, { intervalMs: 50, firstRunAfterMs: 0, log })
    await vi.waitFor(() => expect(ctx.spotify.getPlaybackState.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2_000 })
    stop()
    // A look already under way finishes; no new round starts.
    await sleep(100)
    const callsWhenStopped = ctx.spotify.getPlaybackState.mock.calls.length
    await sleep(200)
    expect(ctx.spotify.getPlaybackState).toHaveBeenCalledTimes(callsWhenStopped)
  })
})
