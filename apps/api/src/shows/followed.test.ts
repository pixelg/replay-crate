import { schema } from '@replay-crate/db'
import { SpotifyApiError } from '@replay-crate/spotify'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pausedUntil } from '../jobs/budget.ts'
import { runJobs } from '../jobs/queue.ts'
import { syncAllUsers } from '../sync/all-users.ts'
import { createTestContext, episode } from '../testing.ts'

const ORIGIN = 'http://127.0.0.1:5173'
const MIN = 60_000

describe('followed shows', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string

  // oxlint-disable-next-line typescript/no-explicit-any
  const get = async (path: string): Promise<any> => {
    const res = await ctx.app.request(`/api/v1${path}`, { headers: { Cookie: cookie } })
    expect(res.status).toBe(200)
    return res.json()
  }
  const sync = () => ctx.app.request('/api/v1/shows/sync', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN } })

  // The clock says 2026-09-21; Science has two recent episodes and an old one.
  const latest = episode('sci3', { name: 'Science Three', show: ['sci', 'Science Hour'], durationMs: 40 * MIN, releaseDate: '2026-09-20' })
  const middle = episode('sci2', { name: 'Science Two', show: ['sci', 'Science Hour'], durationMs: 40 * MIN, releaseDate: '2026-09-10' })
  const old = episode('sci1', { name: 'Science One', show: ['sci', 'Science Hour'], durationMs: 40 * MIN, releaseDate: '2025-12-01' })

  beforeEach(async () => {
    ctx = await createTestContext()
    cookie = `rc_session=${(await ctx.login()).token}`
    ctx.library.followShow(latest.show, latest, middle, old)
    ctx.library.followShow(episode('x', { show: ['quiet', 'Quiet Show'] }).show)
  })
  afterEach(() => ctx.close())

  it('reads the shows you follow and fetches their latest episodes in the background', async () => {
    const res = await sync()
    expect(await res.json()).toEqual({ total: 2, queued: 2 })
    expect((await get('/shows')).items).toMatchObject([
      { show: { id: 'quiet', name: 'Quiet Show' }, followed: true, stats: { listens: 0 } },
      { show: { id: 'sci', name: 'Science Hour' }, followed: true, stats: { listens: 0 } },
    ])

    ctx.library.setResumePoint('sci2', { fully_played: false, resume_position_ms: 12 * MIN })
    await runJobs(ctx.deps, { intervalMs: 0 })
    const { items, syncedAt } = await get('/shows/new-episodes')
    expect(syncedAt).toBe('2026-09-21T12:00:00.000Z')
    expect(items.map((item: { id: string }) => item.id)).toEqual(['sci3', 'sci2'])
    expect(items[1]).toMatchObject({ show: { id: 'sci', name: 'Science Hour' }, progress: { resumePositionMs: 12 * MIN, fullyPlayed: false } })
    expect((await get('/shows/sci')).followed).toBe(true)

    // Checked lately: not fetched again on the next sync.
    expect(await (await sync()).json()).toEqual({ total: 2, queued: 0 })
  })

  it('leaves out finished episodes, and older ones unless asked', async () => {
    await sync()
    ctx.library.setResumePoint('sci3', { fully_played: true, resume_position_ms: 0 })
    await runJobs(ctx.deps, { intervalMs: 0 })
    expect((await get('/shows/new-episodes')).items.map((item: { id: string }) => item.id)).toEqual(['sci2'])
    expect((await get('/shows/new-episodes?days=365')).items.map((item: { id: string }) => item.id)).toEqual(['sci2', 'sci1'])
  })

  it('forgets shows you stopped following', async () => {
    await sync()
    ctx.library.savedShows.splice(0, 1)
    await sync()
    expect((await get('/shows')).items.map((item: { show: { id: string } }) => item.show.id)).toEqual(['sci'])
    expect((await get('/shows/new-episodes')).items).toEqual([])
  })

  it('lists listened shows first, with whether you follow them', async () => {
    await sync()
    await runJobs(ctx.deps, { intervalMs: 0 })
    ctx.player.nowPlaying(latest)
    await get('/player')
    ctx.advance(2 * MIN)
    await get('/player')
    expect((await get('/shows')).items.map((item: { show: { id: string }; followed: boolean }) => [item.show.id, item.followed])).toEqual([
      ['sci', true],
      ['quiet', true],
    ])
  })

  it('happens with the scheduled sync, twice a day', async () => {
    await syncAllUsers(ctx.deps)
    expect(ctx.spotify.getMyShows).toHaveBeenCalledTimes(1)
    await syncAllUsers(ctx.deps)
    expect(ctx.spotify.getMyShows).toHaveBeenCalledTimes(1)
    ctx.advance(13 * 60 * MIN)
    await syncAllUsers(ctx.deps)
    expect(ctx.spotify.getMyShows).toHaveBeenCalledTimes(2)
  })

  it("skips users who haven't granted the library scope, and pauses on a 429", async () => {
    await ctx.db.update(schema.users).set({ scope: 'user-read-recently-played' }).where(eq(schema.users.id, 'pixelg'))
    await syncAllUsers(ctx.deps)
    expect(ctx.spotify.getMyShows).not.toHaveBeenCalled()

    await ctx.db.update(schema.users).set({ scope: 'user-read-recently-played user-library-read' }).where(eq(schema.users.id, 'pixelg'))
    ctx.spotify.getMyShows.mockRejectedValueOnce(new SpotifyApiError(429, 'slow down', 300))
    expect(await syncAllUsers(ctx.deps)).toEqual([{ userId: 'pixelg', inserted: 0 }])
    expect(await pausedUntil(ctx.db, ctx.deps.now!())).toEqual(new Date(ctx.deps.now!().getTime() + 300_000))
  })

  it('reports a refused sync', async () => {
    ctx.spotify.getMyShows.mockRejectedValueOnce(new SpotifyApiError(403, 'Insufficient client scope'))
    expect((await sync()).status).toBe(403)
  })
})
